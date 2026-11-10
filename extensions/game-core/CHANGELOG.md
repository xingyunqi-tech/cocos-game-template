# game-core 变更记录

## 2.3.1

- 小游戏广告：同一广告实例上一次展示尚未结束（如 `AdService` 已按超时返回）时再次展示，上一次展示以 `failed` / `show_failed` 结束、解绑监听并停止其重试，之后的关闭事件只回调本次展示，同一次观看只产生一个 `completed`；被取代的插屏展示不销毁实例
- 支付：`recoverOrders` 已回调过最终结果的订单，之后到达的平台迟到结果不再经 `onLateResult` 回调，也不再写回待确认订单
- HTTP：主动刷新（`expiring`）失败后，等待它的请求不再立即发起第二次主动刷新，返回 401 时按过期刷新；401 引起的刷新遇到进行中的主动刷新时，主动刷新失败后按过期刷新
- 启动流水线：锚点步骤自身也有锚点时，依附它的步骤跟随它排列，同一锚点的多个步骤按注册顺序排列，与注册先后无关
- 远程配置：接口返回数组或原始值时按拉取失败处理，不覆盖上次缓存；返回 `null` 或空响应视为没有覆盖项
- `onSidebarLaunch`：回调抛错时上报错误，不影响注册与之后的回调
- 支付：`queryOrder` 同步抛错或 `ORDER_QUERY_TIMEOUT_MS`（15 秒）未返回时按 `pending` 处理，`recoverOrders` 并行查询各订单，不会中断或一直等待；`PaymentService` 构造参数新增 `queryTimeoutMs`；实现报告过订单号时，未超时返回的结果同样带上该订单号（`pending` 结果因此会保存）
- `AuthService.login`：登录进行中调用 `logout()` 或再次 `login()` 时，本次登录失败后以 `aborted` 拒绝并经 `onWarn` 报告原错误，不再离线进入
- `SoundService`：Bundle 释放后旧的加载失败时不影响之后的加载与缓存；广告暂停期间 `stopMusic` / `releaseBundle` 停止音乐，回到前台或广告结束后不再播放
- 小游戏广告：展示失败后重新加载也失败（如无填充）时 `reason` 为 `load_failed`
- `coreText` 新增 `loadingProgress`（`{percent}` 占位）、`confirmTitle`、`confirm`、`cancel`、`sidebarTitle`、`sidebarGo`，加载进度、默认确认框按钮与侧边栏引导弹窗使用这些文案
- HTTP：`HttpClientOptions.isAuthError(error)` 判断请求失败是否表示 token 失效并触发刷新，默认 `status === 401`，抛错时视为 false；后端用业务码表示失效时配合 `businessCheck` 使用；`http.isAuthError(error)` 供外部按同一规则判断；埋点上报遇到该类错误时与 401 一样保留重试
- `ServerTime.syncFromDateHeader`：已同步时推算时间落后 Date 头超过 `DATE_RESYNC_TOLERANCE_MS`（2 秒）则向前校准，不向后调整；每个无 `Age` 头的响应都参与核对
- `PlatformName` 接受内置名称之外的字符串，`configureCore({ platform })` 可注入自定义名称的平台
- `GameRoot`：`config.json` 的 `type` 没有对应环境配置（或配置不是对象）时输出错误日志并显示 `coreText.initFailed`
- `SaveStore`：存档版本与当前版本相同且内容为 `null` 时按数据读出，之后可正常写入
- `TrackUploader.flushAll()`：等待中的发送失败后返回，按退避等待下次发送
- GM 面板：切换环境后无法自动重载时关闭面板并提示重新打开游戏；点击环境按钮时按当前保存的设置判断是否需要切换

### 构建

- `scripts/lib/upload.mjs`：`REMOTE_UPLOAD_COMMAND` 中反斜杠转义按 POSIX shell 规则识别，`{dir}` 的引用方式按实际所在引号确定；`{dir}` 前有反斜杠时报错
- `scripts/update-core.mjs`：`game-core.old` 与 `game-core` 同时存在时，`game-core` 与锁定快照一致则删除残留的 `game-core.old`，否则中止并保留 `game-core.old`；恢复失败的提示与实际恢复条件一致
- ESLint：业务代码禁止直接访问 `self`
- `scripts/lib/cocos.mjs`、`scripts/smoke-web.mjs`：`COCOS_CREATOR_APP`、`CHROME_PATH` 为空时使用默认安装路径
- `scripts/tables.mjs`：表名只改大小写时把原 JSON 与 `.meta` 重命名为新表名后写入，保留资源 UUID，不区分大小写的文件系统上不再删除新生成的 JSON

