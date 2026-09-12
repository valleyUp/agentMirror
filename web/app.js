const $ = id => {
  const el = document.getElementById(id);
  if (!el) throw Error(`缺少页面元素 ${id}`);
  return el;
};
const REQUIRED_IDS = ['status', 'tool', 'version', 'platform', 'node-step', 'node-requirement', 'node-version', 'node-command-box', 'node-command', 'node-download-help', 'node-downloads', 'install-heading', 'install-help', 'command', 'install-note', 'verify-heading', 'verify', 'assets', 'resource-section'];
let catalog, base;
const names = { 'win32-x64': 'Windows x64', 'linux-x64': 'Linux x64 · glibc', 'linux-x64-musl': 'Linux x64 · musl' };

function hasPage() {
  return REQUIRED_IDS.every(id => document.getElementById(id));
}
function reloadUncached() {
  const url = new URL(location.href);
  if (url.searchParams.get('_reload') === '1') return false;
  url.searchParams.set('_reload', '1');
  location.replace(url.href);
  return true;
}
function clearReloadMarker() {
  const url = new URL(location.href);
  if (!url.searchParams.has('_reload')) return;
  url.searchParams.delete('_reload');
  history.replaceState(null, '', url.href);
}

function link(path, label) {
  const a = document.createElement('a');
  a.href = `${base}${path}`;
  a.textContent = label;
  return a;
}
function resource(parent, item) {
  const row = document.createElement('div');
  row.className = 'resource';
  row.append(link(item.path, `${item.description || ''} ${item.filename || ''}`.trim()));
  parent.append(row);
}
function npmInstall(spec, allowlist, windows) {
  const npm = windows ? 'npm.cmd' : 'npm';
  const prefix = windows ? '"$env:APPDATA\\npm"' : '"$HOME/.local"';
  const flags = [`--prefix ${prefix}`, `--registry="${base}/npm/"`, '--include=optional', '--ignore-scripts=false', '--no-audit', '--no-fund'];
  if (allowlist.length) flags.push(`--allow-scripts=${allowlist.join(',')}`);
  const pathLine = windows ? '$env:Path = "$env:APPDATA\\npm;" + $env:Path' : 'export PATH="$HOME/.local/bin:$PATH"';
  return `${npm} install -g ${spec} ${flags.join(' ')}\n${pathLine}`;
}
function refreshVersions() {
  const t = catalog.tools[$('tool').value];
  $('version').replaceChildren();
  for (const v of t.versions) {
    const label = `${v}${v === t.defaultVersion ? ' · 推荐' : ''}${v.includes('-') ? ' · 预览版' : ''}`;
    $('version').add(new Option(label, v));
  }
  $('version').value = t.defaultVersion;
  refresh();
}
function refresh() {
  const id = $('tool').value;
  const t = catalog.tools[id];
  const version = $('version').value;
  const platform = $('platform').value;
  const windows = platform === 'win32-x64';
  const nativeClaude = id === 'claude';
  $('node-step').classList.toggle('hidden', nativeClaude);
  $('node-requirement').textContent = id === 'dsh' ? 'DSH 需要 Node.js 22.19+（22.x）或 24+。已符合要求可跳过此步。' : '已有 Node.js 和 npm 可跳过此步。';
  $('install-heading').textContent = nativeClaude ? '02 / 安装' : '03 / 安装';
  $('verify-heading').textContent = nativeClaude ? '03 / 启动' : '04 / 启动';
  if (nativeClaude) {
    $('command').textContent = windows
      ? `& ([scriptblock]::Create((irm "${base}/install.ps1"))) "${version}"`
      : `curl -fsSL "${base}/install.sh" | bash -s -- "${version}"`;
    $('install-help').textContent = '按所选版本从内网安装。';
    $('install-note').textContent = '更换版本后重新运行命令即可。';
  } else {
    const allowlist = t.scriptAllowlist?.[version] ?? [];
    $('command').textContent = npmInstall(`${t.package}@${version}`, allowlist, windows);
    $('install-help').textContent = '从内网 npm 源安装所选版本。';
    $('install-note').textContent = windows ? '安装位置：%APPDATA%\\npm。' : '安装位置：~/.local（命令在 ~/.local/bin）。';
  }
  $('verify').textContent = windows && !nativeClaude ? (id === 'dsh' ? 'dsh.cmd --help\ndsh.cmd web' : 'codex.cmd --version\ncodex.cmd') : id === 'dsh' ? 'dsh --help\ndsh web' : `${id === 'claude' ? 'claude' : 'codex'} --version\n${id === 'claude' ? 'claude' : 'codex'}`;
  $('node-downloads').replaceChildren();
  for (const asset of catalog.assets.filter(asset => asset.filename.startsWith('node-') && (windows ? /win-x64|x64\.msi/.test(asset.filename) : /linux-x64/.test(asset.filename)))) resource($('node-downloads'), asset);
  $('node-command-box').classList.toggle('hidden', windows);
  $('node-download-help').textContent = windows ? '选择 MSI 安装程序，或下载 ZIP 手动配置。' : '也可下载 tar.xz 手动安装。';
  $('node-command').textContent = `curl -fsSL "${base}/install-node.sh" | bash && export PATH="$HOME/.local/bin:$PATH"`;

}
async function init() {
  if (!hasPage()) {
    if (reloadUncached()) return;
    throw Error('页面结构不完整，请强制刷新后重试');
  }
  const [catalogResponse, runtimeResponse] = await Promise.all([
    fetch('catalog.json', { cache: 'no-store' }),
    fetch('runtime.json', { cache: 'no-store' }),
  ]);
  if (!catalogResponse.ok || !runtimeResponse.ok) throw Error('镜像目录未就绪');
  catalog = await catalogResponse.json();
  const runtime = await runtimeResponse.json();
  base = (runtime.publicUrl || location.origin).replace(/\/$/, '');
  document.title = catalog.title;
  $('node-version').textContent = `Node.js ${catalog.nodeVersion}`;
  for (const platform of catalog.platforms) $('platform').add(new Option(names[platform], platform));
  if (navigator.userAgent.includes('Windows') && catalog.platforms.includes('win32-x64')) $('platform').value = 'win32-x64';
  $('status').textContent = '镜像服务已就绪';
  for (const asset of catalog.assets.filter(asset => !asset.filename.startsWith('node-'))) resource($('assets'), asset);
  if (!$('assets').children.length) $('resource-section').classList.add('hidden');
  $('tool').addEventListener('change', refreshVersions);
  $('version').addEventListener('change', refresh);
  $('platform').addEventListener('change', refresh);
  for (const button of document.querySelectorAll('[data-copy-target]')) button.addEventListener('click', async () => {
    const target = $(button.dataset.copyTarget);
    try {
      await navigator.clipboard.writeText(target.textContent);
      button.textContent = '已复制';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = '请按 Ctrl+C';
    }
  });
  refreshVersions();
  clearReloadMarker();
}
init().catch(error => {
  const status = document.getElementById('status');
  if (status) status.textContent = `无法加载镜像目录：${error.message}`;
});
