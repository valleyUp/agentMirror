#!/usr/bin/env bash
set -euo pipefail
command -v node >/dev/null || { echo '请先安装 Node.js，再运行此命令。' >&2; exit 1; }
command -v npm >/dev/null || { echo '找不到 npm，请检查 Node.js 安装和 PATH。' >&2; exit 1; }
export MIRROR_INSTALL_CONFIG='__TOOL_CONFIG_BASE64__'
node - "$@" <<'NODE'
const { spawnSync, execFileSync } = require('node:child_process');
const { mkdirSync, readFileSync, appendFileSync, existsSync, realpathSync, accessSync, constants } = require('node:fs');
const { join } = require('node:path');
function fail(message) { console.error(message); process.exit(1); }
const npmExecutable = process.env.PATH.split(':').map(dir => join(dir, 'npm')).find(file => { try { accessSync(file, constants.X_OK); return true; } catch { return false; } });
if (!npmExecutable) fail('找不到可执行的 npm。');
function output(args) { return execFileSync(npmExecutable, args, { encoding: 'utf8' }).trim(); }
const config = JSON.parse(Buffer.from(process.env.MIRROR_INSTALL_CONFIG, 'base64').toString());
const [tool, selectedVersion] = process.argv.slice(2);
if (!['dsh', 'codex'].includes(tool)) fail('用法：install-tool.sh dsh|codex [镜像内版本]');
if (process.platform !== 'linux' || process.arch !== 'x64') fail('此安装脚本仅用于 Linux x64。');
const info = config.tools[tool];
const version = selectedVersion || info.defaultVersion;
if (!info.versions.includes(version)) fail('所选版本不在镜像中，请重新从网页复制命令。');
const [major, minor] = process.versions.node.split('.').map(Number);
// DSH's published manifests omit engines; the upstream runtime floor is 22.19 / 24+.
if (tool === 'dsh' && !(major === 22 && minor >= 19 || major >= 24)) fail(`DSH 需要 Node.js 22.19+（22.x）或 24+；当前 ${process.version}。升级 npm 不能解决 Node 版本不足。`);
const home = process.env.HOME;
if (!home || home === '/') fail('HOME 必须指向用户目录。');
const prefix = join(home, '.local');
const bin = join(prefix, 'bin');
const npmVersion = output(['--version']);
const npmConfig = JSON.parse(output(['config', 'list', '--json']));
const args = ['install', '--global', '--prefix', prefix, `${info.package}@${version}`, '--registry', `${config.origin}/npm/`, '--include=optional', '--ignore-scripts=false', '--bin-links=true', '--no-audit', '--no-fund', '--update-notifier=false'];
if (Object.hasOwn(npmConfig, 'allow-scripts')) args.push(`--allow-scripts=${(info.scriptAllowlist?.[version] || []).join(',')}`);
console.log(`Node ${process.versions.node} / npm ${npmVersion}`);
console.log(`npm 默认 prefix：${npmConfig.prefix}`);
console.log(`本次安装 prefix：${prefix}；命令入口：${join(bin, tool)}`);
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
const result = spawnSync(npmExecutable, args, { stdio: 'inherit', env });
if (result.error) fail(result.error.message);
if (result.status !== 0) fail('安装失败；请先处理上方 npm 错误，再重新运行。');
const executable = join(bin, tool);
if (!existsSync(executable)) fail(`安装未生成 ${executable}，请检查 npm 的 bin-links 配置。`);
console.log(`命令指向：${realpathSync(executable)}`);
const check = spawnSync(executable, [tool === 'dsh' ? '--help' : '--version'], { env, encoding: 'utf8' });
if (check.error || check.status !== 0) fail(`命令已安装但启动失败：${check.error?.message || check.stderr || check.stdout}`);
mkdirSync(home, { recursive: true });
const line = 'export PATH="$HOME/.local/bin:$PATH"';
const profiles = ['.profile', '.bashrc', '.zshrc', ...['.bash_profile', '.bash_login'].filter(p => existsSync(join(home, p)))];
for (const name of profiles) {
  const path = join(home, name);
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (!text.split(/\r?\n/).includes(line)) appendFileSync(path, `\n# Agent Mirror: user-installed commands\n${line}\n`);
}
console.log(`安装成功：${tool} ${version}。已为 Bash/Zsh 后续终端配置 PATH。`);
console.log(`当前终端执行：${line}`);
console.log(`启动：${tool === 'dsh' ? 'dsh web' : 'codex'}`);
NODE