## 2.3.0（2026-10-29）

- `IPayment.pay(item, hooks?)`：实现在服务端订单创建后调用 `hooks.onOrder(orderId)`，平台超时返回的 `pending` 结果带上该 `orderId`；`payment.onLateResult(listener)` 回调超时之后平台给出的结果（实现报告过订单号时带上该订单号），埋点事件为 `pay_late_result`；新增类型 `PayHooks`、`LatePayListener`
- `initGameCore`：`config.json` 的 `type` 没有对应环境配置时抛错；初始化中途抛错后再次调用抛出同一错误
- `GameRoot`：`initGameCore` 抛错时上报错误并显示 `coreText.initFailed`（“启动失败，请重新打开游戏”）
- `loginFallback: 'guest'` 离线进入时，上次 userId 没有存档而游客存档有数据，以游客身份进入，之后联网登录时游客存档可并入账号；`AuthServiceOptions.preferGuest`、`SaveStore.hasData(scope)`
- 启动登录进行中触发的 token 刷新复用该次登录，不再并发发起第二次平台登录；启动登录被取消时改为自行登录
- 数组或原始值存档版本递增时，原存档先备份到 `__bak` 再使用默认值
- `SaveStore.adoptScope` 判断当前作用域是否有存档时，同时检查已注册 slot 的 key，索引缺失时不覆盖已有存档
- 抖音录屏：停止超时后，下一次录制录满时长自动结束的视频正常保存
- 启动步骤以 `undefined` 拒绝或抛出时按失败处理
- `reportError(undefined)` 的 message 为 `'undefined'`
- `ads.onLateResult(listener)`：广告展示超时返回 `timeout` 之后平台给出的结果，埋点 `ad_late_result`；展示超时按已展示计入频控；新增类型 `AdKind`、`LateAdListener`
- 错误上报到 `trackPath` 时经过 `ErrorThrottle`：来源、信息与上下文相同的错误 60 秒内只上报一次，每分钟最多 30 条；合并次数（`context.repeated`）与丢弃数（`context.dropped`）随下一次上报或切后台时补报；日志输出不受影响；新增 `ErrorThrottle`、类型 `ErrorThrottleOptions`
- 上传：`REMOTE_UPLOAD_COMMAND` 中的 `{dir}` 按所在引号替换为对环境变量 `REMOTE_DIR` 的引用；抖音上传被信号中断时删除临时 token 目录；构建与上传被中断时按信号返回退出码（SIGINT 130、SIGTERM 143、SIGHUP 129）
- 配置表：字段名为 `__proto__`、int 超出安全整数范围、float 溢出时报错
- `RemoteConfig`：远程值按默认值深合并，类型与默认值不一致的项（数组按元素类型）忽略并在加载时经构造参数 `onInvalid` 报告（`remoteConfig` 输出警告日志），`__proto__` 键忽略；重新加载期间、失败或返回非对象且没有缓存时保留当前值，`load()` 不传拉取函数时恢复默认值；新增类型 `InvalidRemoteValue`
- HTTP：调用方传入的 `accept`、`authorization` 等请求头不区分大小写，不再与默认的 `Accept`、`Authorization` 同时发出；`XhrTransport` 的 `open`、`setRequestHeader`、`send` 抛错时以 `network` 失败并清理计时器
- `coreUi.confirm` 默认确认框的节点被外部移除或销毁时返回 `false`
- 升级脚本：替换 game-core 或锁定文件失败时恢复原插件与锁定文件，不留下 `game-core.next`；恢复也失败时提示原插件所在目录
- 上传检查读取带 md5 后缀的 `src/settings.<hash>.json`；缺少、多个或无法解析时拒绝上传
- 待确认订单：带 `orderId` 的 `pending` 结果保存在 `userSave`（slot `pay_orders`），迟到结果为成功或失败时移除；`payment.recoverOrders()` 逐个 `queryOrder`，查到成功或失败的订单移除并经 `onLateResult` 回调（同一订单只回调一次），超过 7 天的订单直接移除，由业务在设置支付实现与 `onLateResult` 后、联网登录就绪时调用；`IPayment.queryOrder` 返回 `failed` 表示订单已关闭，查询失败时应 reject 或返回 `pending`；新增 `payment.setOrderStore`、`payment.pendingOrders()`、`ORDER_MAX_AGE_MS`，类型 `OrderStore`、`PendingOrder`；`PaymentService` 构造参数新增 `now`
- 埋点：配置 `trackPath` 时切后台把未上报的记录（最新的 `TRACK_PERSIST_MAX` 200 条且不超过 `TRACK_PERSIST_MAX_BYTES` 100 KB）保存到 `deviceSave`（slot `track_queue`），下次启动先补发 3 天内的记录；保存后每批发送成功或丢弃时同步更新，队列清空时删除；`TrackUploaderOptions` 新增 `persist`、`maxAgeMs`、`now`
- 升级脚本读取 `.env.local`，`GAME_CORE_SOURCE` 可写在其中

