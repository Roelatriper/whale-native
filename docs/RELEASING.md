# 发行流程

首版为 `v0.1.0-preview.1`，仅 macOS 13.5+ / arm64。Node 24 的最低系统版本以 [官方构建说明](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list) 为依据。Swift 也以 13.5 为 deployment target。没有 Intel / Windows 构建、Developer ID、公证或自动更新。

## 本地准备

在干净且已审阅的源码目录执行：

```sh
TMPDIR=/private/tmp npm test
npm run native:scan-memory
npm run native:smoke
npm run release:build
npm run release:verify
```

构建将官方 Node 固定为 `24.22.2`，校验 `scripts/release-layout.mjs` 中的 SHA256，保留官方二进制及其签名、完整 LICENSE 和第三方声明。只给外层 app 做 ad-hoc 签名，不伪称开发者签名 / 已公证。升级 Node 时必须从官方发行目录重新核验版本、hash、系统要求及测试，不能仅改版本字符串。

开发包 `.build/native-macos/whale-native.app` 含本机路径，**不可作为 Release 附件**。发行脚本重新组装 `.build/release-*/whale-native.app`，内置 Node 到 `Contents/Helpers/node`，白名单源码和素材到 `Contents/Resources/app`。发行 launch.json 只含 mode/version/nodeVersion，不含 root/node/dataDir 绝对路径。

产物：

- `dist/whale-native-0.1.0-preview.1-macos-arm64.zip`
- 同名 `.sha256`
- `dist/release-build.json`：版本、目标平台、固定 Node 来源与 hash、压缩包 hash、签名和公证状态，不含本机路径。

脚本不覆盖已有同名 zip；重做时先将旧产物移到别处。verify 会检查 hash、文件白名单、签名及动态链接，并将 zip 解压到带空格的新目录，限制 PATH，**不传 --root 或 --node**，使用独立 fixture 数据启动真实 AppKit / WKWebView 冒烟，检查正常退出。它不会覆盖 /Applications 或停止正式实例。产物与验证输出均不入源码仓库。

## 公开发布

通过测试及隐私 / 来源检查后，将源码提交到 main，创建对应 tag，用 `gh release create` 创建 **prerelease** 并上传 zip、sha256 和 release-build.json。说明已实现功能、缺失功能、系统限制、未经公证提示、共享数据目录注意事项。保留验证结果，不把旧项目测试数量当新项目结果。

CI 仅在 push / PR 时运行自动验证，不自动创建或上传 Release，token 权限仅 contents:read。CI 结果与本地结果分开报告；未通过时不要声称已有绿勾。

## 安全与素材

上传前扫描 tracked 文件、发布包文件列表和文本中的用户路径 / 密钥标记，确认没有运行数据、截图、嵌套旧仓库或缓存。素材沿用上游来源边界，不追加公共领域 / MIT 素材授权声明。见 PROVENANCE.md。
