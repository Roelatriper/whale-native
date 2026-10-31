# whale-native

macOS 原生小鲸鱼桌面伴侣：查看 API 余额或 Codex 订阅的 5 小时 / 每周额度，保留按压、音效、气泡与随机留言。

这是从 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的 macOS 维护分支独立整理的原生预览版，不是上游官方发行版。代码保留上游版权；素材许可与代码分开，见 [来源说明](PROVENANCE.md)。

## 下载与运行

到 [Releases](https://github.com/Roelatriper/whale-native/releases) 下载 `whale-native-0.1.0-preview.1-macos-arm64.zip`，解压后将 `whale-native.app` 拖进“应用程序”，打开即可。运行包已包含 Node，不需要 Homebrew、npm 或原项目源码。

- 仅支持 Apple Silicon（M 系列）Mac，最低 macOS **13.5**；Intel、Windows、Linux 不在维护范围。
- **预览版，仅 ad-hoc 本地签名，未经 Apple 开发者签名和公证。** macOS 可能拦截首次打开。确认来源及 SHA256 后，可按系统“隐私与安全性”页面的提示允许打开；不要全局关闭 Gatekeeper。
- 可在菜单栏的 🐳 菜单打开设置、显示 / 隐藏、退出。跟随模式下需要 Codex 窗口可见；可改为“独立桌面”。
- 首次点击宠物显示余额 / 额度，后续点击进入并刷新留言；点击气泡继续或关闭。点击空白关闭可在设置中开启。
- API 与 Codex 订阅二选一，不把 API 余额混入订阅额度。订阅数据来自本机可读的官方额度快照，不是通过 token 反推剩余额度。

校验下载文件（在解压前）：

```sh
shasum -a 256 -c whale-native-0.1.0-preview.1-macos-arm64.sha256
```

## 数据兼容与隐私

默认沿用 `~/.codex/whale-widget`；设置 `CODEX_HOME` 时使用其下的 `whale-widget`，`WHALE_HOME` 可覆盖数据目录。Finder 启动不一定继承终端环境变量。旧版的连接、账本和素材不需要手动复制，但**不要让旧版与原生版同时使用同一目录**；先从旧版菜单正常退出，并暂停旧版自动跟随服务。新库不会自动卸载或修改旧服务。

首次切换前建议自行备份该数据目录。退出后可重新运行旧版；本项目不提供旧版安装器或自动回滚。删除 `.app` 不会删除数据目录。

后台读取本地 Codex 配置、授权信息及会话记录，以获取余额、额度、token 和任务状态；不会主动上传聊天正文。余额请求会发送给你配置的服务商，汇率功能会访问其汇率来源。密钥仍按原配置或环境变量解析，不随发布包分发。源码和 Release 不包含维护者的密钥、账本、聊天或本机启动路径。遇到问题请勿将完整配置、授权文件或真实会话日志贴进 issue。

## 架构与当前范围

宠物、气泡、菜单和音频由 Swift / AppKit 绘制。余额、账本、会话观察等业务仍由一个随包附带的 Node 24 后台处理；这还不是完全 Swift 化。设置窗口按需使用 WKWebView，关闭后解除所有者引用；不运行 Electron / Chromium。

已实现：原版默认角色与图标、按下 / 长按 / 回弹、两段音效、拖动缩放翻转、基本跟随、余额 / 订阅模式、任务与账户消费提示、原气泡轮廓、48 条随机留言和 petpet、0.18 秒气泡进出与 0.2 秒内容渐变。

尚未完整迁移：复杂图文气泡编辑与动态文字效果、自定义音频裁剪 / 任务音效、全部吸附策略。尚无开机启动、崩溃自动重启、自动更新、Developer ID 公证或 Intel 构建。多屏、Spaces、睡眠唤醒与各服务商配置仍需要更多人工覆盖。详见 [进度与缺失功能](docs/native-macos/PROGRESS.md)。

内存改进包括会话扫描的 64 KiB 复用缓冲与聊天正文跳过。历史整组测量约 60–65 MiB 的稳定样本**不是峰值或最低系统保证**；启动、设置窗口、大素材、会话规模会增加占用。见 [测量边界](docs/native-macos/MEMORY-OPTIMIZATION.md)。

## 从源码运行

需要 Apple Silicon Mac、Xcode Command Line Tools / Swift 和 Node >=24。项目没有 npm 安装依赖，smol-toml 随源码提供。

```sh
git clone https://github.com/Roelatriper/whale-native.git
cd whale-native
npm test
npm run native:build
npm start
```

`npm start` 构建 / 打开开发包，使用当前 Node 与源码目录。已有原生实例时只恢复显示，不会热更新后台；修改代码后需正常退出再打开。`npm run native:stop` 正常退出原生实例。

隔离验证（不会改写正式账本）：

```sh
TMPDIR=/private/tmp npm test
npm run native:smoke
npm run native:scan-memory
npm run release:build
npm run release:verify
```

发行构建从 nodejs.org 下载固定版本并校验已固定的 SHA256，内置代码与素材采用白名单复制。产物位于 `dist/`，详见 [发行流程](docs/RELEASING.md)。本库不自动发布 Release，公开发布需维护者明确操作。

## 交接

[维护者入口](HANDOFF.md) · [协议接口](docs/native-macos/INTERFACES.md) · [验证记录](docs/native-macos/VALIDATION.md) · [贡献说明](CONTRIBUTING.md) · [第三方声明](THIRD_PARTY_NOTICES.md)
