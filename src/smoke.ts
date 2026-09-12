import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { binaryKind, hashFile, json, run } from './io.ts';

// Run on each actual target OS with egress blocked and fresh cache/config/home.
async function main() {
  const base = (process.env.MIRROR_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
  const header = (process.report.getReport() as any).header;
  const platform = process.platform === 'win32' ? 'win32-x64' : header.glibcVersionRuntime ? 'linux-x64' : 'linux-x64-musl';
  if (process.arch !== 'x64') throw Error('Smoke requires x64 Node.js');
  if (process.env.MIRROR_NETWORK_ISOLATED !== '1') throw Error('Run with egress blocked, then set MIRROR_NETWORK_ISOLATED=1; see scripts/test-offline.sh');
  for (const url of ['https://registry.npmjs.org/', 'https://downloads.claude.ai/']) {
    let reachable = false;
    try { await fetch(url, { signal: AbortSignal.timeout(3000) }); reachable = true; } catch { /* expected */ }
    if (reachable) throw Error(`External network is reachable: ${url}`);
  }
  const catalog = await json(`${base}/catalog.json`);
  const npmVersion = (await run('npm', ['--version'], { quiet: true })).trim();
  const npmConfig = JSON.parse(await run('npm', ['config', 'list', '--json'], { quiet: true }));
  const supportsScriptPolicy = Object.hasOwn(npmConfig, 'allow-scripts');
  if (!catalog.platforms.includes(platform)) throw Error(`Platform not included: ${platform}`);
  // Codex deliberately refuses helper installation under system /tmp.
  // Use an isolated directory under the client's own home instead.
  const work = await mkdtemp(join(homedir(), 'agent-mirror-smoke-'));
  let environment = process.platform;
  if (process.platform === 'linux') environment = await readFile('/etc/os-release', 'utf8').then(t => t.match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] ?? 'linux').catch(() => 'linux') as any;
  const report: any = { platform, environment, node: process.version, npm: npmVersion, at: new Date().toISOString(), build: catalog.builtAt, results: [], externalFetchBlocked: true, interactiveAuthentication: 'not tested', modelCalls: 'not tested' };
  const installations = new Map<string, { dir: string; prefix: string; env: NodeJS.ProcessEnv }>();
  try {
    for (const [tool, info] of Object.entries(catalog.tools) as [string, any][]) for (const version of info.versions) {
      const dir = join(work, tool, version), home = join(dir, 'home');
      await mkdir(home, { recursive: true });
      const config = join(dir, 'npmrc'); await writeFile(config, '');
      const globalConfig = join(dir, 'global.npmrc'); await writeFile(globalConfig, '');
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, npm_config_userconfig: config, npm_config_globalconfig: globalConfig, npm_config_cache: join(dir, 'cache'), DISABLE_AUTOUPDATER: '1' };
      console.log(`Offline install ${info.package}@${version}`);
      const prefix = join(dir, 'install');
      installations.set(tool, { dir, prefix, env });
      const allowlist = info.scriptAllowlist?.[version] ?? catalog.installScriptAllowlist ?? [];
      const policy = supportsScriptPolicy && allowlist.length ? [`--allow-scripts=${allowlist.join(',')}`] : [];
      await run('npm', ['install', '--global', '--prefix', prefix, `${info.package}@${version}`, '--registry', `${base}/npm/`, '--include=optional', '--ignore-scripts=false', ...policy, '--no-audit', '--no-fund'], { cwd: dir, env });
      const packageDir = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', info.package);
      const meta = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
      if (meta.version !== version) throw Error(`Wrong installed version: ${meta.version}`);
      const executable = join(packageDir, Object.values(meta.bin)[0] as string);
      if (process.platform !== 'win32') await run(join(prefix, 'bin', tool === 'claude' ? 'claude' : tool === 'codex' ? 'codex' : 'dsh'), [tool === 'dsh' ? '--help' : '--version'], { env, quiet: true, timeout: 60_000 });
      if (tool === 'claude') {
        await binaryKind(executable);
        const expected = catalog.natives.find((n: any) => n.version === version && n.platform === platform);
        if (!expected || await hashFile(executable) !== expected.sha256) throw Error('Installed claude is not the catalog native executable');
        const output = await run(executable, ['--version'], { env, timeout: 60_000 });
        if (!output.includes(version)) throw Error('Claude binary version mismatch');
        await run(executable, ['--help'], { env, timeout: 60_000, quiet: true });
        const response = await fetch(`${base}${expected.path}${expected.executable}`);
        if (!response.ok) throw Error('Native binary unavailable');
        const binary = join(dir, expected.executable); await writeFile(binary, Buffer.from(await response.arrayBuffer())); await chmod(binary, 0o755);
        if (await hashFile(binary) !== expected.sha256) throw Error('Native download checksum mismatch');
        await run(binary, ['--version'], { env, timeout: 60_000 });
      } else {
        const output = await run(process.execPath, [executable, tool === 'codex' ? '--version' : '--help'], { env, timeout: 60_000 });
        if (tool === 'codex' && !output.includes(version)) throw Error('Codex native version mismatch');
        if (tool === 'dsh') {
          // Exercise native dependencies, not just a JS --help entry point.
          const nativeCheck = join(dir, 'native-check.cjs');
          await writeFile(nativeCheck, `
const req = require('node:module').createRequire(${JSON.stringify(join(packageDir, 'package.json'))});
req('koffi');
const sharp = req('sharp');
const pty = req('node-pty');
const child = pty.spawn(process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh', process.platform === 'win32' ? ['/d', '/c', 'echo mirror-pty-ok'] : ['-c', 'printf mirror-pty-ok'], { env: process.env });
let text = '';
const timer = setTimeout(() => { child.kill(); process.exit(1); }, 10000);
child.onData(data => { text += data; });
child.onExit(async () => {
  clearTimeout(timer);
  if (!text.includes('mirror-pty-ok')) { console.error(text); process.exit(1); }
  try { await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toBuffer(); console.log('native dependencies passed'); }
  catch (e) { console.error(e); process.exit(1); }
});
`);
          await run(process.execPath, [nativeCheck], { env, timeout: 30_000 });
          const child = spawn(process.execPath, [executable, 'web', '--no-open'], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] });
          let output = '', uiUrl = 'http://127.0.0.1:3080/';
          child.stdout.on('data', data => {
            output += data.toString();
            // DSH prints a local session token; use it for the check without
            // exposing it in logs or reports.
            const match = output.match(/http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+/);
            if (match) uiUrl = match[0];
          });
          child.stderr.on('data', data => process.stderr.write(data.toString().replace(/token=[^\s]+/g, 'token=[redacted]')));
          try {
            let ready = false;
            for (let i = 0; i < 90; i++) {
              if (child.exitCode !== null) throw Error('dsh web exited before readiness');
              try {
                // Node fetch has no browser cookie jar. DSH exchanges its
                // launch token for a session cookie before serving the index.
                let r = await fetch(uiUrl, { redirect: 'manual', signal: AbortSignal.timeout(1000) });
                if ([302, 303, 307].includes(r.status)) {
                  const cookie = r.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
                  r = await fetch('http://127.0.0.1:3080/', { headers: { cookie }, signal: AbortSignal.timeout(1000) });
                }
                if (r.ok && (await r.text()).includes('<html')) { ready = true; break; }
              } catch { /* starting */ }
              await new Promise(r => setTimeout(r, 500));
            }
            if (!ready) throw Error('dsh web not ready after 45 seconds');
          } finally { child.kill('SIGTERM'); await new Promise<void>(r => { const timer = setTimeout(() => { child.kill('SIGKILL'); r(); }, 5000); child.once('exit', () => { clearTimeout(timer); r(); }); }); }
        }
      }
      report.results.push({ tool, version, install: 'pass', launch: 'pass', nativeDownload: tool === 'claude' ? 'pass' : 'not applicable' });
    }
    report.packageResults = [];
    for (const [kind, entries] of [['npm-package', catalog.npmPackages ?? []]] as [string, any[]][]) {
      for (const entry of entries) for (const version of entry.versions) {
        const key = entry.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const dir = join(work, 'packages', kind, key, version), home = join(dir, 'home');
        await mkdir(home, { recursive: true });
        const config = join(dir, 'npmrc'); await writeFile(config, '');
        const globalConfig = join(dir, 'global.npmrc'); await writeFile(globalConfig, '');
        const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, npm_config_userconfig: config, npm_config_globalconfig: globalConfig, npm_config_cache: join(dir, 'cache') };
        const prefix = join(dir, 'install');
        const allowlist = catalog.installScriptAllowlist ?? [];
        const policy = supportsScriptPolicy && allowlist.length ? [`--allow-scripts=${allowlist.join(',')}`] : [];
        console.log(`Offline install ${kind} ${entry.name}@${version}`);
        await run('npm', ['install', '--global', '--prefix', prefix, `${entry.name}@${version}`, '--registry', `${base}/npm/`, '--include=optional', '--ignore-scripts=false', ...policy, '--no-audit', '--no-fund'], { cwd: dir, env });
        const packageDir = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', entry.name);
        const meta = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
        if (meta.version !== version) throw Error(`Wrong installed package version: ${entry.name}@${meta.version}`);
        let launch = 'not applicable';
        if (entry.name === 'npm') {
          const executable = join(packageDir, meta.bin.npm);
          const output = await run(executable, ['--version'], { env, quiet: true, timeout: 60_000 });
          if (!output.includes(version)) throw Error(`npm version mismatch: ${output.trim()}`);
          launch = 'pass';
        }
        report.packageResults.push({ kind, name: entry.name, version, install: 'pass', launch });
      }
    }
    report.transitions = [];
    for (const [tool, info] of Object.entries(catalog.tools) as [string, any][]) {
      if (info.versions.length < 2) continue;
      const { dir, prefix, env } = installations.get(tool)!;
      for (const version of [info.versions[0], info.versions.at(-1)]) {
        console.log(`Switch ${info.package} to ${version}`);
        const allowlist = info.scriptAllowlist?.[version] ?? catalog.installScriptAllowlist ?? [];
        const policy = supportsScriptPolicy && allowlist.length ? [`--allow-scripts=${allowlist.join(',')}`] : [];
        await run('npm', ['install', '--global', '--prefix', prefix, `${info.package}@${version}`, '--registry', `${base}/npm/`, '--include=optional', '--ignore-scripts=false', ...policy, '--no-audit', '--no-fund'], { cwd: dir, env, quiet: true });
        const packageDir = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', info.package);
        const meta = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
        if (meta.version !== version) throw Error(`Version switch failed: ${tool}`);
        const executable = join(packageDir, Object.values(meta.bin)[0] as string);
        if (tool === 'claude') {
          const expected = catalog.natives.find((n: any) => n.version === version && n.platform === platform);
          if (await hashFile(executable) !== expected.sha256) throw Error('Stale Claude native binary after version switch');
          await run(executable, ['--version'], { env, quiet: true, timeout: 60_000 });
        } else await run(process.execPath, [executable, tool === 'dsh' ? '--help' : '--version'], { env, quiet: true, timeout: 60_000 });
        report.transitions.push({ tool, version, status: 'pass' });
      }
    }
    const missing = await fetch(`${base}/npm/mirror-nonexistent-package-404`);
    if (missing.status !== 404) throw Error('Missing package must return 404');
    const mutation = await fetch(`${base}/npm/test`, { method: 'PUT', body: '{}' });
    if (![403, 405].includes(mutation.status)) throw Error('Registry write endpoint is not blocked');
    report.status = 'pass';
  } catch (e) { report.status = 'fail'; report.error = String(e); throw e; }
  finally {
    const output = resolve(process.env.MIRROR_REPORT ?? `smoke-${platform}.json`);
    await writeFile(output, JSON.stringify(report, null, 2)); console.log(`Report: ${output}`);
    await rm(work, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
