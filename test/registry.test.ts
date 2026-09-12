import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import * as tar from 'tar';
import { startRegistry, importPackage, setTag } from '../src/registry.ts';
import { hashFile, json, run } from '../src/io.ts';

test('offline registry preserves tarballs, multiple versions, npm aliases and lifecycle installation', { timeout: 120_000 }, async () => {
  const work = await mkdtemp(join(tmpdir(), 'mirror-registry-'));
  const port = await new Promise<number>(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => r(p)); }); });
  const registry = await startRegistry(work, join(work, 'storage'), port);
  try {
    async function publish(version: string, extra: any = {}, files: Record<string, string> = {}) {
      const dir = join(work, version); await mkdir(join(dir, 'package'), { recursive: true });
      const metadata = { name: '@mirror/fixture', version, ...extra };
      await writeFile(join(dir, 'package/package.json'), JSON.stringify(metadata));
      for (const [name, value] of Object.entries(files)) await writeFile(join(dir, 'package', name), value);
      const file = join(dir, 'package.tgz'); await tar.c({ file, cwd: dir, gzip: true }, ['package']);
      const integrity = `sha512-${await hashFile(file, 'sha512', 'base64')}`;
      await importPackage(registry.url, registry.token, { name: metadata.name, version, metadata: { ...metadata, dist: { integrity } }, integrity, url: '' }, file);
      return { file, integrity };
    }
    const native = await publish('1.0.0-linux-x64', {}, { 'native.txt': 'native payload' });
    await publish('1.0.0', { optionalDependencies: { '@mirror/native': 'npm:@mirror/fixture@1.0.0-linux-x64' }, scripts: { postinstall: 'node install.cjs' } }, {
      'install.cjs': "require('fs').writeFileSync('ready.txt',require('fs').readFileSync(require.resolve('@mirror/native/native.txt')))",
    });
    await publish('2.0.0');
    await setTag(registry.url, registry.token, '@mirror/fixture', '1.0.0');
    const meta = await json(`${registry.url}@mirror%2ffixture`);
    assert.equal(meta['dist-tags'].latest, '1.0.0'); assert.equal(Object.keys(meta.versions).length, 3);
    const r = await fetch(meta.versions['1.0.0-linux-x64'].dist.tarball);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), await readFile(native.file));
    const client = join(work, 'client'); await mkdir(client);
    await writeFile(join(client, 'package.json'), JSON.stringify({ name: 'test-client', version: '1.0.0', private: true, allowScripts: { '@mirror/fixture@1.0.0': true } }));
    const userConfig = join(client, 'npmrc'); await writeFile(userConfig, '');
    const globalConfig = join(client, 'global.npmrc'); await writeFile(globalConfig, '');
    await run('npm', ['install', '--prefix', client, '@mirror/fixture@1.0.0', '--registry', registry.url, '--include=optional', '--ignore-scripts=false', '--foreground-scripts', '--no-audit', '--no-fund'], { cwd: client, env: { npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_cache: join(client, 'cache') } });
    assert.equal(await readFile(join(client, 'node_modules/@mirror/fixture/ready.txt'), 'utf8'), 'native payload');
    assert.equal((await fetch(`${registry.url}missing-package`)).status, 404);
  } finally {
    const stopped = new Promise<void>(r => registry.process.once('exit', () => r())); registry.process.kill(); await stopped;
    await rm(work, { recursive: true, force: true });
  }
});
