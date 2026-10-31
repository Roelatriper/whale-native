# 原生版接口定义 · JSONL v1

## 传输及生命周期

Swift 启动 `node desktop/native/backend.mjs --data-dir <absolute-directory>`。父进程的 stdin/stdout 专用于 UTF-8 JSON，每行一个消息；stderr 才能输出诊断。没有额外 HTTP 监听端口，也不把凭据放入启动参数。stdin EOF、SIGTERM 或 `shutdown` 触发正常关闭：关闭本地 IPC、会话观测、账本/日志写入，移除自己拥有的锁。

请求可并发，响应可乱序；用正整数 `id` 匹配。Swift 请求 35 秒超时；Node 输入缓存限制 36 MiB，Swift 帧缓存限制 48 MiB；现有 dispatcher 请求体仍最多 32 MiB。大型 base64 素材会有瞬时复制开销，第二阶段可改为文件/流传输。不能无限排队大文件。

协议是同一用户的父子私有管道，独立于既有 token 鉴权的 Unix socket。`native-session.lock/owner.json` 防止多个原生后台；启动前检测旧 IPC 活跃性。绝不因磁盘记录的 PID 就终止进程。设置 WebView 仅允许 `whale://widget` 主框架进入请求桥，外站导航被拒绝。

请求：

```json
{"v":1,"id":1,"method":"snapshot","params":{"force":false}}
```

响应：

```json
{"v":1,"id":1,"ok":true,"result":{"protocol":1,"mode":"subscription","display":{"label":"Codex 剩余额度","amount":"5h 额度 80.0%","hint":"周额度 35.0%"}}}
```

错误：

```json
{"v":1,"id":1,"ok":false,"error":{"code":"REQUEST_FAILED","message":"本地操作失败，请检查请求或设置"}}
```

`BAD_JSON` 的 id 为 null。v 不为 1、非整数/非正 id、未知 method/action、无效路径都拒绝。错误消息不回传堆栈、密钥或 provider 原始响应。

## 请求方法

| method | params | result / 语义 |
| --- | --- | --- |
| `snapshot` | `{force?:boolean}` | 按持久化的展示模式读取余额或订阅；返回完整投影 |
| `action` | `{name:string,args?:object}` | 下表定义的原生操作 |
| `request` | `{route:string,method?:string,body?:JSON}` | 代理现有 dispatcher，返回 `{status,headers,body}`；body 为 base64 |
| `shutdown` | `{}` | 返回 `{stopped:true}` 后正常退出；Swift 等待实际进程退出 |

`request.route` 必须为单斜线开头的本地路径，不能含反斜线/控制字符；不接受任意 HTTP URL。HTTP 方法由现有 dispatcher 继续校验。授权的本地设置界面可更改原本允许的配置/素材；不提供 shell 执行、任意文件路径或任意网络转发能力。

## action

| name | args | 行为 |
| --- | --- | --- |
| `refresh` | `{}` | 强制刷新当前展示模式并发布 snapshot |
| `mode` | `{mode:"api"\|"subscription"}` | 持久化展示选择，再刷新；不更改登录方式 |
| `preferences` | 原生外观增量 | 严格校验、原子写入 native-ui-state.json，再发布偏好 |
| `bubble-open` | `{}` | 读取现有气泡配置并重置点击序列；返回 API 首屏或订阅额度首屏 |
| `bubble-next` | `{}` | 返回下一屏，耗尽时为 `{closed:true}`；不在刷新时重抽留言 |
| `bubble-pet` | `{}` | 已打开会话中，进入/重新抽取当前文案步骤，不返回额度首屏；也不消耗下一屏游标 |
| `random` | `{}` | 从原版默认后续屏按权重抽取原文案或 petpet；保留诊断兼容入口 |
| `ack-account` | `{id:string}` | 在**实际显示后**确认该账户消费批次；复用现有范围验证和幂等确认 |

## 事件

```json
{"v":1,"event":"ready","data":{"protocol":1,"renderer":"appkit","pid":1234,"fixture":false}}
```

