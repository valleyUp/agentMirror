import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (failure === undefined) {
      const i = next++;
      if (i >= items.length) return;
      try { results[i] = await fn(items[i]); } catch (e) { failure = e; }
    }
  }));
  if (failure !== undefined) throw failure;
  return results;
}
export async function json(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000), ...init });
  if (!response.ok) throw Error(`${response.status} ${url}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}
export async function hashFile(path: string, algorithm = 'sha256', encoding: 'hex' | 'base64' = 'hex') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest(encoding);
}
export async function verifyIntegrity(path: string, integrity: string) {
  const tokens = integrity.split(/\s+/).map(x => x.split('-'));
  const algorithm = ['sha512', 'sha384', 'sha256'].find(a => tokens.some(t => t[0] === a));
  if (!algorithm) throw Error(`Strong integrity required: ${path}`);
  const actual = await hashFile(path, algorithm, 'base64');
  if (!tokens.some(([a, d]) => a === algorithm && d === actual)) throw Error(`Integrity mismatch: ${path}`);
}
export async function download(url: string, dest: string, integrity: string) {
  try { await verifyIntegrity(dest, integrity); return; } catch { /* download or replace invalid cache */ }
  if (new URL(url).protocol !== 'https:') throw Error(`HTTPS required: ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(600_000) });
      if (!r.ok || !r.body) throw Error(`Download ${r.status}: ${url}`);
      await pipeline(Readable.fromWeb(r.body as any), createWriteStream(`${dest}.part`));
      await verifyIntegrity(`${dest}.part`, integrity);
      await rename(`${dest}.part`, dest); return;
    } catch (err) {
      await rm(`${dest}.part`, { force: true });
      if (attempt === 2) throw err;
    }
  }
}
export async function run(cmd: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean; timeout?: number } = {}) {
  if (cmd === 'npm' && process.env.MIRROR_NPM_CLI) {
    args = [process.env.MIRROR_NPM_CLI, ...args]; cmd = process.execPath;
  } else if (cmd === 'npm' && process.platform === 'win32') {
    const cli = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (!existsSync(cli)) throw Error('Cannot locate npm-cli.js; invoke through npm run smoke');
    cmd = process.execPath; args = [cli, ...args];
  }
  return new Promise<string>((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    p.stdout.on('data', b => { output += b; if (!options.quiet) process.stdout.write(b); });
    p.stderr.on('data', b => { output += b; if (!options.quiet) process.stderr.write(b); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(Error(`${cmd} timed out`)); }, options.timeout ?? 600_000);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(Error(`${cmd} exited ${code}\n${output.slice(-5000)}`)); });
  });
}
export async function binaryKind(file: string): Promise<'elf-x64' | 'pe-x64'> {
  const b = await readFile(file);
  if (b.length > 64 && b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && b[4] === 2 && b[5] === 1 && b.readUInt16LE(18) === 62) return 'elf-x64';
  if (b.length > 64 && b.subarray(0, 2).toString() === 'MZ') {
    const offset = b.readUInt32LE(0x3c);
    if (offset + 6 <= b.length && b.subarray(offset, offset + 4).equals(Buffer.from('PE\0\0')) && b.readUInt16LE(offset + 4) === 0x8664) return 'pe-x64';
  }
  throw Error(`Not an x86_64 native executable (possibly a placeholder): ${file}`);
}