## 2.2.0（2026-10-29）

- `DailyCounter` / `createDailyCounter(key)`：按天计数与上限（`uses`、`remaining`、`record`、`tryUse`），跨天清零，日期回拨时沿用已记录的计数
- `DailyFlags` / `createDailyFlags(key)`：每天一次的标记（`canClaim`、`claim`），日期回拨时不能领取，领取时清除过期记录
- `LoginStreak` / `createLoginStreak(key, cycleDays)`：连续登录天数与周期完成判断
- `Wallet` / `createWallet(key, { defaults, version?, migrations? })`：货币与道具数量（`get`、`add`、`spend`、`exchange`、`onChange`），拒绝负数、NaN 与无穷大
- 工厂按 `serverTime.today()` 计算日期，数据存在 `userSave`，用户就绪（`onUserReady`）前只读；`DailyCounter` 的存档格式为 `{ date, counts }`
- `dayNumber`、`isRollback`、`ROLLBACK_TOLERANCE_DAYS`：记录日期比今天晚 1 到 2 天视为日期回拨，更晚视为错误日期
- `sidebarReward`：日期回拨时视为今天已领取

## 2.1.0（2026-10-29）

- token 主动刷新：会话剩余有效期小于 `refreshAheadMs`（默认 60 秒，可用 `auth.configure` 设置，`0` 关闭）与有效期一半中的较小值时，下一个需要鉴权的请求先刷新 token 再发送（带 `skipRefresh` 的请求除外）；主动刷新失败时保留会话，30 秒内不再主动刷新。`TokenProvider` 新增可选的 `shouldRefresh()`，`refresh` 接受可选参数 `'expiring' | 'expired'`
- `AuthSession.expiresAt`：服务端未返回有效期（`expiresIn` 缺失或不大于 0）时为 0
- `ads.preloadRewarded(placement)`：提前加载激励视频；`AdProvider` 新增可选的 `preloadRewarded(unitId)`，小游戏实现为创建广告实例并 `load()`
- 平台广告展示期间暂停正在播放的背景音乐，结束后恢复（期间停止、切换音乐或关闭音乐开关时不恢复），`coreOptions.pauseMusicDuringAds` 控制，`sound.pauseForAd()` / `sound.resumeAfterAd()`；`AdServiceOptions.onShowingChange` 在平台广告开始与结束展示时回调
- `privacy.require()`：主动触发隐私授权，需要时弹出隐私弹窗并返回是否同意；`IPlatform` 新增可选的 `requirePrivacyAuthorize()`，微信使用 `wx.requirePrivacyAuthorize`，平台没有该接口时返回 true

## 2.0.0（2026-10-29）

- `configureCore({ platform, store, transport })`：在模块顶层、`initGameCore` 之前替换平台实现、`deviceSave` / `userSave` 的存储后端、HTTP 传输层（设置 `transport` 后忽略 `httpMock`）；`initGameCore` 之后调用抛错
- `AuthService` 协议适配：`auth.configure` 接受 `buildLoginBody`、`parseLoginResponse`、`buildRefreshBody`、`parseRefreshResponse`，解析函数抛错按响应无效处理；新增类型 `AuthProtocol`、`LoginRequest`
- `http.onError(listener)`：请求最终失败时回调，可注册多个，返回取消函数；监听抛错不影响其他监听
- 启动流水线失败重试时只执行未成功的步骤（登录等已成功步骤不重复执行，`onUserReady` 不重复回调）；`BootPipeline.reset()` 清除完成记录
- `coreText`：模板界面文案集中定义，可在模块顶层修改；`coreUi.setSettings`、`coreUi.setDocument` 替换设置面板与协议页（隐私流程中的查看入口同样使用替换后的协议页）
- 侧边栏回调与 `sidebarReward` 以用户就绪（`onUserReady`）为准；`configureCore({ platform })` 之前注册的侧边栏回调随平台替换迁移
- 类型扩展点统一为 `db://game-core/augment`（`TableMap`、`RemoteSettingsMap`）
- `migrate` 从公开入口导出
- `AdPolicy.useClock(now)`：换用另一个时钟并重新计时
- `SaveStore.reload()`：丢弃未写入的修改与读取缓存，之后从存储重新读取
- 隐私弹窗标题、同意 / 拒绝按钮与微信隐私保护指引入口文案改由 `coreText` 提供

