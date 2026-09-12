# 客户端使用与兼容性审查

2026-09-11。范围是本镜像的 DSH 0.1.2-alpha.5 / 0.1.2-rc.1、锁定的传递依赖，以及 Linux/Windows 用户实际安装入口。核对了镜像缓存的原始发布 tarball、npm 11.12.1 / 12.0.2 源码与上游平台要求。

## 1. 安装成功不等于命令可用

此前给 `node/npm/npx` 创建 ~/.local/bin 软链接，却未为后续 npm 全局安装指定 prefix。npm 会按自己的安装位置推导默认 prefix，DSH 便落在 Node 版本目录的 bin 内。只把 ~/.local/bin 加进 PATH 无法找到那个目录下的 dsh。此前 smoke 使用单独测试 prefix 和绝对命令路径，不能证明真实用户终端能找到命令；这是验证覆盖点选择有误。

修订后的 Linux 页面用一个内网脚本完成：明确 --prefix "$HOME/.local"、保持 npm 默认配置不变、安装必要脚本、检查 ~/.local/bin/dsh 指向真实包文件、执行启动检查，最后为 Bash/Zsh 的启动文件添加 PATH。调用命令也为当前终端设置 PATH。已安装到旧目录的包不会因更改 prefix 自动移动；重新执行新页面命令即可安装到新位置。

Windows 的 npm 命令入口在 prefix 本身，没有 Linux 的 bin 层级。页面指定 %APPDATA%\npm，更新当前进程和用户 PATH，并使用 npm.cmd/dsh.cmd，避免 .ps1 执行策略妨碍使用。目录规则依据 [npm Folders](https://docs.npmjs.com/cli/v11/configuring-npm/folders/)。

## 2. 不应强制升级 npm 12

本地 npm 11.12.1 的配置定义中没有 allow-scripts，默认正常运行依赖安装脚本；npm 12.0.2 支持 allow-scripts，默认限制未获许可的安装脚本。最新版 npm 11 文档也已经包含该选项，因此主版本不是可靠的能力边界。实现读取 npm config list --json，仅在该配置项存在时添加精确许可清单；始终固定使用检测时找到的 npm，不因 PATH 变化偷偷切换版本。

这一区分是安装器内部需要处理的行为，不是让用户选择命令或升级软件的理由。Linux Node 安装器现在保留发行包自带 npm，工具安装不依赖可选 npm 12 包。参考 [npm 11 配置](https://docs.npmjs.com/cli/v11/using-npm/config/#allow-scripts) 和 [npm 12 配置](https://docs.npmjs.com/cli/v12/using-npm/config/#allow-scripts)。

镜像内 npm 12.0.2 的 package.json 声明 Node 范围为 `^22.22.2 || ^24.15.0 || >=26.0.0`。例如 Node 22.19 满足 DSH 上游下限，却不满足 npm 12.0.2 的安装要求。具体用户机器还可能存在不可写 prefix、不同 npm/node 来自不同 PATH、网络或公司配置问题；没有该机器错误日志，不能断言升级失败只有一种原因。

## 3. Node 17 不能让当前 DSH 支持 Windows 7

两个发布版 DSH 顶层 package.json 未声明 engines，不能据此推断它支持老 Node。核查锁文件和实际发布代码发现：

| 层次 | 具体证据 | 对 Node 17 / Win7 的影响 |
| --- | --- | --- |
| CLI 入口 | 两个版本 lib/bin.js 均直接导入 commander；锁定 commander 15.0.0 要求 Node >=22.12 | 入口依赖已经不承诺 Node 17 |
| 子进程运行时 | dsh-subprocess-local 0.1.2-rc.1 的 lib/index.js 第 974、1031 行调用 Promise.withResolvers() | 发布后的 JS 也用了 Node 17 没有的 API，不能仅靠重新编译 TypeScript 解决 |
| 模型/HTTP 依赖 | pi-ai 0.84.4、undici 8.10.2 要求 Node >=22.19；sharp 0.35.4 要求 >=20.9 | 不是一个 engines 字段或一个 polyfill 的问题 |
| SQLite 查询 | dsh-session-query-sqlite 0.1.2-rc.1 的 lib/index.js 第 50 行按需导入 node:sqlite | Node 17 没有此内建模块；仅启动帮助命令不会覆盖这个功能 |
| Windows 终端 | node-pty 1.2.0-beta.15 的 README 明确移除 winpty，Windows 实现直接加载 conpty | Windows 7 缺少当前终端后端所依赖的系统能力 |

上游 [Node 引擎下限说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/process/2026-07-06-node-engine-floor.zh.md) 说明支持 `^22.19.0 || >=24.0.0`。这里区分源码开发要求与已发布 JS：原生 TypeScript 类型剥离并非所有发布包启动路径的必需条件，但发布包中的 withResolvers、SQLite 功能和上述传递依赖已足以否定 Node 17 的直接兼容性。

官方 [Node 17.9.1 平台表](https://github.com/nodejs/node/blob/v17.9.1/BUILDING.md#platform-list) 的 Windows 下限是 8.1/Server 2012 R2，本身不支持 Windows 7；[CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole) 要求 Windows 10 1809。即便使用第三方修改版 Node 绕过操作系统检查，也不会自动补齐 DSH 依赖、内建模块和 ConPTY。

理论上可以维护独立兼容分支：替换/降级依赖、补齐 JS API、替换 SQLite、恢复旧终端后端并重编原生模块；这相当于维护一个功能受限的移植版本，不是镜像分发配置优化。本次未伪装兼容性，也没有修改第三方包。

Win7 客户端的可行路径是通过 SSH 或远程桌面操作受支持主机上的 DSH。项目文件、命令和模型访问发生在远程主机；它不会因此获得 Win7 本地文件访问能力。网页远程访问还取决于旧浏览器兼容性与服务的认证、网络配置，本次未验证，不作为已交付支持。操作清单见 [Windows 7 使用方案](WIN7-PRACTICE.md)。

## 本次针对性验证

在 Ubuntu 24.04.4 临时用户环境、Docker internal 网络中，分别执行 npm 11.12.1 与 npm 12.0.2 的网页安装流程：安装 Node 24.15.0，安装 DSH 0.1.2-rc.1，确认默认 prefix 保留在 Node 版本目录而本次工具安装到 ~/.local，当前 shell 与新 Bash 均可直接运行 dsh；同时加载 Koffi、sharp、node-pty，确认许可差异没有遗漏其安装脚本。未重复三款工具所有版本矩阵，未做 Windows 真机或模型调用验收。
