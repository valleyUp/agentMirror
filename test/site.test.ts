import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSite } from '../src/site.ts';
// @ts-ignore jsdom is used only by the DOM integration test.
import { JSDOM } from 'jsdom';

test('site renders concise native and npm install commands without release verification content', async () => {
  const html = await readFile('web/index.html', 'utf8');
  const script = await readFile('web/app.js', 'utf8');
  for (const text of ['验收', '测试报告', '运行状态', 'bundle.tar.gz', 'npm 11', 'npm 12', 'npm11', 'npm12', '无需升级', 'install-tool']) {
    assert.doesNotMatch(`${html}\n${script}`, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const catalog = {
    title: '<test mirror>', nodeVersion: '24.15.0',
    platforms: ['linux-x64', 'win32-x64'], packages: [{ name: 'fixture' }],
    tools: {
      claude: { package: '@anthropic-ai/claude-code', versions: ['2.1.265', '2.1.266'], defaultVersion: '2.1.266' },
      codex: { package: '@openai/codex', versions: ['0.153.4'], defaultVersion: '0.153.4', scriptAllowlist: { '0.153.4': [] } },
      dsh: { package: '@deepseek-ai/dsh', versions: ['0.1.2-rc.1'], defaultVersion: '0.1.2-rc.1', scriptAllowlist: { '0.1.2-rc.1': ['native-addon@1.0.0'] } },
    },
    npmPackages: [{ name: 'npm', versions: ['12.0.2'], defaultVersion: '12.0.2', description: 'required npm' }],
    assets: [
      { filename: 'node-v24.15.0-x64.msi', path: '/downloads/node-v24.15.0-x64.msi' },
      { filename: 'node-v24.15.0-win-x64.zip', path: '/downloads/node-v24.15.0-win-x64.zip' },
      { filename: 'node-v24.15.0-linux-x64.tar.xz', path: '/downloads/node-v24.15.0-linux-x64.tar.xz' },
      { filename: 'git.exe', path: '/downloads/git.exe', description: 'Git' },
    ],
  };
  const dom = new JSDOM(html, { url: 'http://mirror.internal:8080/', runScripts: 'outside-only' });
  const { window } = dom;
  const requests: string[] = [];
  window.fetch = async (path: string) => { requests.push(path); return { ok: true, json: async () => path === 'catalog.json' ? catalog : { publicUrl: '' } }; };
  try {
    window.eval(script); await new Promise(r => setImmediate(r));
    const doc = window.document;
    const choose = (id: string, value: string) => { const element = doc.getElementById(id); element.value = value; element.dispatchEvent(new window.Event('change')); };
    assert.equal(doc.title, '<test mirror>');
    assert.ok(doc.getElementById('node-requirement'));
    assert.equal(doc.getElementById('npm-major'), null);
    assert.equal(doc.getElementById('dsh-plugin-field'), null);
    assert.equal(doc.getElementById('dsh-plugin-help'), null);
    assert.equal(doc.getElementById('npm-command'), null);
    assert.match(doc.getElementById('command').textContent, /http:\/\/mirror\.internal:8080\/install\.sh/);
    assert.match(doc.getElementById('command').textContent, /2\.1\.266/);
    assert.equal(doc.getElementById('node-step').classList.contains('hidden'), true);
    choose('platform', 'win32-x64');
    assert.match(doc.getElementById('command').textContent, /install\.ps1/);
    choose('tool', 'codex');
    assert.equal(doc.getElementById('node-command-box').classList.contains('hidden'), true);
    assert.match(doc.getElementById('node-downloads').textContent, /\.msi/);
    assert.match(doc.getElementById('node-downloads').textContent, /win-x64\.zip/);
    assert.doesNotMatch(doc.getElementById('node-downloads').textContent, /linux-x64/);
    choose('platform', 'linux-x64');
    assert.equal(doc.getElementById('node-command-box').classList.contains('hidden'), false);
    assert.match(doc.getElementById('node-command').textContent, /http:\/\/mirror\.internal:8080\/install-node\.sh/);
    assert.match(doc.getElementById('node-command').textContent, /\.local\/bin/);
    assert.match(doc.getElementById('node-downloads').textContent, /linux-x64\.tar\.xz/);
    choose('tool', 'dsh');
    assert.match(doc.getElementById('command').textContent, /npm install -g @deepseek-ai\/dsh@0\.1\.2-rc\.1/);
    assert.match(doc.getElementById('command').textContent, /--prefix "\$HOME\/\.local"/);
    assert.match(doc.getElementById('command').textContent, /--registry="http:\/\/mirror\.internal:8080\/npm\/"/);
    assert.match(doc.getElementById('command').textContent, /export PATH=/);
    assert.equal(doc.getElementById('node-step').classList.contains('hidden'), false);
    assert.match(doc.getElementById('install-note').textContent, /~\/.local/);
    assert.doesNotMatch(doc.getElementById('command').textContent, /npm_major|npmMajor|pnpm|dsh-plugin|dsh plugin|install-tool/);
    assert.equal(doc.getElementById('verify').textContent, 'dsh --help\ndsh web');
    choose('tool', 'codex');
    assert.match(doc.getElementById('command').textContent, /npm install -g @openai\/codex@0\.153\.4/);
    assert.doesNotMatch(doc.getElementById('command').textContent, /pnpm|dsh plugin|install-tool/);
    choose('platform', 'win32-x64');
    choose('tool', 'dsh');
    assert.match(doc.getElementById('command').textContent, /npm\.cmd install -g @deepseek-ai\/dsh@0\.1\.2-rc\.1/);
    assert.doesNotMatch(doc.getElementById('command').textContent, /npm_major|npmMajor/);
    assert.match(doc.getElementById('command').textContent, /--allow-scripts=native-addon@1.0.0/);
    assert.deepEqual(requests.sort(), ['catalog.json', 'runtime.json']);
    for (const element of doc.querySelectorAll('script[src],link[href]')) assert.equal(new URL(element.src || element.href).origin, 'http://mirror.internal:8080');
  } finally { window.close(); }
});

test('generateSite fingerprints app.js and style.css and drops previous hashes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mirror-site-'));
  try {
    await writeFile(join(dir, 'app.deadbeefdeadbeef.js'), 'stale');
    await generateSite(dir);
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    const app = await readFile(join(dir, 'app.js'));
    const css = await readFile(join(dir, 'style.css'));
    const appHash = createHash('sha256').update(app).digest('hex').slice(0, 16);
    const cssHash = createHash('sha256').update(css).digest('hex').slice(0, 16);
    assert.match(html, new RegExp(`src="app\\.${appHash}\\.js"`));
    assert.match(html, new RegExp(`href="style\\.${cssHash}\\.css"`));
    assert.doesNotMatch(html, /src="app\.js"/);
    assert.doesNotMatch(html, /href="style\.css"/);
    const names = await readdir(dir);
    assert.ok(names.includes(`app.${appHash}.js`));
    assert.ok(names.includes(`style.${cssHash}.css`));
    assert.ok(names.includes('app.js'));
    assert.ok(!names.includes('app.deadbeefdeadbeef.js'));
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'runtime.json'), 'utf8')), { publicUrl: '' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stale cached markup reloads instead of throwing on missing nodes', async () => {
  const html = `<!doctype html><html><body><div id="status">正在读取镜像目录…</div><select id="tool"></select></body></html>`;
  const script = await readFile('web/app.js', 'utf8');
  const dom = new JSDOM(html, { url: 'http://mirror.internal:8080/', runScripts: 'outside-only' });
  try {
    dom.window.eval(`(function (location) {\n${script}\n})({ href: 'http://mirror.internal:8080/', replace(href) { globalThis.__replaced = href; } });`);
    await new Promise(r => setImmediate(r));
    assert.match(String(dom.window.__replaced || ''), /[?&]_reload=1/);
    assert.equal(dom.window.document.getElementById('status')?.textContent, '正在读取镜像目录…');
    assert.doesNotMatch(dom.window.document.getElementById('status')?.textContent || '', /无法加载|textContent|缺少页面元素/);
  } finally { dom.window.close(); }
});