### 迁移

- 类型扩展：`declare module 'db://game-core/config/Tables'`、`declare module 'db://game-core/config/RemoteConfig'` 改为 `declare module 'db://game-core/augment'`；合入「构建」中的 `scripts/lib/tables.mjs` 后执行 `npm run tables` 重新生成 `TableTypes.ts`
- `http.configure({ onError })` 移除，改用 `http.onError(listener)`；`HttpClientOptions.onError` 移除
- 公开入口移除 `TABLES_DIR`、`LOGIN_STEP_TIMEOUT_MS`、`STORAGE_WARN_RATIO`、`CONFIG_LOAD_ATTEMPTS`、`CONFIG_PATH`、`setSaveUser`、`CoreRemoteSettings`（用 `RemoteSettingsMap`）
- `assets/game/`、`assets/bundles/` 中引用 `db://game-core/<路径>` 或 `game-core/assets/...`（`db://game-core/augment` 除外）被 ESLint 禁止，改为从 `db://game-core` 引用；测试不受此限制，可继续按路径引用不依赖引擎的模块（公开入口会加载引擎与 oops，不能在 Node 测试中导入）
- 启动步骤失败后点击重试不再重跑已成功的步骤；依赖"重试时全部步骤重新执行"的业务步骤需改为在业务入口或 `onUserReady` 中处理

### 构建

- `scripts/lib/tables.mjs`：生成的 `TableTypes.ts` 扩展 `db://game-core/augment`
- `eslint.config.mjs`：业务层禁止引用 game-core 除公开入口与 `augment` 以外的路径

## 1.2.3（2026-10-28）

game-core 代码无变更，本版本只有构建脚本与工程配置，需按下列条目从模板仓库手工合入。

### 构建

- `scripts/lib/cocos.mjs`、`scripts/build.mjs`：发布构建自动把 `config.json` 切到 `prod`，构建结束（含中断）后还原，构建被强制结束时下次构建从 `temp/build-env/` 的备份还原；`--env dev|test|prod` 指定环境；构建日志按 UTF-8 收集并在退出前写完
- `scripts/smoke-web.mjs`：只做通用检查，游戏相关检查移到 `scripts/smoke-game.mjs`（默认导出 `smokeGame(ctx)`，可替换或删除）；协议页只检查有内容；远程配置检查只在 `httpMock` 且 `remoteConfigPath` 非空时进行；静态服务只监听 127.0.0.1，拒绝目录外路径与非法 URL 编码
- `scripts/tables.mjs`、`scripts/lib/tables.mjs`：全部表转换与类型生成成功后才写文件；过期表在新文件写入后删除；`npm run tables -- --check` 只比对生成物与 Excel，不一致时失败
- `scripts/update-core.mjs`：替换插件目录失败时恢复原目录；上次升级中断留下 `extensions/game-core.old` 且插件目录缺失时先恢复
- `package.json`：`verify` 增加 `npm run tables -- --check`；`typecheck` 增加 `tsc -p tsconfig.scripts.json`（新增文件，检查 `scripts/` 与根目录脚本）；`@eslint/js`、`globals` 改为精确版本
- `eslint.config.mjs`：检查 `.mts` 文件；`scripts/smoke-game.mjs` 使用浏览器全局变量
- `.github/workflows/ci.yml`：build job 用 `actions/setup-node` 固定 Node 22
- `.prettierignore`：去掉与 `.gitignore` 重复的条目

## 1.2.2（2026-10-28）

