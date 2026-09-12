import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import { readConfig, validateConfig, platformMatches } from '../src/config.ts';
import { binaryKind, hashFile, verifyIntegrity } from '../src/io.ts';
import { unpack, inspectManifest, requiredClaudeNative } from '../src/artifacts.ts';

test('configuration rejects floating versions, missing defaults, and unsafe asset paths', async () => {
  const c = await readConfig('mirror.yaml');
  for (const version of ['latest', '^2.0.0', 'v2.1.1']) {
    const bad = structuredClone(c); bad.tools.claude.versions = [version];
    assert.throws(() => validateConfig(bad), /exact/);
  }
  const bad = structuredClone(c); bad.tools.claude.defaultVersion = '0.0.0';
  assert.throws(() => validateConfig(bad), /defaultVersion/);
  bad.tools.claude.defaultVersion = c.tools.claude.defaultVersion;
  bad.assets = [{ id: 'evil', version: '1', filename: '../oops', url: 'https://example.invalid/a', sha256: 'a'.repeat(64), description: '' }];
  assert.throws(() => validateConfig(bad), /filename/);
  const floatingPackage = structuredClone(c); floatingPackage.npmPackages[0].versions = ['latest'];
  assert.throws(() => validateConfig(floatingPackage), /exact/);
  const duplicatePackage = structuredClone(c); duplicatePackage.npmPackages[0].name = '@openai/codex';
  assert.throws(() => validateConfig(duplicatePackage), /duplicate package/);
});
test('platform selection distinguishes glibc, musl, Windows and negated architectures', () => {
  assert.equal(platformMatches({ os: ['linux'], cpu: ['x64'], libc: ['musl'] }, 'linux-x64'), false);
  assert.equal(platformMatches({ os: ['linux'], cpu: ['x64'], libc: ['musl'] }, 'linux-x64-musl'), true);
  assert.equal(platformMatches({ os: ['win32'], cpu: ['x64'] }, 'linux-x64'), false);
  assert.equal(platformMatches({ cpu: ['!x64'] }, 'win32-x64'), false);
  assert.equal(platformMatches({}, 'linux-x64'), true);
});
test('Claude platform optional dependency is mandatory to the mirror and must match its declared version', () => {
  const root: any = { name: '@anthropic-ai/claude-code', version: '2.1.266', metadata: { optionalDependencies: { '@anthropic-ai/claude-code-win32-x64': '2.1.266' } } };
  const native: any = { name: '@anthropic-ai/claude-code-win32-x64', version: '2.1.265' };
  const lock: any = { packages: [root, native] };
  assert.throws(() => requiredClaudeNative(lock, '2.1.266', 'win32-x64'), /missing/);
  native.version = '2.1.266'; assert.equal(requiredClaudeNative(lock, '2.1.266', 'win32-x64'), native);
  assert.throws(() => requiredClaudeNative(lock, '2.1.266', 'linux-x64'), /unrecognized distribution/);
});
test('binary inspection rejects the npm placeholder and wrong machine type', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mirror-binary-'));
  try {
    const file = join(dir, 'claude.exe');
    await writeFile(file, 'echo "native binary not installed"');
    await assert.rejects(binaryKind(file), /placeholder/);
    const elf = Buffer.alloc(128); Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(elf); elf.writeUInt16LE(62, 18);
    await writeFile(file, elf); assert.equal(await binaryKind(file), 'elf-x64');
    elf.writeUInt16LE(183, 18); await writeFile(file, elf); await assert.rejects(binaryKind(file));
    const pe = Buffer.alloc(256); pe.write('MZ'); pe.writeUInt32LE(128, 0x3c); pe.write('PE\0\0', 128); pe.writeUInt16LE(0x8664, 132);
    await writeFile(file, pe); assert.equal(await binaryKind(file), 'pe-x64');
    pe.writeUInt32LE(10000, 0x3c); await writeFile(file, pe); await assert.rejects(binaryKind(file));
  } finally { await rm(dir, { recursive: true }); }
});
test('integrity detects tampering and refuses SHA-1-only metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mirror-hash-')); const file = join(dir, 'a');
  try {
    await writeFile(file, 'original'); const integrity = `sha512-${await hashFile(file, 'sha512', 'base64')}`;
    await verifyIntegrity(file, integrity); await writeFile(file, 'changed');
    await assert.rejects(verifyIntegrity(file, integrity), /mismatch/);
    await assert.rejects(verifyIntegrity(file, 'sha1-deadbeef'), /Strong/);
  } finally { await rm(dir, { recursive: true }); }
});
test('archive extraction refuses links escaping the package', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mirror-tar-'));
  try {
    await mkdir(join(dir, 'package')); await writeFile(join(dir, 'package/data'), 'okay');
    const { symlink } = await import('node:fs/promises'); await symlink('/etc/passwd', join(dir, 'package/escape'));
    const file = join(dir, 'bad.tgz'); await tar.c({ file, cwd: dir, gzip: true }, ['package']);
    await assert.rejects(unpack(file, join(dir, 'out')), /Unsafe/);
  } finally { await rm(dir, { recursive: true }); }
});
test('legacy npm tarball root is normalized and its lifecycle manifest is inspected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mirror-legacy-tar-'));
  try {
    await mkdir(join(dir, 'legacy-root'));
    const manifest = { name: '@types/fixture', version: '1.0.0', description: '中文说明', scripts: { postinstall: 'node install.js' } };
    await writeFile(join(dir, 'legacy-root/package.json'), JSON.stringify(manifest));
    const file = join(dir, 'legacy.tgz'); await tar.c({ file, cwd: dir, gzip: true }, ['legacy-root']);
    assert.deepEqual((await inspectManifest(file)).manifest, manifest);
    await unpack(file, join(dir, 'out'));
    const { readFile } = await import('node:fs/promises');
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'out/package/package.json'), 'utf8')), manifest);
  } finally { await rm(dir, { recursive: true }); }
});
