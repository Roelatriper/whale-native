# 原生版开发入口

独立库为 `whale-native`，仅支持 Apple Silicon、macOS 13.5+，Swift / AppKit + Node 后台。设置按需使用 WKWebView；不包含旧 Electron / Windows 入口。安装与运行说明见根 README.md，维护地图见 HANDOFF.md。

## 开发构建与发行构建不是同一个包

- `npm run native:build`：生成 `.build/native-macos/whale-native.app`，使用当前源码与 Node 的绝对路径，只供本机开发。
- `npm run release:build`：固定并校验官方 Node 24.22.2，复制白名单业务代码、设置页和素材，生成自包含 zip；发行 launch.json 无本机路径。
- `npm run release:verify`：解压到带空格的新目录，用内置 Node 和独立测试数据执行真实 AppKit / WK 冒烟。不传 --root / --node，不依赖 PATH 中的 Node。
- `npm start`：构建 / 打开开发包；已有原生实例时仅恢复显示，不会热更新。
- `npm run native:stop`：通过已认证本地 IPC 正常退出原生版。

修改源码后先正常退出再打开。运行包的资源 root 由 Bundle.main 定位，Node 位于 Contents/Helpers/node；数据目录在接收者机器上由 WHALE_HOME / CODEX_HOME / 用户主目录推导。bundle id 保持 `com.api-balance-whale.native`，名称为 `whale-native.app`。

## 隔离验证与内存

```sh
TMPDIR=/private/tmp npm test
npm run native:smoke
npm run native:scan-memory
npm run native:measure
npm run native:measure -- --sessions --samples 3
```

smoke / measure 的数据仅写入独立 `/private/tmp/whale-native-*`。默认使用模拟余额与模拟配置，不查询真实账单。measure --sessions 才会只读观察实际 Codex 会话，但临时账本不写回正式目录；此类报告关联个人用量，不应公开。

measure 使用 macOS phys_footprint，测 Swift + Node；不能把各进程不同时刻峰值相加。打开设置可能创建 WebKit 辅助进程，完整设置场景还需要单独测其总占用。历史测量见 MEMORY-OPTIMIZATION.md，不是新发行包内存上限。

## 与旧版共存

默认仍用 `~/.codex/whale-widget`，支持 CODEX_HOME / WHALE_HOME。不要并行运行使用同一目录的旧版与原生版。切换前正常退出旧版并暂停旧版自动服务；本库不会自动修改旧 LaunchAgent，也不提供旧版恢复入口。旧恢复回执由旧项目管理。

正式运行会按正常业务读写配置、账本和素材。首次切换前可自行备份。测试不停止正式实例，不覆盖 /Applications。不存在“构建通过就代表所有机器已验证”的保证。
