import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import semver from 'semver';
import { type Config, type Tool, type Platform, PACKAGES, PLATFORMS, platformMatches } from './config.ts';
import { json, run, sha256, mapLimit } from './io.ts';

export interface PackageRecord { name: string; version: string; metadata: any; integrity: string; url: string; }
export type RootKind = 'tool' | 'npm-package';
export interface RootRecord { kind: RootKind; name: string; tool?: Tool; version: string; platform: Platform; lock: any; }
export interface MirrorLock {
  schemaVersion: 1; configHash: string; generatedAt: string; npmVersion: string;
  packages: PackageRecord[]; roots: RootRecord[];
}
export const configHash = (c: Config) => sha256(JSON.stringify({
  registry: c.registry, platforms: c.platforms, tools: c.tools,
  npmPackages: c.npmPackages, node: c.node,
}));
export async function resolvePackages(c: Config, work: string): Promise<MirrorLock> {
  const npmCLI = resolve('node_modules/npm/bin/npm-cli.js');
  const packages = new Map<string, PackageRecord>();
  const roots: RootRecord[] = [];
  const metadataCache = new Map<string, any>();
  try {
    const prior: MirrorLock = JSON.parse(await readFile(resolve(work, 'mirror-lock.json'), 'utf8'));
    for (const p of prior.packages) if (new URL(p.url).origin === new URL(c.registry).origin) metadataCache.set(`${p.name}@${p.version}`, p.metadata);
  } catch { /* no previous metadata snapshot */ }
  async function get(name: string, version: string) {
    const key = `${name}@${version}`;
    if (!metadataCache.has(key)) metadataCache.set(key, await json(`${c.registry.replace(/\/$/, '')}/${name.replace('/', '%2f')}/${version}`));
    return metadataCache.get(key);
  }
  const configuredRoots = [
    ...(Object.entries(c.tools) as [Tool, Config['tools'][Tool]][]).map(([tool, entry]) => ({ kind: 'tool' as const, name: PACKAGES[tool], tool, versions: entry.versions })),
    ...c.npmPackages.map(entry => ({ kind: 'npm-package' as const, name: entry.name, versions: entry.versions })),
  ];
  for (const root of configuredRoots) {
    for (const version of root.versions) for (const platform of c.platforms) {
      console.log(`Resolve ${root.name}@${version} (${platform})`);
      const rootMeta = await get(root.name, version);
      if (!platformMatches(rootMeta, platform)) throw Error(`Unsupported root ${root.name}@${version} ${platform}`);
      const rootDir = root.name.replace(/^@/, '').replace('/', '__');
      const dir = resolve(work, 'resolve', root.kind, rootDir, version, platform);
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, 'package.json'), JSON.stringify({ name: 'mirror-resolution', version: '1.0.0', private: true, dependencies: { [root.name]: version } }));
      const p = PLATFORMS[platform];
      await run(process.execPath, [npmCLI, 'install', '--package-lock-only', '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund', '--fetch-timeout=30000', '--fetch-retries=2', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000', '--registry', c.registry, '--os', p.os, '--cpu', p.cpu, ...(p.libc ? ['--libc', p.libc] : [])], {
        cwd: dir, quiet: true,
        env: { npm_config_cache: resolve(work, 'npm-cache'), npm_config_userconfig: resolve(work, 'empty.npmrc'), npm_config_globalconfig: resolve(work, 'empty-global.npmrc') },
      });
      const lock = JSON.parse(await readFile(resolve(dir, 'package-lock.json'), 'utf8'));
      roots.push({ kind: root.kind, name: root.name, ...('tool' in root ? { tool: root.tool } : {}), version, platform, lock });
      const pending = new Map<string, { name: string; node: any }>();
      for (const [path, node] of Object.entries(lock.packages) as [string, any][]) {
        if (!path || !platformMatches(node, platform)) continue;
        // npm ships its CLI dependencies inside its integrity-protected root
        // tarball. npm marks those lock entries inBundle and omits separate
        // registry URLs because no additional download is needed.
        if (node.inBundle === true) continue;
        if (node.link || !node.resolved?.startsWith('https:') || !node.integrity) throw Error(`Unsupported non-registry dependency: ${path}`);
        // Alias packages (notably Codex native builds) carry their real name here.
        const name = node.name ?? path.slice(path.lastIndexOf('node_modules/') + 13);
        const key = `${name}@${node.version}`;
        if (packages.has(key)) continue;
        pending.set(key, { name, node });
      }
      await mapLimit([...pending.values()], 8, async ({ name, node }) => {
        const key = `${name}@${node.version}`;
        const meta = await get(name, node.version);
        if (meta.engines?.node && !semver.satisfies(c.node.version, meta.engines.node)) throw Error(`${key} requires Node ${meta.engines.node}, configured ${c.node.version}`);
        if (meta.dist?.integrity !== node.integrity) throw Error(`Lock integrity differs from registry for ${key}`);
        packages.set(key, { name, version: node.version, metadata: meta, integrity: node.integrity, url: meta.dist.tarball });
      });
    }
  }
  return { schemaVersion: 1, configHash: configHash(c), generatedAt: new Date().toISOString(), npmVersion: (await run(process.execPath, [npmCLI, '--version'], { quiet: true })).trim(), packages: [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)), roots };
}
