# 独立库验证记录

版本：0.1.0-preview.1。环境：Apple Silicon、macOS 27.0.1、Swift 6.4。最低 macOS 13.5 是 deployment target，不代表已在该版本实机验证。没有 Intel、Windows、Developer ID / 公证验证。

## 验证项目

- `TMPDIR=/private/tmp npm test`：共享业务、配置隐私、金额精度、账本恢复、订阅窗口、原生投影 / 协议、气泡序列、扫描缓冲、真实 ICNS 和发行白名单。
- `npm run native:scan-memory`：独立 Node 读取固定约 64 MiB 合成会话；断言任务 / token 语义与 100 MiB 峰值 RSS 预算。
- `npm run native:smoke`：真实 AppKit / WKWebView，包含 pet 命中与重复按压、原始气泡 / 文案 / 动图、API / 订阅页面及消息请求、真实 CA 中间透明度、快速切屏 / 淡出重开、设置关闭释放及正常退出。
- `npm run release:build`：固定官方 Node hash、打包白名单、完整许可、无 Homebrew 动态依赖、签名校验。
- `npm run release:verify`：校验 zip 与 sha256、发行 metadata、解压内容及签名；带空格的新目录，PATH 不含外部 Node，不传 root/node 覆盖，实际运行上述原生冒烟，并确认退出后锁和 runtime 文件清理。

## 本地结果（2026-10-31）

- 独立库 Node 测试：本机 Node 26.8.2 与发行内置 Node 24.22.2 均为 338 项通过，0 失败、0 跳过。
- 固定输入扫描预算：本机 Node 26.8.2 峰值 RSS 47.3 MiB，单次最大读取 65,536 字节；通过 100 MiB 预算。这不是应用总占用。
- 同一合成预算使用发行 Node 24.22.2：峰值 RSS 54.4 MiB，通过 100 MiB 预算；不是整组应用峰值。
- 开发包真实原生 smoke：16 项检查通过并正常退出。
- 自包含发行包：Node 24.22.2；无非系统动态链接依赖，保留官方 Node 签名；外层 app ad-hoc 签名严格验证通过。
- 解压至带空格的新目录、限制 PATH 且不传 --root / --node：16 项真实 AppKit / WK 检查全部通过；退出清理锁及 runtime 文件。
- 未覆盖 /Applications 或停止原项目正式实例。CI 结果以 GitHub Actions 实际记录为准，本地通过不等于 CI 已通过。
- 初次远端构建发现气泡字号表达式在旧 Swift 中 Double / CGFloat 推断歧义；显式使用 Double 计算并在 AppKit 边界转换为 CGFloat，避免依赖新编译器推断。远端实际编译及移动路径 smoke 是此兼容问题的回归入口，不以源码字符串检查代替。

旧仓库 521 项测试或旧 Node 26 的整组内存样本不计作本库发行包结果。

## 隐私和验证边界

fixture 只允许独立 `/private/tmp/whale-native-*`，模拟余额 / token 不写正式账本。未覆盖 /Applications，未停止旧项目正式实例，未读取其真实账本内容用于发行。

临时 smoke 报告和模拟截图留在测试目录供本机检查，不作为发布附件。真实会话内存报告不公开。Release 仅包含源码白名单、素材、固定 Node、许可证和无本机路径的启动信息。

尚未覆盖：macOS 13.5 实机、其他硬件、所有真实服务商、多屏 / Spaces / 全屏 / 休眠、全部大图格式、长时内存与自定义音效。自动测试不能替代这些人工验收。
