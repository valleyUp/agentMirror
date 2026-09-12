# Windows 7 上使用 DSH / Codex 的可行方案

2026-09-11。结论先说：**不要在 Windows 7 本机安装或运行当前镜像里的 DeepSeek Harness、Codex CLI。** 把 Win7 当成瘦客户端，在受支持的 Linux 或 Windows 10 1809+ / Windows 11 主机上安装工具，远程使用。

这不是安装参数问题，也不是换 Node 17 能绕开的。Win7 缺的是这些工具已经依赖的操作系统 API。

## 1. 为什么本机安装不可行

### 1.1 Node.js 官方已经不支持 Win7

| Node 版本 | 官方 Windows 下限 | 来源 |
| --- | --- | --- |
| 12.x / 13.x（文档表） | Windows 7 / Server 2008 R2 | [BUILDING.md v13.14.0](https://github.com/nodejs/node/blob/v13.14.0/BUILDING.md) |
| 14.0.0 起 | 启动即检查 `IsWindows8Point1OrGreater()`；Win7/8 视为 EOL | [Node 14.0.0 说明](https://nodejs.org/en/blog/release/v14.0.0) |
| 17.9.1 | Windows 8.1 / Server 2012 R2 | [BUILDING.md v17.9.1](https://github.com/nodejs/node/blob/v17.9.1/BUILDING.md) |
| 22.x | 文档 Tier 1 为 Windows 10 / Server 2016；启动仍按 8.1 门禁 | [BUILDING.md v22.x](https://github.com/nodejs/node/blob/v22.x/BUILDING.md) |
| 24.x（镜像内 24.15.0） | Windows 10 / Server 2016（`IsWindows10OrGreater()`） | [BUILDING.md 当前](https://github.com/nodejs/node/blob/main/BUILDING.md) |

文档表里 13.14.0 仍写 Win7，但 Node 构建组最后在 Win7 / 2008 R2 上测过的构建是 13.6.0、12.14.1、10.18.1。`NODE_SKIP_PLATFORM_CHECK=1`（14.5.0 引入）只跳过启动检查，官方写明不保证能跑、也不修不受支持平台上的问题。社区 Win7 移植最高到 Node 20 左右，补不出 DSH 要的 Node 22.19/24 内建模块，更补不出 ConPTY。

DSH 当前运行时下限是 Node 22.19+（22.x）或 24+。这条线从 Node 14 起官方就不支持 Win7。

### 1.2 当前 DSH 依赖的是 Win10 能力，不是 Win7 能装的 Node

镜像缓存的 `@deepseek-ai/dsh@0.1.2-rc.1` 顶层 `package.json` 没有 `engines`，不能据此判断兼容老系统。实际闭包里：

| 组件 | 镜像中的版本 | 对 Win7 的阻碍 |
| --- | --- | --- |
| commander | 15.0.0，`engines.node >= 22.12.0` | CLI 入口在 Node 17 上不被承诺 |
| undici | 8.10.2，`engines.node >= 22.19.0` | HTTP 栈要求 Node 22.19+ |
| sharp | 0.35.4，`engines.node >= 20.9.0` | 预编译原生模块针对新 Node |
| node-pty | 1.2.0-beta.15 | README：**已移除 winpty**；Windows 走 ConPTY，要求 **Windows 10 1809+**。包内只有 `win10-x64` / `win10-arm64` 的 `conpty.dll` |
| node:sqlite（dsh-session-query-sqlite） | 按需 `import 'node:sqlite'` | Node 17 没有该内建模块 |
| Promise.withResolvers | dsh-subprocess-local 发布后的 JS | Node 17 没有该 API |

ConPTY 的系统 API `CreatePseudoConsole` 最低客户端是 **Windows 10 2018 年 10 月更新（1809）**，最低服务器是 Windows Server 2019。[Microsoft 文档](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)。Win7 没有这个 API。把 node-pty 换成旧 winpty 并重编整条依赖链，等于维护一份功能残缺的分叉，不是镜像配置能解决的。

### 1.3 Codex 官方 Windows 矩阵里没有 Win7

`@openai/codex` 的 npm 包装声明 `engines.node >= 16`，真正干活的是平台原生二进制（镜像内有 `@openai/codex-win32-x64`）。包装器的 Node 下限不能代表操作系统下限。

OpenAI 当前 Windows 说明（[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)）：

| Windows 版本 | 官方态度 |
| --- | --- |
| Windows 11 | 推荐 |
| 已更新的 Windows 10 | 尽力支持；依赖现代控制台，**实际要求 1809+（ConPTY）** |
| 更旧的 Windows 10 | 不推荐 |
| Windows 7 | 未列入 |

另外：推荐安装路径用 WinGet（官方只支持 Windows 10 1809+ / Windows 11）；原生沙箱依赖本机用户、防火墙和 ACL，都是 Win10/11 模型。WSL2 最低是 Windows 10 1903（build 18362.1049+），Win7 完全没有 WSL。Codex 从 0.115 起也不支持 WSL1。Docker Desktop 同样不支持 Win7。

### 1.4 Win7 上连配套工具都已停更

| 软件 | Win7 最后版本 | 说明 |
| --- | --- | --- |
| Git for Windows | **2.46.2**（FAQ：2.47.0 起放弃 Win7/8） | [Git for Windows FAQ](https://github.com/git-for-windows/git/wiki/FAQ) |
| VS Code | **1.70.3**（1.71 起不再运行） | [VS Code FAQ](https://code.visualstudio.com/docs/supporting/faq) |
| Chrome | **109**（110 起要求 Win10） | [Chrome 企业系统要求](https://support.google.com/chrome/a/answer/7100626) |

DSH 的 `dsh web` 是现代前端。Win7 上冻结在 Chrome 109 / 旧 IE，不能当作受支持的 Web UI 客户端。VS Code 1.70 也装不上现在的 Remote-SSH 扩展。

## 2. 明确放弃的做法

1. 在 Win7 上 `npm install -g @deepseek-ai/dsh` 或 `@openai/codex`。
2. 用 Node 13 官方包，或 `NODE_SKIP_PLATFORM_CHECK` 硬跑 Node 14/18/22。
3. 为 Win7 维护 DSH/Codex 兼容分叉。
4. 指望 WSL、Docker Desktop、winget、官方 Node 24 安装包。
5. 把 Win7 本机磁盘当成 Agent 工作区（远程方案也不会自动获得本机文件访问）。

## 3. 最佳实践：Win7 只做入口，Agent 跑在受支持主机上

原则：

- **安装、进程、模型调用、仓库写入全部发生在远程主机。**
- Win7 只负责键盘、显示器和拷贝命令。
- 远程主机从本内网镜像安装，不访问公网 npm。

### 3.1 远程主机怎么选（按优先级）

1. **Ubuntu 22.04/24.04 x64**（或 Debian 12/13、Rocky 9）：与镜像主验收环境一致，SSH 最简单。DSH、Codex、Claude 都装在这里。
2. **Windows 11 x64**：Codex 官方推荐；DSH 需要 Node 22.19+/24+。用远程桌面从 Win7 连过去。
3. **已打满补丁的 Windows 10 22H2（1809 以上）**：Codex 官方为尽力支持；DSH 的 node-pty 要求同样是 1809+。

一台 2 核 8 GB、能访问内网镜像（例如 `http://部署机:8083`）的虚机即可。多用户可每人一个账号，或每人一台小虚机。

### 3.2 在远程主机上安装（内网镜像）

在 **远程主机** 打开镜像首页，复制页面上的命令。不要在 Win7 上执行这些命令。

Linux 主机示例（版本以页面为准）：

```bash
# 如无 Node.js
curl -fsSL "http://镜像地址/install-node.sh" | bash && export PATH="$HOME/.local/bin:$PATH"

npm install -g @deepseek-ai/dsh@0.1.2-rc.1 --prefix "$HOME/.local" \
  --registry="http://镜像地址/npm/" --include=optional --ignore-scripts=false --no-audit --no-fund
export PATH="$HOME/.local/bin:$PATH"
dsh --help
dsh web
```

Codex 同样从页面复制 `npm install -g @openai/codex@…`。Claude Code 用页面的 `install.sh` / `install.ps1`。

模型地址和凭据按公司配置写在远程主机用户目录，不要写到 Win7。

### 3.3 Win7 如何连上去

| 需求 | 推荐 | 不推荐 |
| --- | --- | --- |
| 日常终端（Linux 主机） | **WinSCP** 内置终端，或 **MobaXterm** 打开 SSH，会话里跑 `dsh` / `codex` | 指望 2026 年的 PuTTY 官方保证 Win7；Win7 本机装 npm 包 |
| 传文件 | **WinSCP**（仍写明支持 Windows 7 SP1，含便携版） | 把仓库只放在 Win7 再指望 Agent 读写 |
| 图形界面 / `dsh web` | **远程桌面** 连 Windows 10/11 主机，在那边用现代浏览器打开 | 把 `dsh web` 端口转到 Win7 的 Chrome 109 / Edge 109 |
| 长期会话 | 远程 Linux 上 `tmux`/`screen`，断线不丢 | 依赖 Win7 睡眠唤醒 |
| 编辑代码 | 在远程主机用 vim/nano，或 RDP 进 Win10/11 用新版 VS Code | VS Code 1.70.3 + 现网 Remote-SSH（扩展要求新客户端；Remote-SSH 也不走 PuTTY） |

WinSCP 的技术要求仍列出 Windows 7/2008 到 Windows 11。[WinSCP requirements](https://winscp.net/eng/docs/requirements)。PuTTY 0.85 的 FAQ 只承诺仍在安全支持期内的 Windows，Win7 不在保证范围内；需要 SSH 时优先 WinSCP/MobaXterm，内网固定一份已验证能在 Win7 上打开的安装包。

系统自带 `mstsc` 可以连 Windows 跳板，但 2026 年的 Win10/11 主机若强制较新的 TLS / CredSSP / NLA，Win7 客户端可能连不上。跳板应允许与 Win7 兼容的 RDP 策略，或给用户改用 WinSCP/MobaXterm 走 SSH。Windows 内置 OpenSSH 客户端是 Win10 1809 才有的功能，Win7 没有。

Git 若必须在 Win7 上看仓库，最多装 **Git for Windows 2.46.2**；工作副本仍以远程主机为准。

### 3.4 项目文件放哪

Agent 只能稳定访问 **远程主机上的路径**。

推荐布局：

```text
远程主机:  ~/work/项目   ← git clone、dsh/codex 的工作目录
Win7:      只通过 WinSCP / RDP 查看或拷少量文件
```

如果 Win7 上已有唯一一份代码：先用 WinSCP 上传到远程，或在远程 `git clone` 公司仓库，之后以远程为源。不要让 DSH 去“操作 Win7 本地盘”——SSH/RDP 默认做不到，映射盘也容易权限和锁文件混乱。

### 3.5 两种标准工位

**工位 A（最省事，推荐有 Windows 跳板时）**

1. IT 提供一台 Windows 11 或 10 22H2 虚机，已装 Node 24 与镜像内 DSH/Codex。
2. Win7 用户用远程桌面登录（若协议谈不拢，改用 WinSCP/MobaXterm SSH）。
3. 在虚机浏览器打开 `dsh web`，或在虚机终端跑 `codex`。
4. 代码在虚机 `~/work` 或 `C:\work`。

**工位 B（只有 Linux 跳板）**

1. IT 提供 Ubuntu 24.04 账号，sshd 开放给 Win7 网段。
2. Win7 用 WinSCP 或 MobaXterm 登录，`tmux new -s dsh`。
3. 运行页面复制的安装命令（每人一次），然后 `dsh` 或 `codex`。
4. 需要看 Web UI 时：在跳板跑 `dsh web`，用 **另一台有现代浏览器的电脑** 访问；或给用户一台 Win10/11 云桌面。不要依赖 Win7 浏览器。

## 4. 运维侧清单

- 内网镜像继续只声明支持：Windows 10 22H2+、Windows 11、主流 glibc Linux。Win7 保持“不支持本机 Agent”。
- 为 Win7 用户准备：跳板机镜像（Ubuntu 24.04 或 Win11）、**已在 Win7 上试过的** WinSCP 或 MobaXterm 安装包、一页连接说明（主机名、账号、工作目录）。不要把 2026 年最新 PuTTY 或 VS Code 1.70 + 现网 Remote-SSH 当成默认方案。
- 不要在镜像页提供 Win7 专用 npm 命令或 Node 13 下载；那会暗示本机可装。
- 安全：跳板只出内网模型地址和镜像源；Win7 不存密钥。Win7 已停止安全更新，跳板与 Win7 之间用内网隔离，能升级的机器尽快换成 Win10/11 或只当显示器。

## 5. 能不能轻改 DSH 源码兼容 Win7？

不能。对当前发布包做几处补丁、换个旧 Node，都无法得到可在 Win7 上使用的 DSH。下面按改动量拆开，避免把“改两行 JS”和“换操作系统 API”混在一起。

### 5.1 看起来像轻改、其实不够

| 点 | 镜像里的事实 | 若只改 DSH |
| --- | --- | --- |
| `Promise.withResolvers()` | 至少 20 个 `@deepseek-ai/dsh-*` 包的发布 JS 在用，不只 subprocess-local 两处 | 可以在入口打 polyfill，这才是真正的轻改 |
| `node:sqlite` | `dsh-session-query-sqlite` 第 50 行 `import("node:sqlite")` | 要换成 `better-sqlite3` 之类，并处理会话查询语义，不是一行 import |
| commander 15 | `dsh` 的 `lib/bin.js` **一启动就** `import { Command } from "commander"`；commander@15.0.0 声明 Node ≥22.12 | 必须降到 commander 11/12 并改适配层 |
| undici 8 / pi-ai | HTTP 栈要求 Node ≥22.19 | 整条模型请求依赖要降级或替换 |
| node-pty 1.2 | `dsh-subprocess-local` **顶层** `import * as nodePty from "node-pty"`；Windows 实现只加载 `conpty` 原生模块，包内只有 `win10-x64` 的 `conpty.dll`，README 写明已移除 winpty | 加载该包就会碰到 ConPTY。Win7 没有 `CreatePseudoConsole` |

`dsh --help` 可能还没走到 PTY，但已经加载 commander 15，所以连“只显示帮助”也过不了官方 Win7 上能装的 Node 13。完整 `dsh` / `dsh web` 一定会加载 subprocess-local。

### 5.2 硬墙不在 DSH 仓库里

Win7 缺的是操作系统能力，改 DSH TypeScript 补不出来：

1. **官方 Node 22/24 不能作为 Win7 运行时。** Node 14 起 `node.exe` 用 `IsWindows8Point1OrGreater()` 拒绝启动；24 更是 `IsWindows10OrGreater()`。社区 Win7 移植大约停在 Node 20，没有 `node:sqlite`，也不被 DSH 的 `^22.19 \|\| >=24` 接受。
2. **ConPTY 是 Win10 1809 API。** [CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole) 最低客户端就是 1809。把 node-pty 换回 winpty 年代的 0.10，需要：恢复已删除的 winpty 后端、随包分发 `winpty.dll`、按所选 Node ABI 重编原生模块，并改 DSH 的终端实现。这是一份独立的 native 分叉，不是轻修改。
3. **sharp / koffi 预编译包** 针对新 Node 的 N-API。即使用非官方 Node，也要为那个 ABI 重编或验证能否加载；未在 Win7 真机验证。

### 5.3 VxKex-NEXT：能让官方 Node 启动，不等于 DSH 可用

[VxKex-NEXT](https://github.com/YuZhouRen86/VxKex-NEXT) 是 Windows 7 上的 **API 兼容层**（IFEO 注入 DLL，改导入表，把 Win8/10 才有的函数接到自己的实现）。它不是改 DSH 源码，也不是官方 Node 移植。

社区报告（未经本仓库真机验证）：

- [Issue #201](https://github.com/YuZhouRen86/VxKex-NEXT/issues/201)：有人写 Node 20 可用；后又改口「all versions of nodejs work」，并配合 `NODE_SKIP_PLATFORM_CHECK=1`。
- [Issue #268](https://github.com/YuZhouRen86/VxKex-NEXT/issues/268)：官方 `node-v23.11.1-win-x64.zip` 在 **不** 伪装成 Windows 10 时，REPL 能起来；勾选 “Report Windows 10” 会在 V8 `VirtualAlloc`/`PAGE_TARGETS_INVALID` 上崩溃。
- 旁系 VxKex 1.1.4.1588 的 changelog 写过 “Add support for Node.js 24.11.1.0”。README 兼容名单有 Python、VS Code、Chromium，**没有把 Node/DSH 列为已验证应用**。

这只说明：**版本门禁和一部分 kernel32 符号可以被骗过去**，`node.exe` 有可能进 REPL。它不能推出「Node 27 nightly + DSH 在 Win7 上可用」。

对照 DSH 仍然缺的东西：

1. **`CreatePseudoConsole` 不在 VxKex 导出表里。** `KxBase/kxbase.def` 有 `WriteConsole`/`GetConsoleMode` 等控制台包装，以及 `UpdateProcThreadAttribute`，没有 `CreatePseudoConsole` / `ResizePseudoConsole` / `ClosePseudoConsole`。控制台部分只做了 ANSI 转义兼容，不是 ConPTY 主机。
2. **node-pty 1.2 默认从 `kernel32` 取 ConPTY**；失败时还可以加载随包的 `conpty.dll` + `OpenConsole.exe`。那是又一个 Win10 用户态主机进程，同样要 VxKex 罩住，且 Win7 上能否当完整 PTY 没有公开验证。
3. **sharp / koffi / conpty.node** 是原生模块，VxKex 不负责 N-API 预编译包。
4. 项目 README 写明开发 **暂停到 2027 年 8 月**，不是可依赖的运行时。

因此：VxKex 可能让「官方 Node 二进制在 Win7 上启动」成立，但不能替代 ConPTY，也不能把当前 DSH 变成受支持的 Win7 客户端。本镜像不安装、不检测、不文档化 VxKex 作为安装前提。

### 5.4 若坚持做“能跑的分叉”实际是什么工作量

至少同时做这些，并且之后每个上游版本都要重做：

- 选定非官方 Node（仍无厂商支持），或接受功能残缺的 Node 13（DSH 当前 JS 直接跑不起来）
- 降级 commander、undici、pi-ai
- 替换 `node:sqlite`
- 分叉 node-pty + winpty，或关掉交互式终端（Agent 常用能力会缺）
- 重编 koffi/sharp 等原生模块
- 自己跟上游 changelog

这已经是维护一个功能受限的移植版，成本高于给 Win7 用户提供一台 Ubuntu 24.04 / Windows 11 跳板。本镜像不提供、也不应暗示存在这样一个 Win7 构建。

## 6. 和“装到本机”的差异（避免误解）

远程方案能做到：在 Win7 键盘前编写提示词、看输出、改远程仓库。

远程方案做不到：Agent 直接打开 Win7 上的 `C:\` 文件、使用 Win7 本机编译器、在 Win7 本机跑 node-pty 终端。需要本机文件时，先同步到远程再跑 Agent。

## 参考

- Node 平台表：[v13.14.0](https://github.com/nodejs/node/blob/v13.14.0/BUILDING.md)、[v14.21.3](https://github.com/nodejs/node/blob/v14.21.3/BUILDING.md)、[v17.9.1](https://github.com/nodejs/node/blob/v17.9.1/BUILDING.md)、[当前](https://github.com/nodejs/node/blob/main/BUILDING.md)
- [CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)（Win10 1809+）
- 镜像内 `node-pty@1.2.0-beta.15` README：移除 winpty，要求 Windows 10 1809+
- [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- [VS Code FAQ · Win7 最后一版 1.70.3](https://code.visualstudio.com/docs/supporting/faq)
- [Git for Windows FAQ · 2.46.2 为 Win7 最后一版](https://github.com/git-for-windows/git/wiki/FAQ)
- [Chrome 系统要求 · 109 为 Win7 最后一版](https://support.google.com/chrome/a/answer/7100626)
- [WinSCP 系统要求](https://winscp.net/eng/docs/requirements)
- [WinGet 支持的 Windows](https://learn.microsoft.com/en-us/windows/package-manager/winget/)
- [WSL 版本对比](https://learn.microsoft.com/en-us/windows/wsl/compare-versions)
- 本仓库 [客户端兼容性审查](CLIENT-REVIEW.md) 第 3 节
