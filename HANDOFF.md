# whale-native 维护交接

## 当前交付

独立仓库 `Roelatriper/whale-native`，版本 `0.1.0-preview.1`。支持 Apple Silicon、macOS 13.5+。Swift / AppKit 前台 + Node 24 后台；设置 WKWebView 按需创建与释放。运行包自包含，ad-hoc 签名、未经 Apple 公证。不是全部功能等价的稳定版，也不是纯 Swift 重写。

## 阅读顺序

1. README.md：安装、数据兼容、边界。
2. docs/native-macos/PROGRESS.md：进度、未迁移功能与优先级。
3. docs/native-macos/INTERFACES.md：JSONL v1、action / event、通知和外观契约。
4. docs/native-macos/VALIDATION.md：本库实际验证，不能拿旧仓库测试数当新库结果。
5. docs/native-macos/MEMORY-OPTIMIZATION.md：历史内存测量及口径。
6. docs/RELEASING.md、PROVENANCE.md：打包、安全与来源。

## 代码地图

| 路径 | 职责 |
| --- | --- |
| `desktop/native/main.swift` | 开发 / bundled 启动路径，数据目录在接收者机器上解析 |
| `Application.swift`, `PetView.swift`, `BubbleView.swift` | 生命周期、非激活面板、命中、按压、气泡动画与通知 |
| `Transport.swift` | 仅父子进程 JSONL，不在参数中放凭据 |
| `Settings.swift`, `settings.js`, `settings.css` | 限制同源的按需设置 WebView |
| `desktop/native/backend.mjs` | 原生 adapter、单实例锁、私有协议与资源桥 |
| `runtime/native-*.mjs` | 偏好、展示投影、气泡序列与防跨模式旧请求 |
| `runtime/service.mjs`, `ledger.mjs`, `session-monitor.mjs` | 余额、消费归属、恢复、分块会话观测 |
| `runtime/dispatcher.mjs`, `lib/` | 共享业务路由、素材校验、工坊与原子写入 |
| `desktop/ui/` | 保留的业务表单和展示政策，不是宠物浏览器 renderer |
| `assets/bubble-defaults.json` | 原 48 条文案及权重，独立于旧大脚本 |
| `scripts/native-macos.mjs` | 本地开发构建、隔离 smoke / measure、正常退出 |
| `scripts/package-release.mjs`, `release-layout.mjs`, `verify-release.mjs` | 固定 Node 下载校验、白名单打包、移动路径验证 |

## 必须保持的边界

- 默认数据目录仍为 `$CODEX_HOME/whale-widget` 或 `~/.codex/whale-widget`，可由 WHALE_HOME 覆盖；不要并行运行两套共享目录的 app。
- 此新仓库不包含旧版安装 / 恢复 / Windows 启动入口，不自动改动旧 LaunchAgent；切换前由用户正常停旧服务。
- Swift 不直接改账本；未知数据不可显示为零；订阅不出现 API 余额。
- 账户消费只在实际显示后确认，模式 / scope 切换使旧提示与在途请求失效。
- pet / bubble 不成为 key/main；不能为提示调用激活应用。
- EOF / shutdown 正常关闭 Node；只可终止当前 Process 对象持有的子进程，不能凭旧 PID 杀任意进程。
- 修改后台后需退出再开；`npm start` 遇到已有原生实例只恢复显示，不热更新。
- 发布包不能包含配置、账本、聊天、截图、缓存、测试输出、本机绝对启动路径、源码 `.git`。

## 接手后的优先工作

先完成真实鼠标、触控板、多屏 / Spaces / 休眠、焦点和各服务商表单人工回归；再迁移复杂气泡及自定义任务音效。之后考虑开机启动、崩溃恢复、Developer ID / 公证和自动更新。完全移除 Node 属于后续架构阶段，不是本次发布范围。