| event | data | 接收方义务 |
| --- | --- | --- |
| `ready` | 如上 | 只代表后台及 IPC 初始化；不代表图片已解码或真实余额可用 |
| `snapshot` | `{protocol,mode,display,preferences,roles,at}` | 更新额度、偏好及角色菜单；mode 二选一 |
| `notice` | `{id,kind,display,outcome?,accountId?,scope?}` | 可见后展示；账户通知显示后才 ack；隐藏时暂存 |
| `invalidate-notices` | `{reason:"mode"\|"account-scope"\|"settings"}` | 清空旧队列/旧气泡；不能确认未显示的账户批次 |
| `show` | `{resetPosition?:boolean}` | 恢复显示，不能激活原宠物/气泡窗口 |
| `shutdown` | `{}` | 请求退出 Swift 应用 |
| `error` | `{message:string}` | 展示安全错误信息，不能当作零余额 |

余额/通知 `display` 保留 `{label:string,amount:string,hint:string}`，消费提示可附加 rows 来保留原版红色金额与字号。点击序列可附加 `{kind:"message"|"image",rows:[{text,size,bold,italic,underline,color,gradient}],imageRoute?:string}`；关闭指令仅为 `{closed:true}`。size 以原版 1026 viewBox 单位表示，Swift 随视图缩放并按安全内框适配。imageRoute 仅生成安全 id 的 `/dsh-whale/bubble-img.png?id=...`。当前不支持混合图片与文字同屏完整排版；不要据此宣称复杂模块等价。

原生界面只拿投影后的文本，不自行猜余额/订阅数据。`roles` 仅含 `{id,name}`。刷新存在并发时只允许最新 revision 发布，旧模式请求不能覆盖新模式。JS 共享通知政策来自现有 `turn-notice.js`、`account-view.js`、`balance-view.js` 的隔离 UMD adapter，不复制金额语义。

`native-bubble.mjs` 从独立的 `assets/bubble-defaults.json` 读取原 BUBBLE_DEFAULT_ITEMS，保留 48 条文字、样式及选项权重；不携带或执行旧版浏览器宠物脚本。保存的序列上限 256 步，每屏最多 6 个模块；图片按已有素材路由读取，关闭/切屏释放图片和帧计时器。Swift 的 bubbleRevision 拒绝迟到的图片或点击请求覆盖新场景。

Swift 首次宠物点击调用 bubble-open，会话打开后调用 bubble-pet；点击气泡仍调用 bubble-next。隐藏/关闭重置 Swift 的 conversationOpen，模式/账户失效也清除后台 conversationMode，旧请求不能跨模式返回 API 金额。当前步骤为加权 choice 时刷新重抽选项；随机文字会重新抽取，有不同备选时避免连续同句。固定文本没有备选内容，不虚构替代文案。

BubbleView 管理一次性的旧画面快照和至多一个最新待呈现画面；opacity 使用 Core Animation，默认进出 0.18 秒、切屏 0.2 秒，系统减少动态效果时为 0.1 秒。图片加载完成才开始切屏。原生确认及 TTL 在进入/切屏完成且 revision 仍匹配时触发；淡出完成后才 orderOut/释放媒体。模式失效、隐藏宠物、退出使用立即清理；普通关闭使用淡出，可被新的点击打断。

通知投影还检查 context epoch：模式/配置切换会使已在读取中的旧消息失效；模式切换前读到的 API 金额不能在订阅模式发布。Swift 队列最多 16 条；满时优先淘汰旧任务提示，保留账户批次。原生短队列不是账本，丢弃提示不能等同于消费丢失或账户批次确认。

## 原生外观（schema 1）

文件：数据目录中的 `native-ui-state.json`。GET/PUT `/native/preferences` 供设置页面；action preferences 供 Swift。增量保存，未提交字段保持原值；写入失败不更新内存快照。

