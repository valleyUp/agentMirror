import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { stringify } from 'yaml';
import { json } from './io.ts';
import type { PackageRecord } from './resolve.ts';

export async function startRegistry(work: string, storage: string, port: number): Promise<{ process: ChildProcess; url: string; token: string }> {
  await mkdir(storage, { recursive: true });
  const config = resolve(work, 'verdaccio-build.yaml');
  await writeFile(config, stringify({
    storage, auth: { htpasswd: { file: resolve(work, 'build.htpasswd'), max_users: 1 } },
    uplinks: {}, packages: { '**': { access: '$all', publish: '$authenticated', unpublish: '$authenticated' } },
    log: { type: 'stdout', format: 'json', level: 'error' }, web: { enable: false },
    max_body_size: '2gb', server: { keepAliveTimeout: 300 },
  }));
  const p = spawn(process.execPath, [resolve('node_modules/verdaccio/bin/verdaccio'), '-c', config, '-l', `127.0.0.1:${port}`], { stdio: ['ignore', 'ignore', 'inherit'] });
  const url = `http://127.0.0.1:${port}/`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (p.exitCode !== null) throw Error('Build registry exited');
    try { await json(`${url}-/ping`); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!ready) { p.kill(); throw Error('Build registry did not become ready'); }
  const password = randomBytes(24).toString('hex');
  try {
    const result = await json(`${url}-/user/org.couchdb.user:mirror-builder`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'mirror-builder', password }) });
    return { process: p, url, token: result.token };
  } catch (e) { p.kill(); throw e; }
}

// The npm publication protocol imports original tarball bytes. No repacking,
// lifecycle execution, upstream proxy, or hand-written Verdaccio storage format.
export async function importPackage(url: string, token: string, pkg: PackageRecord, tarball: string) {
  const encoded = pkg.name.replace('/', '%2f');
  const filename = `${pkg.name.split('/').at(-1)}-${pkg.version}.tgz`;
  const data = await readFile(tarball);
  const metadata = { ...pkg.metadata, _id: `${pkg.name}@${pkg.version}`, dist: {
    ...pkg.metadata.dist, tarball: `${url}${pkg.name}/-/${filename}`,
  } };
  // Registry signatures refer to the upstream registry identity, not this mirror.
  delete metadata.dist.signatures;
  delete metadata.dist.attestations;
  const body = {
    _id: pkg.name, name: pkg.name, description: metadata.description ?? '',
    'dist-tags': { mirrored: pkg.version }, versions: { [pkg.version]: metadata },
    _attachments: { [filename]: { content_type: 'application/octet-stream', data: data.toString('base64'), length: data.length } },
  };
  await json(`${url}${encoded}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
export async function setTag(url: string, token: string, name: string, version: string) {
  await json(`${url}-/package/${name.replace('/', '%2f')}/dist-tags/latest`, {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(version),
  });
}
