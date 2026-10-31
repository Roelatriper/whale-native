# 贡献与验证

仅维护 macOS / Apple Silicon。提交前请说明期望行为、实际行为、macOS 版本、是否从旧版共用数据目录，并注明真实账户 / 模拟数据。不要贴 API key、auth.json、完整聊天 JSONL、账本或个人路径截图。

先阅读 HANDOFF.md 和 docs/native-macos/INTERFACES.md。修改共享业务时保留金额精度、账本恢复、账号 / 模式隔离、未知余额不当作零、通知显示后再确认等语义。宠物 / 气泡不能激活或抢占其他应用焦点。设置可使用按需 WebView，不重新引入 Electron。

提交前执行：

```sh
TMPDIR=/private/tmp npm test
npm run native:scan-memory
npm run native:smoke
```

发行变更还必须执行 `npm run release:build` 与 `npm run release:verify`，验证解压后换路径、无需外部 Node / 源码即可运行及正常退出。测试使用隔离目录，不要用正式账本做 fixture。

新功能请先开 issue 讨论范围，PR 说明测试与未覆盖场景；CI 通过不是多屏 / 所有 macOS / 所有 API 服务商均已验收的保证。不要更换素材并笼统声明 MIT；补充真实来源与许可证据。
