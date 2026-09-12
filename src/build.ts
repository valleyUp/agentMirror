import { mkdir, readFile, writeFile, rm, rename, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readConfig, PACKAGES, type Tool } from './config.ts';
import { resolvePackages, configHash, type MirrorLock } from './resolve.ts';
import { collectPackages, collectAssets, archivePath } from './artifacts.ts';
import { startRegistry, importPackage, setTag } from './registry.ts';
import { generateSite } from './site.ts';

async function main() {
  const action = process.argv[2] ?? 'validate';
  const configFile = process.env.MIRROR_CONFIG ?? 'mirror.yaml';
  const c = await readConfig(configFile);
  if (action === 'validate') { console.log(`Valid: ${configFile}; ${c.platforms.join(', ')}`); return; }
  if (!['build', 'resolve'].includes(action)) throw Error('Usage: node src/build.ts validate|resolve|build');
  const work = resolve(process.env.MIRROR_WORK ?? '.mirror-work');
  const dest = resolve(process.env.MIRROR_OUT ?? 'dist');
  const stage = `${dest}.staging`;
  if ([work, dest, stage].some(p => p === process.cwd() || p === '/')) throw Error('Unsafe work/output directory');
  await mkdir(work, { recursive: true });
  // O_EXCL prevents concurrent builds corrupting the output or registry.
  const guard = resolve(work, 'building');
  await writeFile(guard, `${process.pid}`, { flag: 'wx' });
  try {
    await writeFile(resolve(work, 'empty.npmrc'), '');
    await writeFile(resolve(work, 'empty-global.npmrc'), '');
    let lock: MirrorLock;
    if (process.env.MIRROR_LOCK) {
      lock = JSON.parse(await readFile(process.env.MIRROR_LOCK, 'utf8'));
      if (lock.schemaVersion !== 1 || lock.configHash !== configHash(c)) throw Error('Input lock does not match configuration');
    } else {
      // Reuse only the exact configuration snapshot, not stale npm resolution directories.
      const cached = resolve(work, 'mirror-lock.json');
      try {
        try {
          lock = JSON.parse(await readFile(resolve('mirror-lock.json'), 'utf8'));
          if (lock.configHash !== configHash(c)) throw Error('Shipped lock is for another config');
        } catch { lock = JSON.parse(await readFile(cached, 'utf8')); }
        if (lock.configHash !== configHash(c)) throw Error('Config changed');
      } catch {
        await rm(resolve(work, 'resolve'), { recursive: true, force: true });
        lock = await resolvePackages(c, work);
      }
    }
    await writeFile(resolve(work, 'mirror-lock.json'), JSON.stringify(lock, null, 2));
    if (action === 'resolve') { console.log(`Resolved ${lock.packages.length} packages; ${work}/mirror-lock.json`); return; }
    await rm(stage, { recursive: true, force: true });
    await mkdir(resolve(stage, 'public'), { recursive: true });
    const natives = await collectPackages(c, lock, work, stage);
    const assets = await collectAssets(c, stage);
    const storage = resolve(stage, 'storage');
    // The temporary registry never has uplinks. Importing only collected versions
    // prevents npm resolving an uncached version advertised by upstream metadata.
    await rm(resolve(work, 'build.htpasswd'), { force: true });
    const registry = await startRegistry(work, storage, Number(process.env.MIRROR_BUILD_PORT ?? 14873));
    try {
      for (const p of lock.packages) {
        console.log(`Import ${p.name}@${p.version}`);
        await importPackage(registry.url, registry.token, p, archivePath(work, p));
      }
      for (const tool of Object.keys(PACKAGES) as Tool[]) await setTag(registry.url, registry.token, PACKAGES[tool], c.tools[tool].defaultVersion);
      for (const entry of c.npmPackages) await setTag(registry.url, registry.token, entry.name, entry.defaultVersion);
    } finally {
      const stopped = new Promise<void>(r => registry.process.once('exit', () => r()));
      registry.process.kill('SIGTERM'); await stopped;
    }
    const catalog = {
      schemaVersion: 1, title: c.site.title, builtAt: new Date().toISOString(), nodeVersion: c.node.version,
      platforms: c.platforms, tools: Object.fromEntries(Object.entries(c.tools).map(([id, t]) => [id, {
        ...t, package: PACKAGES[id as Tool],
        scriptAllowlist: Object.fromEntries(t.versions.map(version => {
          const identities = new Set(lock.roots.filter(r => r.tool === id && r.version === version).flatMap(r => Object.entries(r.lock.packages).filter(([path]) => path).map(([path, n]: [string, any]) => `${n.name ?? path.slice(path.lastIndexOf('node_modules/') + 13)}@${n.version}`)));
          return [version, Object.keys(c.approvedScripts).filter(key => identities.has(key))];
        })),
      }])),
      npmPackages: c.npmPackages,
      assets, natives, validation: 'cached-and-inspected; run offline smoke tests before release',
      installScriptAllowlist: Object.keys(c.approvedScripts).filter(key => lock.packages.some(p => `${p.name}@${p.version}` === key)),
      packages: lock.packages.map(p => ({ name: p.name, version: p.version, integrity: p.integrity, source: p.url, license: p.metadata.license ?? 'See upstream package' })),
    };
    await writeFile(resolve(stage, 'public/catalog.json'), JSON.stringify(catalog, null, 2));
    await writeFile(resolve(stage, 'mirror-lock.json'), JSON.stringify(lock, null, 2));
    await cp(resolve(work, 'script-audit.json'), resolve(stage, 'script-audit.json'));
    await generateSite(resolve(stage, 'public'));
    await rm(`${dest}.previous`, { recursive: true, force: true });
    try { await rename(dest, `${dest}.previous`); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    await rename(stage, dest);
    console.log(`Mirror ready: ${dest}. Cached != runtime verified; run the offline smoke suite.`);
  } finally { await rm(guard, { force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
