# 安装与资源验证记录

2026-09-11 用户流程修订：Ubuntu 24.04.4 的隔离 Docker 网络中，实际执行网页的 Node 安装和 DSH 0.1.2-rc.1 安装命令，分别验证 npm 11.12.1 / 12.0.2。确认 Node 安装保留自带 npm 11；本次工具 prefix 为 ~/.local，默认 npm prefix 不变；当前终端与新 Bash 均可查找到 dsh 并运行版本命令，Koffi、sharp、node-pty 可以加载。Windows 命令已静态审查，未做真机执行。

本次只运行 TypeScript、受影响的页面/安装器检查和上述真实用户流程，没有重复整个工具版本矩阵。以下为未变更资源闭包的 2026-09-10 基线记录；历史报告不用于声称 Windows 或新页面已通过完整验收。

日期：2026-09-10。默认配置包含 6 个工具版本、522 个 npm 包版本、4 份 Claude 原生平台资源，以及 npm 12.0.2、Node.js Windows MSI/ZIP、Linux glibc 压缩包和 Git for Windows。

## 已通过

- TypeScript 检查和 12 项回归测试：配置边界、glibc/musl/Windows 选择、必需的 Claude 平台包及版本匹配、占位脚本/错误架构拒绝、integrity 校验、归档链接拒绝与旧归档目录兼容、内网 Claude 安装器、Linux 用户目录 Node.js/npm 安装器、实际 Verdaccio 多版本/别名/安装脚本流程、网页 DOM 交互。
- Docker 单容器镜像成功构建；Nginx、Verdaccio、健康检查和动态 `/install-node.sh` 可用，安装流量仅使用内网地址。
- 在临时 HOME 中实际执行镜像生成的 Node.js 一键安装脚本：下载并校验镜像内的 Linux x64 tar.xz，安装 Node.js 24.15.0，当时从内网 registry 将 npm 升级为 12.0.2（2026-09-11 已取消这一步），生成 `node`、`npm`、`npx`、`corepack` 链接并成功启动。
- Debian GNU/Linux 12（bookworm）、Node.js 24.15.0、npm 12.0.2，在 Docker internal 网络中完成全新缓存与独立全局 prefix 的安装和启动测试。
- Claude Code 2.1.265 / 2.1.266：npm 全局命令、真实 ELF 文件和 SHA-256、独立原生包下载与启动均通过。
- Codex CLI 0.153.3 / 0.153.4：平台别名包分发及原生 CLI 启动通过。测试 HOME 位于用户目录，避免系统临时目录触发辅助程序安装限制。
- DeepSeek Harness 0.1.2-alpha.5 / 0.1.2-rc.1：CLI、Koffi 原生模块、sharp 图片生成、node-pty shell、Web 令牌换 Cookie 后的页面访问均通过。
- npm 12.0.2 作为可选镜像包从隔离的 Verdaccio 全新安装；配置、安装命令和网页不再提供 pnpm 或 DSH 扩展的独立安装流程。
- 三款工具在同一全局安装位置降级后再升级通过；Claude 原生程序重新核对哈希，避免留下旧文件。
- 无外网出口验证、缺包返回 404、registry 写入拒绝通过。

完整机器可读证据：

- [npm 12 报告](reports/smoke-linux-x64-npm12.json)

报告同时附入镜像产物，但不在用户首页展示。报告记录测试对应的资源构建时间；只有版本、平台及构建时间匹配且全部通过的报告才能通过 record-validation 加入 catalog。

## 尚未验证及边界

- Windows x64 原生包已收集并检查 PE/x64 文件头；Windows 10/11 未做真机或虚拟机运行验收。Win7 明确不支持。
- Ubuntu、Rocky、其他 Debian 版本未逐一运行验收；本次 Debian 12 成功不等于所有 glibc 发行版均成功。Alpine/musl 默认未启用。
- 当前环境无可连接的浏览器，已完成 DOM 交互检查，未做真实浏览器截图或视觉验收。
- 未使用个人账号、API Key 或模型服务，未验证真实模型调用、个人登录及完整交互式编码任务。
- DSH 0.1.3-alpha.2 的 fs-ext 需要编译，不在默认配置中；更早的 0.1.1-rc.2 解析异常缓慢，也未纳入默认资源集。

相关安装脚本检查见 [SCRIPT-REVIEW.md](docs/SCRIPT-REVIEW.md)。镜像所含第三方文件保持原始内容，来源与许可证字段见网站 catalog.json。
