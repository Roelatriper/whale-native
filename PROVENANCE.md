# 来源与许可边界

`whale-native` 由 Roelatriper 维护，是 macOS-only 原生预览版，不代表上游官方项目或 OpenAI。

## 代码来源

- 原项目：[MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)，MIT，Copyright (c) 2026 MeteorNOX。保留根目录 LICENSE。
- 整理来源：[Roelatriper/DeepSeek-Balance-Whale-Widget](https://github.com/Roelatriper/DeepSeek-Balance-Whale-Widget)，macOS 维护分支 `fix/macos-click-outside-dismiss`；基点提交 `3752a04c0d5ab119f22af39dedd33d68f110216c`，加其后的本地原生重构成果。这是一次干净快照，不声称所有代码为本库原创。
- 继承原 Node 业务、账本、资源验证及设置模块；新增 / 改编 Swift AppKit 宿主、JSONL 适配层、原生偏好与气泡投影、会话扫描内存优化、自包含发行脚本。
- 感谢上游作者、Codex 适配协作者 Yang-huai406 和既有 macOS 贡献者。历史贡献及代码可沿上述仓库追溯。

## 素材不等于代码许可证

图片、动图、音效按上游素材说明原样保留；**不因代码为 MIT 就成为 MIT 素材，也不在这里重新授予素材许可**。维护者选择将其用于个人兴趣项目；非商业定位不是本项目对素材公共领域状态或独立授权的保证。

| 文件 | 来源记录 / 用途 |
| --- | --- |
| `assets/DSniang1.png`, `DSniang02.png` | 上游鲸鱼娘角色；上游记录为 AI 生成后人工挑选 / 裁切，生成工具及原始来源未详；本库未重绘 |
| `assets/rua.gif`, `bubble-petpet.gif`, `bubble-yue-money.gif` | 上游内置动图；逐项作者与可再分发授权未完整记录 |
| `assets/Ya1.mp3`, `Ya2.mp3`, `D1.mp3`, `D2.mp3` | 上游内置按压 / 松开音效；逐项来源未完整记录 |
| 构建生成的 `whale-native.icns` | 从 DSniang1.png 转换，遵循同一素材边界 |
| `assets/bubble-defaults.json` | 从上游 BUBBLE_DEFAULT_ITEMS 严格 JSON 字面量抽出；保留原 48 条文案、样式与权重，不携带旧浏览器宠物脚本 |

上游素材条款不等于无限再许可；本库未取得或核验额外独立授权。需要将素材用于自己的项目时，应自行确认适用权利。若有权利异议，请在本库 issue 中提供文件名及依据；维护者可替换或移除争议文件。不要提交个人隐私或密钥。

## 依赖

- `vendor/smol-toml`：BSD-3-Clause，保留其 LICENSE。
- Release 内置 Node.js 官方 darwin-arm64 发行版：保留随该版本提供的完整 LICENSE（含第三方声明），存为 `.app/Contents/Resources/NODE-LICENSE`。下载版本和 SHA256 固定在 `scripts/release-layout.mjs`。
- Apple AppKit / WebKit / AVFoundation 等系统框架由系统提供，不随包重新分发。
- 无 Electron / Chromium 运行依赖。