- `SaveStore`：缺少迁移步骤或迁移抛错时读到默认值且不写入，原存档保留；存档无法解析时原文备份到 `<前缀>:__bak:<作用域>:<key>` 后允许写入；`set()` 前未读取过的 slot 先按读取规则判断能否写入
- 音乐开关：重新打开时播放 `sound` 记录的当前背景音乐（关闭期间 `playMusic` 的新曲目）；`stopMusic`、`releaseBundle` 之后重新打开不再播放已停止的音乐；不循环的音乐播完后不再是当前背景音乐
- 广告：平台 180 秒内没有返回展示结果时按失败返回（`reason: 'timeout'`）并可继续展示新广告，`ads.configure({ showTimeoutMs })` 可调整，0 或 Infinity 不限时；插屏频控改用平台单调时钟，修改系统时间不影响
- 抖音录屏：录制中重复调用 `stop()` 返回同一结果，只调用一次平台 `stop`；平台 5 秒内没有回调或 `stop` 抛错时返回 null 并可重新录制，超时后迟到的停止回调被忽略
- `AuthService`：离线重连与 401 触发的重新登录共用同一次登录；刷新 token 遇到网络错误、超时或 5xx 时保留会话、不重新登录；`logout()` 后不再自动重新登录，直到再次调用 `login()`；`logout()` 或 `login()` 之前发起的刷新与重新登录完成时不覆盖当前会话
- `HttpClient`：401 刷新 token 期间可取消请求；等待中的刷新失败后，排队的请求遇到 401 不再发起新一轮刷新
- 侧边栏：登录完成前从侧边栏切回前台，登录后回调 `onSidebarLaunch`
- `MockTransport`：处理函数执行期间请求被取消时以 `aborted` 失败
- `AdFailReason` 增加 `'timeout'`

## 1.2.1（2026-10-26）

- `SaveStore.adoptScope(from)`：当前作用域没有存档时，把 `from` 作用域的存档移入当前作用域并删除来源；写入失败时撤销已复制的 key、保留来源
- 登录成功时，若登录账号在本设备还没有存档，自动并入本设备游客身份（`guest-<设备 ID>`）的存档；`AuthService` 新增 `guestId`

## 1.2.0（2026-10-16）

- `serverTime`：单调时钟改由平台提供（`IPlatform.monotonicNow()`，小游戏用 `getPerformance` 并自动判定毫秒或微秒）；平台不提供时 `calibrated` 为 false；新增 `synced` 表示已与服务器时间同步，HTTP `Date` 头只在未同步时用于校准。`ServerTimeOptions.monotonic` 可返回 null
- `SaveStore`：本地存档版本高于 slot 版本时读到默认值且不写入；同一存档对象中 slot key 重复注册时抛错
- `npm run new:module` 拒绝与 game-core 存档 key 冲突的模块名（`sidebar`）
- `sound.playMusic`：加载期间被新的 `playMusic` 或 `stopMusic` 取代时不再播放
- 抖音录屏：启动中调用 `stop()` 会中止本次录制，`start()` 返回 false
- `HttpClient` 不区分大小写判断已有的 Content-Type；`XhrTransport` 以小写发送请求头名，覆盖小游戏 adapter 默认的 `content-type`
- 埋点上报：发送失败后的退避期间不再因满批立即发送；上报请求带 `skipRefresh`（新增 `HttpRequest.skipRefresh`：携带 token，401 时不刷新、不重新登录），401 改为退避重试；2xx 但响应解析或业务校验失败时丢弃该批，不再重发
- `AuthService`：平台登录（`wx.login` / `tt.login`）10 秒无响应按网络失败处理，可用 `platformLoginTimeoutMs` 调整，并响应启动步骤的取消
- 启动流水线：`before` / `after` 改为执行时解析，锚点可以晚于本步骤注册；同一锚点的多个步骤按注册顺序排列；锚点缺失或循环依赖时 `run()` 与 `stepNames` 抛错；同时指定 `before` 与 `after` 时注册抛错
- 业务入口抛错时显示“启动失败，点击重试”，点击后重新调用入口，成功后不再调用
- `smoke:web` 覆盖启动步骤失败后点击重试
- 远程配置：`RemoteSettingsMap` 可由业务 `declare module` 扩展，`remoteConfig.setDefaults()` 提供默认值；`RemoteConfig` 构造参数改为 `Partial<T>`；`CoreRemoteSettings` 保留为 `RemoteSettingsMap` 的别名
- `onUserReady(listener)`：登录步骤完成（含离线进入）或离线进入后重新联网登录成功时回调；`AuthService` 新增 `offline`、`onRecovered`
- `releaseBundle(name)`：停止来自该 Bundle 的背景音乐、丢弃音频缓存并释放 Bundle；`sound.forgetBundle(name)`
- `SafeTopAdapter`：节点有纵向对齐的 Widget 时调整 top / verticalCenter / bottom（含百分比），不再改坐标被 Widget 覆盖
- 结构：`core.ts` 只负责装配与启动步骤注册顺序，单例与功能拆到 `wiring/`（`services`、`sidebar`、`ui`、`auth`、`remote`、`mocks`），公开接口不变；读取 oops `GameConfig` 内部字段收敛为 `config/env.ts` 的 `gameConfigData()`
- 远程配置缓存 key 增加 envVersion（升级后首次启动的旧缓存失效一次）

