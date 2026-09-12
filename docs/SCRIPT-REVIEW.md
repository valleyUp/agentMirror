# 默认版本安装脚本检查记录

检查的是 registry integrity 校验后的原始 tarball，清单指纹保存在 `mirror.yaml` 的 `approvedScripts`。更换 tarball 或版本必须重新检查，不能沿用不同包的指纹。

| 包 | 检查结果 |
| --- | --- |
| Claude Code 2.1.265 / 2.1.266 | `install.cjs` 相同；依据平台定位可选依赖，将原生程序硬链接或复制到 `bin/claude.exe`，不进行网络下载。缺包时可正常返回并留下占位文件，所以另验证 ELF/PE、SHA-256 和实际启动。 |
| dsh-subprocess-local 0.1.2-rc.1 | `ensure-spawn-helper.mjs` 只对已安装 node-pty 的 spawn-helper 设置执行位，不下载资源。 |
| @google/genai 1.52.0 | preinstall 为 echo no-op。 |
| node-pty 1.2.0-beta.15 | prebuild.js 优先检查随包提供的平台预编译目录；缺失或设置 build_from_source 时才走 node-gyp。post-install.js 清理该包构建目录，并从随包资源复制 Windows conpty.dll / OpenConsole.exe。Linux x64 与 Windows x64 预编译目录均已见到。 |
| koffi 3.2.1 | cnoke.cjs 优先加载独立可选平台包，成功即退出；否则尝试本地编译。对应 x64 平台包随镜像收录，断网测试必须证明不进入编译分支。 |
| protobufjs 7.6.6 | 本地读取 package.json，必要时输出版本范围警告，不下载或执行额外程序。 |

未纳入默认清单的 DSH 0.1.3-alpha.2 通过 session-persistence-jsonl 强制依赖 fs-ext 2.1.1，其安装脚本为 `node-gyp configure build`。此版本不满足“无需预装编译环境”的交付目标，不能仅批准脚本就宣称可用。

此记录说明分发与安装行为，不等于对第三方软件整体安全性的审计，也不替代目标平台的实际安装和运行验证。
