import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readlink, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/io.ts';

test('internal Claude installer downloads, verifies and activates a selected version', async () => {
  const work = await mkdtemp(join(tmpdir(), 'mirror-installer-'));
  const home = join(work, 'home');
  await mkdir(home);
  const version = '1.2.3';
  const binary = Buffer.from('#!/bin/sh\necho "1.2.3 (Claude Code)"\n');
  const checksum = createHash('sha256').update(binary).digest('hex');
  const mirror = join(work, 'claude-code-releases');
  await mkdir(join(mirror, version, 'linux-x64'), { recursive: true });
  await writeFile(join(mirror, 'latest'), `${version}\n`);
  await writeFile(join(mirror, version, 'manifest.json'), JSON.stringify({ version, platforms: { 'linux-x64': { checksum, size: binary.length } } }));
  await writeFile(join(mirror, version, 'linux-x64', 'claude'), binary);
  try {
    const template = await readFile('installers/install.sh', 'utf8');
    assert.doesNotMatch(template, /downloads\.claude\.ai|claude\.ai\/install/);
    const installer = join(work, 'install.sh');
    await writeFile(installer, template.replaceAll('__CLAUDE_MIRROR_BASE_URL__', `file://${mirror}`));
    await run('/bin/bash', [installer, version], { env: { HOME: home }, quiet: true });
    const launcher = join(home, '.local/bin/claude');
    assert.equal(await readlink(launcher), join(home, `.local/share/claude/versions/${version}`));
    assert.match(await run(launcher, ['--version'], { env: { HOME: home }, quiet: true }), /1\.2\.3/);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('Windows installer is mirror-only and keeps checksum verification', async () => {
  const script = await readFile('installers/install.ps1', 'utf8');
  assert.match(script, /__CLAUDE_MIRROR_BASE_URL__/);
  assert.match(script, /Get-FileHash/);
  assert.match(script, /\.local\\share\\claude\\versions/);
  assert.doesNotMatch(script, /downloads\.claude\.ai|claude\.ai\/install/);
});

test('Linux Node installer verifies and installs the mirrored archive in the user directory', async () => {
  const work = await mkdtemp(join(tmpdir(), 'mirror-node-installer-'));
  const home = join(work, 'home');
  const downloads = join(work, 'downloads');
  const version = '24.15.0';
  const npmVersion = '11.12.1';
  const rootName = `node-v${version}-linux-x64`;
  const archiveName = `${rootName}.tar.xz`;
  const archiveRoot = join(work, 'archive', rootName);
  try {
    await mkdir(join(archiveRoot, 'bin'), { recursive: true });
    await mkdir(join(archiveRoot, 'lib/node_modules/npm/bin'), { recursive: true });
    for (const [name, body] of [
      ['node', `#!/bin/sh
if [ "\${1:-}" = '--version' ]; then printf 'v${version}\\n'; exit; fi
shift
if [ "\${1:-}" = 'install' ]; then
  root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
  printf '%s\\n' "$*" > "$root/npm-install-args"
  exit
fi
if [ "\${1:-}" = '--version' ]; then printf '${npmVersion}\\n'; exit; fi
exit 1
`],
      ['npm', '#!/bin/sh\nprintf "npm fixture\\n"\n'],
      ['npx', '#!/bin/sh\nprintf "npx fixture\\n"\n'],
      ['corepack', '#!/bin/sh\nprintf "corepack fixture\\n"\n'],
    ]) {
      const file = join(archiveRoot, 'bin', name);
      await writeFile(file, body); await chmod(file, 0o755);
    }
    await writeFile(join(archiveRoot, 'lib/node_modules/npm/bin/npm-cli.js'), '// fixture\n');
    await mkdir(downloads);
    const archive = join(downloads, archiveName);
    await run('tar', ['-cJf', archive, '-C', join(work, 'archive'), rootName], { quiet: true });
    const checksum = createHash('sha256').update(await readFile(archive)).digest('hex');
    const template = await readFile('installers/install-node.sh', 'utf8');
    assert.doesNotMatch(template, /nodejs\.org/);
    const installer = join(work, 'install-node.sh');
    await writeFile(installer, template
      .replaceAll('__NODE_MIRROR_BASE_URL__', `file://${downloads}`)
      .replaceAll('__NODE_VERSION__', version)
      .replaceAll('__NODE_LINUX_X64_FILENAME__', archiveName)
      .replaceAll('__NODE_LINUX_X64_SHA256__', checksum));
    await mkdir(home);
    await run('/bin/sh', [installer], { env: { HOME: home }, quiet: true });
    await run('/bin/sh', [installer], { env: { HOME: home }, quiet: true });
    const target = join(home, `.local/share/node/versions/v${version}`);
    for (const name of ['node', 'npm', 'npx', 'corepack']) {
      assert.equal(await readlink(join(home, '.local/bin', name)), join(target, 'bin', name));
    }
    assert.equal((await run(join(home, '.local/bin/node'), ['--version'], { env: { HOME: home }, quiet: true })).trim(), `v${version}`);
    await assert.rejects(readFile(join(target, 'npm-install-args')), { code: 'ENOENT' });
    const profile = await readFile(join(home, '.profile'), 'utf8');
    assert.equal(profile.match(/export PATH="\$HOME\/\.local\/bin:\$PATH"/g)?.length, 1);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