### 迁移

- 自定义 `IPlatform` 实现需增加 `monotonicNow()`
- 同一存档对象中重复调用 `slot(key)` 会抛错，在函数内创建 slot 的代码改为模块顶层创建一次
- 多个启动步骤以同一锚点 `after` 时改为按注册顺序排列
- `SafeTopAdapter` 所在节点有纵向对齐的 Widget 时调整 Widget 对齐值，不再改坐标
- `XhrTransport` 以小写发送请求头名

## 1.1.0（2026-10-16）

- `payment`：`IPayment` 接口（`pay(item)` 返回成功、失败、待确认与原因，可选 `queryOrder`），`PaymentService` 拒绝并发支付、120 秒未回调返回 `pending`、支持 GM 模拟；三端默认 `unsupported`
- `serverTime`：登录响应 `serverTime` 校准，校准后按单调时钟推算、不受修改系统时间影响，未校准时用 HTTP `Date` 头（跳过带 `age` 头的缓存响应）；`now()`、`today()`（默认东八区）；`sidebarReward` 按服务器时间的自然日判断，`SidebarRewardOptions` 新增可选 `today`（缺省为本机日期），`now` 选项移除
- `sound`：按 Bundle 与路径播放音乐、音效并缓存（加载失败 10 秒内不重试）；`coreOptions.clickSound` 为模板按钮设置点击音效；启动时音乐开关为关、之后打开时播放当前背景音乐
- Bundle 工具：`loadBundle`、`preloadBundle`（进度不回退）、`loadAsset`
- `AuthService`：`LoginResponse.serverTime`、`onServerTime`
- GM 面板增加支付模拟

### 项目侧资源

- `settings/v2/packages/builder.json`：Bundle 配置预设 `subpackage`（小游戏分包）、`remote`（远程 Bundle）
- `assets/bundles/demo/`：示例业务 Bundle（排行榜 prefab 界面、界面脚本、背景音乐与点击音效）
- `assets/game/demo/ui.ts`：UIID 与 UIConfig 注册示例

### 构建

- `update-core` 拉取 tag 时不输出 detached HEAD 提示
- ESLint 业务层约束覆盖 `assets/bundles/`

## 1.0.0（2026-10-15）

首个发布版本，包含 0.1.0 至 0.5.0 的全部内容。

- 配置表：`Tables.get(name, id)`、`Tables.all(name)`，类型由生成的 `TableTypes.ts` 扩展 `TableMap`；启动步骤 `tables` 在 `login` 之前加载 `resources/tables`
- 远程配置：`config.json` 的 `remoteConfigPath` 非空时启动拉取（附 platform、version、envVersion，单次 2.5s 不重试），成功缓存；失败或超时使用同一平台、版本、服务器的缓存，否则用默认值；`RemoteConfig.load` 增加 `fallback` 参数，来源增加 `cache`
- 埋点上报：`trackPath` 非空时 `TrackUploader` 批量上报埋点与错误（20 条或 10 秒一批，失败指数退避，4xx 与序列化错误丢弃该批，缓冲上限 500 条，切后台发送全部）
- 抖音录屏：`platform.recorder`（`IRecorder`），时长 3 到 300 秒，自动结束时保留视频，视频分享到 video 频道；其他平台 `supported` 为 false
- GM 调试面板（调试构建）：切换环境、广告模拟（`ads.simulate`）、模拟侧边栏进入、性能面板、清空存档；`coreOptions.gm` 控制
- `setGameEntry` 注册的入口只执行一次
- 导出 `fetchRemoteConfig`、`TABLES_DIR`、`Tables`、`TableStore`

### 项目侧资源

- `assets/resources/config.json` 各环境新增 `remoteConfigPath`、`trackPath`
- `config-tables/`、`assets/resources/tables/`、`assets/game/tables/TableTypes.ts`：配置表源文件与生成结果

### 构建

