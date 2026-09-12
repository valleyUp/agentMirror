import { mkdir, readFile, writeFile, cp, chmod, copyFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import * as tar from 'tar';
import semver from 'semver';
import { type Config, type Platform, PACKAGES } from './config.ts';
import { binaryKind, download, hashFile, mapLimit } from './io.ts';
import type { MirrorLock, PackageRecord } from './resolve.ts';

export const archivePath = (work: string, p: PackageRecord) => resolve(work, 'tarballs', `${p.name.replaceAll('/', '__')}--${p.version}.tgz`);
export async function unpack(file: string, dest: string) {
  await mkdir(join(dest, 'package'), { recursive: true });
  // npm strips one top-level directory; older @types archives use node/ etc.
  // Normalize that directory to package/ while refusing traversal and links.
  let invalid: string | undefined;
  let prefix: string | undefined;
  await tar.t({ file, onReadEntry(e) {
    if (['ExtendedHeader', 'GlobalExtendedHeader'].includes(e.type)) return;
    const root = e.path.split('/')[0]; prefix ??= root;
    if (!root || root !== prefix || !e.path.includes('/') || e.path.includes('\\') || e.path.includes(':') || e.path.split('/').includes('..') || !['File', 'Directory', 'OldFile'].includes(e.type)) invalid = `Unsafe archive entry: ${e.path} (${e.type})`;
  } });
  if (invalid) throw Error(invalid);
  await tar.x({ file, cwd: join(dest, 'package'), strip: 1, strict: true, preservePaths: false });
}
export interface NativeRecord { version: string; platform: Platform; path: string; executable: string; sha256: string; size: number; status: string; }
export function requiredClaudeNative(lock: MirrorLock, version: string, platform: Platform): PackageRecord {
  const root = lock.packages.find(p => p.name === PACKAGES.claude && p.version === version);
  const name = `${PACKAGES.claude}-${platform}`;
  const spec = root?.metadata.optionalDependencies?.[name];
  if (!spec) throw Error(`Claude ${version}: unrecognized distribution, no ${name}. An explicit adapter is required.`);
  const candidates = lock.packages.filter(p => p.name === name && semver.satisfies(p.version, spec));
  if (candidates.length !== 1) throw Error(`Claude ${version}: missing/ambiguous required native package ${name}@${spec}`);
  return candidates[0];
}
export async function inspectManifest(file: string) {
  const chunks: Buffer[] = [];
  let implicitBuild = false;
  await tar.t({ file, onReadEntry(e) {
    if (/^[^/]+\/binding\.gyp$/.test(e.path)) implicitBuild = true;
    if (/^[^/]+\/package\.json$/.test(e.path)) {
      if (e.size > 2_000_000) return;
      e.on('data', text => { chunks.push(Buffer.from(text)); });
    }
  } });
  if (!chunks.length) throw Error(`Package manifest missing or too large: ${file}`);
  return { manifest: JSON.parse(Buffer.concat(chunks).toString('utf8')), implicitBuild };
}
export async function collectPackages(c: Config, lock: MirrorLock, work: string, out: string) {
  for (const version of c.tools.claude.versions) for (const platform of c.platforms) requiredClaudeNative(lock, version, platform);
  const audit: any[] = [];
  await mapLimit(lock.packages, 6, async p => {
    console.log(`Fetch ${p.name}@${p.version}`);
    const file = archivePath(work, p);
    await download(p.url, file, p.integrity);
    const { manifest, implicitBuild } = await inspectManifest(file);
    if (manifest.name !== p.name || manifest.version !== p.version) throw Error(`Archive identity differs from registry: ${p.name}@${p.version}`);
    const scripts = Object.fromEntries(Object.entries(manifest.scripts ?? {}).filter(([key]) => ['preinstall', 'install', 'postinstall'].includes(key)));
    if (implicitBuild && !scripts.install && !scripts.preinstall) scripts.install = 'node-gyp rebuild';
    // Use archive lifecycle data, not a possibly incomplete registry projection.
    p.metadata.scripts = { ...p.metadata.scripts, ...scripts };
    if (Object.keys(scripts).length) {
      const digest = await hashFile(file);
      const inspection = resolve(work, 'inspect', `${p.name.replaceAll('/', '__')}--${p.version}`);
      await unpack(file, inspection);
      audit.push({ package: `${p.name}@${p.version}`, scripts, sha256: digest, inspection, approved: c.approvedScripts[`${p.name}@${p.version}`] === digest });
    }
  });
  audit.sort((a, b) => a.package.localeCompare(b.package));
  await writeFile(resolve(work, 'script-audit.json'), JSON.stringify(audit, null, 2));
  const natives: NativeRecord[] = [];
  const releaseRoot = resolve(out, 'public', 'claude-code-releases');
  await mkdir(releaseRoot, { recursive: true });
  for (const version of c.tools.claude.versions) {
    const manifest: any = { version, platforms: {} };
    for (const platform of c.platforms) {
      const native = requiredClaudeNative(lock, version, platform);
      const dir = resolve(work, 'native', version, platform);
      await unpack(archivePath(work, native), dir);
      const executable = platform === 'win32-x64' ? 'claude.exe' : 'claude';
      const source = join(dir, 'package', executable);
      const kind = await binaryKind(source);
      if (kind !== (platform === 'win32-x64' ? 'pe-x64' : 'elf-x64')) throw Error(`Wrong binary for ${platform}`);
      const target = resolve(releaseRoot, version, platform);
      await mkdir(target, { recursive: true });
      await copyFile(source, join(target, executable));
      await chmod(join(target, executable), 0o755);
      const digest = await hashFile(source);
      const size = (await stat(source)).size;
      await writeFile(join(target, 'SHA256SUMS'), `${digest}  ${executable}\n`);
      manifest.platforms[platform] = { checksum: digest, size };
      natives.push({ version, platform, path: `/claude-code-releases/${version}/${platform}/`, executable, sha256: digest, size, status: 'binary-inspected; runtime-unverified' });
    }
    await writeFile(resolve(releaseRoot, version, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  await writeFile(resolve(releaseRoot, 'latest'), `${c.tools.claude.defaultVersion}\n`);
  await writeFile(resolve(releaseRoot, 'stable'), `${c.tools.claude.defaultVersion}\n`);
  await cp(resolve('installers'), resolve(out, 'installers'), { recursive: true });
  const unapproved = audit.filter(p => !p.approved);
  if (unapproved.length) throw Error(`Review lifecycle scripts at ${resolve(work, 'script-audit.json')}, then add their tarball SHA-256 to approvedScripts. Unapproved: ${unapproved.map(p => p.package).join(', ')}`);
  return natives;
}
export async function collectAssets(c: Config, out: string) {
  const dir = resolve(out, 'public', 'downloads');
  await mkdir(dir, { recursive: true });
  const base = `https://nodejs.org/dist/v${c.node.version}/`;
  const checksResponse = await fetch(`${base}SHASUMS256.txt`, { signal: AbortSignal.timeout(120_000) });
  if (!checksResponse.ok) throw Error('Cannot fetch Node.js checksums');
  const checks = await checksResponse.text();
  await writeFile(join(dir, `node-v${c.node.version}-SHASUMS256.txt`), checks);
  const files = new Set<string>();
  if (c.platforms.includes('win32-x64')) { files.add(`node-v${c.node.version}-x64.msi`); files.add(`node-v${c.node.version}-win-x64.zip`); }
  if (c.platforms.includes('linux-x64')) files.add(`node-v${c.node.version}-linux-x64.tar.xz`);
  if (c.platforms.includes('linux-x64-musl') && !c.assets.some(a => a.id === 'node-musl')) throw Error('musl requires an explicitly configured node-musl asset; official glibc Node archive cannot be used');
  const assets = [];
  for (const filename of files) {
    const checksum = checks.split('\n').map(l => l.trim().split(/\s+/)).find(([, f]) => f === filename)?.[0];
    if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) throw Error(`No Node checksum: ${filename}`);
    await download(`${base}${filename}`, join(dir, filename), `sha256-${Buffer.from(checksum, 'hex').toString('base64')}`);
    assets.push({ filename, sha256: checksum, url: `${base}${filename}`, path: `/downloads/${filename}`, description: 'Node.js（内含 npm）' });
  }
  for (const a of c.assets) {
    await download(a.url, join(dir, a.filename), `sha256-${Buffer.from(a.sha256, 'hex').toString('base64')}`);
    assets.push({ ...a, path: `/downloads/${a.filename}` });
  }
  await writeFile(join(dir, 'SHA256SUMS'), assets.map(a => `${a.sha256}  ${a.filename}\n`).join(''));
  return assets;
}