| 字段 | 类型/范围 | 默认 |
| --- | --- | --- |
| version | 1 | 1 |
| scale | number，0.5–2.5 | 1 |
| flipped | boolean | false |
| sound | boolean | 读取旧 sound，缺省 true |
| volume | number，0–1 | 读取旧 vol，缺省 0.6 |
| soundSet | duck / fx1 | duck |
| outsideDismiss | boolean | 读取旧 outsideDismissOn；未开启则 false |
| followMode | standalone / follow-codex | 读取旧 follow-config 的 mode |
| role | 安全资源 id，1–100 字符 | default |
| position | null 或 `{x:number,y:number}` | null |
| taskNotices | boolean | true |
| bubbleSeconds | number，0–60；0 不自动关闭 | 8 |

position 是 **AppKit 全局屏幕点坐标，左下为原点**，不是网页视口坐标；不直接复制 Electron 的位置、比例和 DOM 状态。超出屏幕的坐标需由 AppKit clamp。未知字段、路径式 role、NaN/Infinity、字符串开关一律拒绝。

## WebView 资源与设置桥

GET `/native/settings.html` 由现有表单生成，只加载设置相关脚本，不加载 1.18 万行宠物脚本或原生替代的绘制循环。GET `/native/settings.js`、`/native/settings.css` 为原生页面资源。

资源 GET 通过 WKURLSchemeHandler → request。fetch 在主框架 document start 注入，以 `window.webkit.messageHandlers.whale.postMessage({id,route,method,body})` → request → `__whaleNativeReply(...)` 返回标准 Response。JSON POST/PUT 显式走消息桥，避免依赖自定义 scheme 对 POST body 的实现差异。无外部网络 fetch。文件导入用 NSOpenPanel，blob JSON 导出用 WKDownload/NSSavePanel。

复用的核心业务接口仍见 `runtime/dispatcher.mjs`：`/api/config`、`/api/display-mode`、`/api/insights`、`/api/account-notices`、`/api/account-notices/ack`、`/api/balance-preview`、`/api/balance-selection`、`/api/workshop/*`、`/dsh-whale/*`。敏感值继续遵循原来的隐私 DTO 和同源/专用密钥规则。

## 文件所有权及诊断

- 原有连接、账本、素材：仍由现有 Node 模块读写；Swift 不直接修改账本。
- native-ui-state.json：原生外观持久化；不存密钥。
- native-status.json：schema/stage/renderer/appPid/backendPid/ready/petVisible/bubbleVisible/settingsOpen/imageValid/pressed/focusablePet/pendingNotices/manuallyHidden/bubbleClosing/bubbleTransitioning/at；每 5 秒及关键状态更新，不含金额、密钥或聊天内容。bubbleVisible 在淡出完成前仍为 true，不等于仍接受新消息展示。
- runtime.json：沿用原认证本地 IPC；原生版记录的 pid 是 Node 后台，不是 Swift app。
- 旧版 native-transition.json 若存在仍由旧项目管理；本库不自动暂停 / 恢复旧 LaunchAgent，不发布本机恢复回执。
- fixture 的 native-smoke.json / native-memory.json：测试结果，不能冒充真实账户验证。

退出超时只可终止当前 Swift 自己启动、仍由 Process 对象持有的 Node 子进程。不得依据旧状态文件 kill 任意 PID。

`/api/status` 保留 renderer/nativeStage/protocol/appPid，并报告 desktopMode/followCodex/visible/manuallyHidden；rendererReady 仅在 native-status 的 appPid 属于当前父进程，且 ready/imageValid 均为 true 时为 true。不能把 Node ready 事件当作宠物已呈现。

## 集成中已修复的退出问题

本机 AppKit 的 `.terminateLater` 进入退出等待后，`Process.terminationHandler` 中排到 DispatchQueue.main 的完成回调没有执行，造成 Node 已退出但 app 留在后台。当前实现先返回 `.terminateCancel` 保持普通主循环，完成后台关闭后再发起第二次 terminate；只有 shutdownComplete 才返回 `.terminateNow`。不要把它改回“看起来更标准”的 terminateLater 而不跑原生退出回归。