- `npm run tables`（新增 devDependency `exceljs`）、`npm run new:module`、`scripts/update-core.sh`
- `scripts/check-plugins.mjs`：锁定文件记录版本；版本号以 `-dev` 结尾时只提示差异
- `.prettierignore` 忽略配置表生成结果；`.github/workflows/ci.yml`

## 0.5.0（未发布）

- `setGameEntry(entry)`：业务入口，启动流水线完成并关闭加载页后调用，只执行一次；未注册时只打日志，删除 `assets/game/` 后项目仍可运行
- 导出 `visibleSize`、`setButtonText`

### 项目侧资源

- `assets/game/`：示例游戏「点点乐」，覆盖启动、登录、玩法、结算、分享、激励视频、插屏、存档、侧边栏复访奖励

### 构建

- `npm run build` 小游戏构建后按 `scripts/size-limits.json` 检查主包、分包、总包，超限失败；`npm run size` 单独检查
- `npm run upload:wechat`（miniprogram-ci）、`upload:douyin`（tt-ide-cli），上传前检查版本号、AppID、密钥与 remote 上传命令
- 构建注入 `REMOTE_SERVER` 远程资源服务器地址
- `build-configs/wechat.json`、`douyin.json`：开启 `md5Cache`（资源文件名带内容哈希）
- 上传排除 `remote/`；抖音 token 写入临时 `TMA_CLI_HOME`，上传后删除；上传前拒绝调试包、超限包与缺少远程服务器地址的 remote 构建
- 上传与远程资源流程未在正式账号执行，待正式 AppID、上传密钥与 CDN 就绪后验证

## 0.4.0（未发布）

- 通用 UI（代码构建节点，样式见 `THEME`，构建函数 `addButton`、`addLabel`、`addPanel`、`openModal` 等可复用）：`coreUi.confirm` 确认框（高度随正文，可带链接按钮）、`coreUi.setConfirm` 替换模板内全部确认框、`coreUi.openSettings` 设置面板（音乐、音效、震动，隐私政策与用户协议入口）、`coreUi.openDocument` 协议页（按行渲染、可滚动，文本取自 `resources/legal`）、断网横幅、版本更新确认弹窗、`coreUi.createSidebarEntry` 抖音侧边栏入口；设置面板与协议页重复打开时不叠加
- 顶部避让：`getDesignInset()` 返回 `top`（避开刘海与胶囊）与 `safeTop`（仅刘海），换算为设计分辨率单位，Web 默认 20；`SafeTopAdapter` 组件
- 合规：启动时显示健康游戏忠告加载页（适龄提示占位、加载进度，至少展示 1.5s，启动失败时清空进度）；`privacy` 默认使用平台官方隐私弹窗，`privacy.useCustomPrompt(createPrivacyPrompt({ guideName }))` 改用自定义弹窗（上报曝光，同意或拒绝都可继续，平台无法打开指引时显示游戏内隐私政策）；`privacy.needAuthorization()`；`IAntiAddiction` 接口与平台托管实现
- `settings`：音乐、音效开关读写 `oops.audio`（重新打开音乐时恢复播放），震动开关存设备级存档，`settings.vibrate()` 关闭时不震动
- `sidebarReward`：从侧边栏进入每天可领取一次，登录前不可领取；`onSidebarLaunch` 在启动或切回前台且来自侧边栏时回调，登录前进入的在登录后回调
- `coreOptions`：`healthNotice`、`healthNoticeMinMs`、`ageRating`、`offlineBanner`、`offlineBannerText`、`updatePrompt`、`sidebarEntry`、`settingsTitle`

### 项目侧资源

- `assets/resources/legal/privacy.txt`、`agreement.txt`：隐私政策与用户协议占位文本，上线前替换
- `assets/resources/config.json` 各环境 `mobileSafeArea` 改为 `false`，顶部避让由 `getDesignInset` / `SafeTopAdapter` 负责

## 0.3.0（未发布）

