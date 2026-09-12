import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyLatest, applyRemoval, fetchLatest, planLatest } from '../src/tool-versions.ts';
import { readConfig } from '../src/config.ts';

const fixture = `schemaVersion: 1
site:
  title: test
registry: https://registry.npmjs.org/
platforms:
  - linux-x64
# keep this comment
tools:
  claude:
    versions: [2.1.266]
    defaultVersion: 2.1.266
  codex:
    versions: [0.153.3, 0.153.4]
    defaultVersion: 0.153.4
  dsh:
    versions: [0.1.2-alpha.5, 0.1.2-rc.1]
    defaultVersion: 0.1.2-rc.1
npmPackages: []
node:
  version: 24.15.0
assets: []
approvedScripts: {}
`;

const fetchJson = async (url: string) => {
  if (url.includes('@openai%2fcodex') || url.endsWith('/@openai/codex')) return { 'dist-tags': { latest: '0.154.0' }, versions: { '0.154.0': {} } };
  if (url.includes('@deepseek-ai%2fdsh')) return { 'dist-tags': { latest: '0.1.5-rc.1' }, versions: { '0.1.5-rc.1': {} } };
  throw Error(url);
};

test('fetchLatest requires dist-tag latest to exist in packument versions', async () => {
  await assert.rejects(
    fetchLatest('@openai/codex', 'https://registry.npmjs.org/', async () => ({ 'dist-tags': { latest: '0.154.0' } })),
    /missing from the packument versions list/,
  );
  assert.equal(
    await fetchLatest('@openai/codex', 'https://registry.npmjs.org/', async () => ({
      'dist-tags': { latest: '0.154.0' },
      versions: { '0.154.0': {} },
    })),
    '0.154.0',
  );
});

test('add-latest appends registry latest and keeps existing versions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mirror-versions-'));
  const file = join(dir, 'mirror.yaml');
  try {
    await writeFile(file, fixture);
    const plans = await planLatest(file, ['codex', 'dsh'], fetchJson);
    assert.equal(plans.find(p => p.tool === 'codex')?.latest, '0.154.0');
    assert.equal(plans.find(p => p.tool === 'dsh')?.added, true);
    const dry = await applyLatest(file, plans, true);
    assert.equal(dry.written, false);
    assert.equal((await readFile(file, 'utf8')), fixture);
    const applied = await applyLatest(file, plans, false);
    assert.equal(applied.written, true);
    const config = await readConfig(file);
    assert.deepEqual(config.tools.codex.versions, ['0.153.3', '0.153.4', '0.154.0']);
    assert.equal(config.tools.codex.defaultVersion, '0.154.0');
    assert.deepEqual(config.tools.dsh.versions, ['0.1.2-alpha.5', '0.1.2-rc.1', '0.1.5-rc.1']);
    assert.equal(config.tools.dsh.defaultVersion, '0.1.5-rc.1');
    assert.deepEqual(config.tools.claude.versions, ['2.1.266']);
    assert.match(await readFile(file, 'utf8'), /keep this comment/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('remove-version only drops versions that are requested explicitly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mirror-remove-'));
  const file = join(dir, 'mirror.yaml');
  try {
    await writeFile(file, fixture);
    await assert.rejects(applyRemoval(file, 'dsh', ['0.1.2-alpha.5', '0.1.2-rc.1']), /last dsh version/);
    const dry = await applyRemoval(file, 'dsh', ['0.1.2-alpha.5'], undefined, true);
    assert.equal(dry.written, false);
    assert.deepEqual((await readConfig(file)).tools.dsh.versions, ['0.1.2-alpha.5', '0.1.2-rc.1']);
    const removed = await applyRemoval(file, 'dsh', ['0.1.2-alpha.5']);
    assert.equal(removed.written, true);
    const config = await readConfig(file);
    assert.deepEqual(config.tools.dsh.versions, ['0.1.2-rc.1']);
    assert.equal(config.tools.dsh.defaultVersion, '0.1.2-rc.1');
    assert.deepEqual(config.tools.codex.versions, ['0.153.3', '0.153.4']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