- `platform`：`IPlatform` 的 Web、微信、抖音实现，按 `cc/env` 的 `WECHAT`、`BYTEDANCE` 选择；登录、会话检查、启动与 onShow 参数（启动时同步注册 onShow）、分享与分享菜单（重复设置替换监听）、系统信息、顶部避让（安全区与状态栏取大值，微信胶囊、抖音 `tt.getMenuButtonLayout`）、网络类型与变化、震动、剪贴板、隐私接口（曝光上报；查询失败按需要授权处理；抖音基础库低于 4.17.0 时不注册监听）、版本更新与下载失败、平台错误与内存告警钩子、envVersion、存储用量
- `ads`：`AdService` 按广告位映射广告单元，区分 `unsupported`、`not_configured`、`busy`、`frequency`、`load_failed`、`show_failed`；`AdPolicy` 频控（启动 30s 内不展示插屏、插屏间隔 60s、激励视频后 60s、错误码 2002 退避 30s，间隔从关闭时算起）；抖音插屏展示后销毁重建，展示失败同实例重新加载；展示后出错未关闭时按失败结束；Web 调试构建模拟成功，发布构建返回 `unsupported`
- `sidebar`：抖音侧边栏 `isSupported`（`tt.checkScene`）、`open`（`tt.navigateToScene`）、按场景值与 `launch_from`/`location` 识别侧边栏进入
- `auth`：启动步骤 `login`（超时 30s）调用 `POST /auth/login`（附 `deviceId`），成功后以 userId 设置 `userSave` 作用域；401 时 `POST /auth/refresh`，失败或无会话时重新登录；`loginFallback` 为 `guest`（默认）时登录失败以上次 userId 或 `guest-<设备 ID>` 进入，为 `last-user` 时仅网络失败且有上次 userId 才离线进入；离线后网络恢复自动重新登录，userId 不一致时本局不切换存档；`httpMock` 下内置按设备 ID 生成稳定 userId 的登录与刷新 mock
- `network`：在线状态变化时回调；`appUpdate`：新版本就绪、下载失败回调与应用
- 错误上报与埋点公共参数附 `platform`、`envVersion`；存储用量达到上限 80% 时告警（`checkStorageUsage(ratio)`）
- `ErrorSource` 增加 `memory`

### 项目侧资源

- `assets/resources/config.json` 各环境新增 `loginFallback`

### 构建

- `npm run build` 从环境变量 `WECHAT_APPID`、`DOUYIN_APPID`（可写入 `.env.local`）注入 AppID，未设置时使用占位值 `touristappid`、`testappId`；发布构建遇到占位值失败，`--allow-placeholder-appid` 放行

## 0.2.0（未发布）

- `bootPipeline`：启动步骤注册（权重、可选、超时、`before`/`after` 定位），步骤上下文提供 `signal`，进度与每步耗时，失败上报；必需步骤失败显示可重试的兜底提示
- `lifecycle`：订阅 oops `GAME_SHOW/GAME_HIDE`，切后台时 `deviceSave`、`userSave` 同步落盘
- 监控：`createLogger` 分级日志（`config.json` 的 `logLevel`）、`track` 埋点、`reportError` 错误上报（附版本与平台）；Web 端捕获全局错误、资源加载失败与 `unhandledrejection`；HTTP 最终失败自动上报
- 网络：`HttpClient`（拦截器、401 单飞刷新且刷新期间新请求等待、幂等请求指数退避重试、业务码映射、排队与退避中可取消、并发上限 10、`onError` 上报）、`XhrTransport`（JS 侧超时计时）、`MockTransport`（延迟可超时与取消）；`config.json` 的 `httpMock` 选择传输
- 存档：`deviceSave`（设备级，前缀 `gc:d`）与 `userSave`（用户级，`setSaveUser` 切换作用域，未设置时告警）；版本迁移、写入节流、UTF-8 体积告警、单 key 写入失败不影响其他 key、按作用域清空；作用域变化后存档对象缓存失效
- `remoteConfig`：本地默认值，加载失败或超时回退默认值
- DEBUG Web 构建暴露 `window.gameCore` 供冒烟与调试使用

### 项目侧资源

- `assets/resources/config.json` 各环境新增 `httpMock`、`logLevel`

## 0.1.0（未发布）

- 插件骨架：`db://game-core` 公开入口
- `GameRoot`：继承 oops `Root`，`config.json` 加载失败 3 次后显示兜底提示，点击重试
- 环境配置：`IConfigEnvironment` 扩展 `httpServer`、`httpTimeout`，`getEnv()` 读取当前环境
- 存储 key：`GameStorageKey` 由 `OopsFramework.TypedGameStorageKey` 推导，业务通过 `declare global` 扩展

### 项目侧资源

- `assets/scenes/main.scene`：根节点挂 `GameRoot`
- `assets/resources/config.json`
- `assets/resources/common/{anim,prefab,texture}`：notify、wait、mask 提示 prefab 及其资源
- `assets/resources/language/json/{zh,en}.json`
