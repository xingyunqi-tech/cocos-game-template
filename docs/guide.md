# 开发指南

## 1. 分层与约束

```
assets/game/          业务层：只依赖 db://game-core 公开入口、oops 公开 API 与 cc
assets/bundles/       业务 Asset Bundle（界面 prefab、音频等），约束同业务层
extensions/game-core/ 模板核心：平台适配、网络、存档、UI、合规、监控，以插件分发
extensions/oops-plugin-framework/  oops 框架，禁止修改
```

- 业务层不直接访问 `wx`、`tt`、`window`、`globalThis`，平台能力通过 `platform` 使用（ESLint 检查）
- 业务层只引用 `db://game-core`（类型扩展用 `declare module 'db://game-core/augment'`），ESLint 禁止引用 game-core 的其他路径
- 修改 game-core 前先确认能否通过扩展点实现，必须修改时向模板仓库提交，避免下游各自改插件：
  - `configureCore({ platform, store, transport })`：在模块顶层调用，替换平台实现、存档存储后端、HTTP 传输层
  - `auth.configure({ buildLoginBody, parseLoginResponse, buildRefreshBody, parseRefreshResponse })`：后端登录、刷新协议与默认不同时适配
  - `http.onError(listener)`：监听请求最终失败，可注册多个
  - `coreUi.setConfirm`、`coreUi.setSettings`、`coreUi.setDocument`：替换确认框、设置面板、协议页
  - `coreText`：模板界面文案（加载、启动失败、健康忠告、设置面板等）；`LEGAL_DOCUMENTS`：协议页标题与路径；`THEME`：模板界面样式；`coreOptions`：其他模板行为

## 2. 启动顺序

`GameRoot` 加载 `config.json` → oops 初始化 → `initGameCore()` → 启动流水线（`tables` → `login` → `remote-config` → 业务步骤（示例为 `demo-bundle`））→ 关闭健康忠告加载页 → `setGameEntry` 注册的入口。

业务步骤用 `bootPipeline.register(name, run, { after: 'login' })` 注册；锚点可以是其他模块注册的步骤，执行时解析。必需步骤失败显示“启动失败，点击重试”，点击后只执行未成功的步骤（已成功的步骤与登录不重复执行），`optional: true` 的步骤失败只上报、重试时再次执行。业务入口抛错时同样显示“启动失败，点击重试”，点击后重新调用入口（只重新调用入口，不重跑流水线），入口需可重复执行。

## 3. 新增业务模块

```bash
npm run new:module -- shop
```

生成 `assets/game/shop/`：

| 文件 | 内容 |
| --- | --- |
| `ShopModel.ts` | 用户存档 slot（带版本号，字段变更时加 `migrations`） |
| `ShopView.ts` | 代码构建的弹窗界面示例 |
| `index.ts` | 模块公开入口 |

正式界面建议用 prefab：在编辑器中制作 prefab，放入业务 Asset Bundle，用 `oops.gui.open` 打开；生成的 View 可作为逻辑骨架保留。

存档约定：

- 用户进度用 `userSave.slot`，设备设置用 `deviceSave.slot`；不要调用 `oops.storage.setUser`、`sys.localStorage.clear()`
- slot 的 `version` 递增时提供 `migrations[newVersion]`；缺少迁移步骤或迁移抛错时读到默认值，本次运行的修改不写入，原存档保留，补上迁移后的版本可正常读出；迁移函数只处理对象，需要迁移的数组或原始值用对象包装，否则版本递增时读到默认值，原存档备份到 `<前缀>:__bak:<作用域>:<key>` 后正常写入
- 本地存档版本高于代码中的 `version`（版本回退、灰度回滚）时读到默认值，本次运行的修改不写入，原存档保留
- 存档内容无法解析时读到默认值，原文备份到 `<前缀>:__bak:<作用域>:<key>`（每个 key 保留最近一份），之后正常写入
- 同一个存档对象中 slot key 只能注册一次，重复注册抛错；game-core 已占用 userSave 的 `sidebar`，deviceSave 的 `device`、`auth`、`settings`、`gm`、`remote-config`
- 单个 slot 超过 512KB 会告警，平台单 key 上限 1MB、总量 10MB

## 4. prefab 界面

示例：`assets/bundles/demo/prefab/rank.prefab` + `assets/bundles/demo/scripts/DemoRankView.ts`，注册与打开在 `assets/game/demo/ui.ts`。

1. 在编辑器中制作 prefab：根节点加 `UITransform` 与四边对齐的 `Widget`（全屏），再挂界面组件；在属性检查器中把子节点拖到组件的 `@property` 字段上
2. prefab 与界面脚本放在业务 Bundle（如 `assets/bundles/<名称>/prefab/`），不要放 `resources`；按钮可用 `cc.Button` 在编辑器绑定点击事件，示例用代码监听 `TOUCH_END`
3. 定义 `UIID`（字符串或数字均可）与 `UIConfig`（`layer`、`prefab` 为 Bundle 内路径、`bundle`、`mask` 等），在游戏入口中注册；`oops.gui` 在 Root 初始化后才存在，不能在模块顶层注册：

```ts
setGameEntry(() => {
  oops.gui.init({ [UIID.Shop]: { layer: LayerType.Dialog, prefab: 'prefab/shop', bundle: 'shop', mask: true } });
  openMainScreen();
});
```
4. `oops.gui.open(UIID.Xxx, { data })` 打开；界面组件的 `onAdded(data)` 接收参数，`oops.gui.removeByNode(this.node)` 关闭；`onBeforeRemove`、`onRemoved` 同样可在组件或参数中提供
5. 主包脚本不要 import Bundle 内的脚本（Bundle 加载前不可用），参数类型放在主包，Bundle 内脚本用 `import type` 引用

## 5. Asset Bundle 与分包

- 业务资源按功能放在 `assets/bundles/<名称>/`；在编辑器中选中目录，属性检查器勾选「配置为 Bundle」，Bundle 配置选「小游戏分包」（即预设 `subpackage`），Bundle 名称默认为目录名；示例 `demo` 包含界面 prefab 与音频
- Bundle 的压缩方式使用项目设置中的 Bundle 配置预设（`settings/v2/packages/builder.json` 的 `bundleConfig.custom`），目录 meta 以 `bundleConfigID` 引用：

| 预设 | 小游戏 | Web | 用途 |
| --- | --- | --- | --- |
| `subpackage` | 分包（`subpackages/<名称>/`） | 合并依赖 | 默认，计入总包，不占主包 |
| `remote` | 远程（输出到 `remote/<名称>/`） | 远程 | 资源放 CDN，不计入包体 |

- 启动时预加载（进度显示在加载页，失败时显示"启动失败，点击重试"）：

```ts
bootPipeline.register(
  'shop-bundle',
  async (step) => {
    await preloadBundle('shop', (ratio) => step.progress(ratio));
  },
  { after: 'remote-config', weight: 3, timeoutMs: 30000 },
);
```
- 按需加载：`loadBundle(name)`、`loadAsset(bundle, path, Type)`
- 释放：`releaseBundle(name)` 停止来自该 Bundle 的背景音乐、丢弃 `sound` 的音频缓存，再释放 Bundle 内全部资源并移除 Bundle；释放后仍在使用其资源的界面需先关闭；`resources`、`main` 等引擎内置 Bundle 不能释放
- 包体检查按 `game.json` 的分包分别统计；微信普通分包不限大小、总包 ≤ 30MB，抖音单个分包与总包 ≤ 20MB

远程 Bundle：把目录 meta 的 `bundleConfigID` 改为 `remote`，构建时设置 `REMOTE_SERVER`（以 `/` 结尾），把构建产物的 `remote/` 上传到该地址（`REMOTE_UPLOAD_COMMAND`）。服务器需允许跨域（Web）并加入小游戏 downloadFile 合法域名。本地验证可用任意带 CORS 头的静态服务器作为 `REMOTE_SERVER`。小游戏不允许加载远程代码，远程 Bundle 中的脚本仍会打进本地包，只有资源走远程。

## 6. 音频

- 音频资源放在业务 Bundle 的 `audio/` 下，通过 `sound.playMusic({ bundle, path })`、`sound.playEffect({ bundle, path })` 播放，加载结果缓存
- 模板按钮的点击音效：`coreOptions.clickSound = { bundle: 'demo', path: 'audio/click' }`；音效所在 Bundle 加载完成前的点击（如启动阶段的弹窗）不会立即出声，需要启动阶段即有点击音效时把音效放在 `resources` 并使用 `{ bundle: 'resources', path }`
- 开关与音量由 `oops.audio` 管理并持久化（设备级），设置面板直接读写；关闭时 `playEffect` 不播放，重新打开音乐时恢复播放
- 切后台、回前台由 oops Root 暂停与恢复
- 平台广告展示期间暂停正在播放的背景音乐，结束后恢复；`coreOptions.pauseMusicDuringAds = false` 关闭

## 7. 内购接口

`payment.pay({ productId, price })` 返回 `{ result: 'success' | 'failed' | 'pending', orderId?, reason? }`，`reason` 为 `unsupported`、`not_logged_in`、`cancelled`、`order_failed`、`pay_failed`、`busy`、`timeout`。平台 120 秒未回调时返回 `pending`（`reason: 'timeout'`），实现在服务端创建订单后调用 `pay(item, hooks)` 的 `hooks.onOrder(orderId)` 时，该结果带上 `orderId`；之后平台给出的结果通过 `payment.onLateResult((item, result) => …)` 回调（埋点 `pay_late_result`）。超时后即可发起下一笔支付，界面应提示用户支付结果待确认，避免重复购买。带 `orderId` 的 `pending` 订单保存在当前用户的存档中，迟到结果为成功或失败时移除。`payment.recoverOrders()` 对保存的订单逐个 `queryOrder`（实现 `IPayment.queryOrder`，`failed` 表示订单已关闭，查询失败时 reject 或返回 `pending`），查到成功或失败时移除并经 `onLateResult` 回调，仍为 `pending` 的保留，超过 7 天的移除。业务在设置支付实现与 `onLateResult` 之后补单：

```ts
payment.setImplementation(myPayment);
payment.onLateResult((item, result) => result.result === 'success' && refreshWallet());
onUserReady(({ offline }) => {
    if (!offline) void payment.recoverOrders();
});
```

`payment.pendingOrders()` 返回当前保存的订单，`payment.queryOrder(orderId)` 可单独查询。发货以服务端为准，`onLateResult` 收到成功时刷新余额或背包即可。微信虚拟支付所需的 `signData`、`paySig`、`signature` 由服务端生成，经 `PayItem.extra` 传入实现。模板只定义接口，三端默认返回 `unsupported`；GM 面板可模拟成功或失败。

接入真实支付时实现 `IPayment` 并 `payment.setImplementation(impl)`。约定：客户端请求服务端创建订单 → 服务端返回平台支付参数 → 客户端调起平台支付（微信 iOS `wx.requestVirtualPayment`，抖音 Android `tt.requestGamePayment`，iOS 钻石兑换，实施前按平台最新规则核实）→ 平台回调服务端 → 服务端发货；客户端只以服务端订单状态为准，不在客户端发货。

## 8. 服务器时间

`serverTime.now()`、`serverTime.today()`（默认东八区自然日）以服务器时间为准：登录响应的 `serverTime`（毫秒）与 HTTP 响应头 `Date` 自动校准。单调时钟由平台提供（Web 用 `performance.now`，小游戏用 `wx.getPerformance` / `tt.getPerformance`，启动时自动判定毫秒或微秒），校准后按单调时钟推算，修改系统时间不影响，`serverTime.calibrated` 为 true。未校准（离线进入或服务端未返回 `serverTime`）时使用本机时间；平台不提供单调时钟时按服务器偏移修正本机时间，两种情况 `calibrated` 都为 false，修改系统时间可以影响结果，奖励价值高时可在 `calibrated` 为 false 时不发放。按天发放的奖励（如 `sidebarReward`）使用 `serverTime.today()`。Web 跨域请求读取 `Date` 头需要服务端设置 `Access-Control-Expose-Headers: Date`。

## 8.1 每日计数、签到与钱包

按服务器日期（`serverTime.today()`）计算，数据存在用户存档；工厂在模块顶层各调用一次，参数为 userSave 的 slot key。用户就绪（`onUserReady`）前只读：计数视为已用完、领取与签到不生效、钱包不能修改。

```ts
const wallet = createWallet<'coins' | 'hint'>('wallet', { defaults: () => ({ coins: 0, hint: 2 }) });
const adLimits = createDailyCounter('adCounters');
const daily = createDailyFlags('dailyFlags');
const login = createLoginStreak('loginStreak', 7);

onUserReady(() => {
    const { counted, day, cycleComplete } = login.record();
    if (cycleComplete) wallet.add('coins', 200);
});

function onWin(bonus: number) {
    if (daily.claim('firstWin')) wallet.add('coins', bonus);
}

async function revive(levelId: number) {
    if (adLimits.tryUse(`revive:${levelId}`, 1)) await ads.showRewarded('revive');
}

wallet.exchange('coins', 100, 'hint');
wallet.onChange((key, amount) => refreshLabel(key, amount));
```

- 记录日期比今天晚 1 到 2 天（`ROLLBACK_TOLERANCE_DAYS`）视为日期回拨，更晚视为错误日期（如离线时本机时钟拨快）并按新的一天处理
- `DailyCounter`：跨天清零；日期回拨时沿用已记录的计数，不能借回拨重复使用；`record` 的次数须为正整数
- `DailyFlags`：每天一次；日期回拨时不能领取；领取时清除早于回拨范围的记录
- `LoginStreak`：断签从第 1 天重新计，满一个周期后下次从第 1 天开始；同一天重复记录或日期回拨不计
- `Wallet`：`add` 只接受有限非负数，`spend` / `exchange` 数量不足或参数无效时返回 false 且不变；`createWallet` 可传 `version`、`migrations`
- 广告位名称、次数上限、道具价格等数值由游戏定义；纯逻辑测试可直接构造 `DailyCounter` 等类并传入内存存储与日期函数

## 9. 横屏游戏

1. `settings/v2/packages/project.json` 的 `designResolution` 改为 `1280 × 720`，`fitHeight: true`、`fitWidth: false`
2. `build-configs/web.json`、`wechat.json`、`douyin.json` 的 `orientation` 改为 `landscape`
3. 模板界面按可视区域摆放，可直接使用；示例游戏与 GM 面板按竖屏设计的固定高度（如 GM 面板 920、排行榜面板 720）需要调整
4. 顶部避让同样适用，横屏时胶囊在右上角

## 10. 配置表

1. 在 `config-tables/` 放 `.xlsx`，每个工作表是一张表，表名即工作表名（以 `#` 开头的工作表不导出）
2. 第 1 行字段名、第 2 行类型、第 3 行说明，第 4 行起为数据；第 1 列为主键（`int` 或 `string`）；以 `#` 开头的列不导出
3. 类型：`int`、`float`、`string`、`bool`（true/false/1/0/是/否）、`json`、`int[]`、`float[]`、`string[]`（逗号或竖线分隔）
4. 执行 `npm run tables`，生成 `assets/resources/tables/<表名>.json` 与 `assets/game/tables/TableTypes.ts`
5. 代码中 `Tables.get('demo_level', 1)`、`Tables.all('demo_level')`，类型自动推导

启动流水线的 `tables` 步骤加载 `resources/tables` 下全部 JSON。`assets/resources/tables/` 完全由 `npm run tables` 管理，脚本会删除没有对应 Excel 的 JSON，不要在其中手写文件。

## 11. 平台差异

| 能力 | Web | 微信 | 抖音 |
| --- | --- | --- | --- |
| 登录 | 设备 ID 匿名登录 | `wx.login` code | `tt.login` code / anonymousCode |
| 分享结果 | `navigator.share` 成功/失败 | 固定 `unknown` | 成功/失败 |
| 激励视频、插屏 | 调试构建模拟成功，发布构建 `unsupported` | 实例按广告单元缓存；`ads.preloadRewarded(placement)` 提前加载激励视频 | 插屏展示后销毁重建；预加载同微信 |
| 侧边栏 | 不支持 | 不支持 | `tt.checkScene` / `tt.navigateToScene`，必接 |
| 录屏分享 | 不支持 | 不支持 | `platform.recorder`，时长 3 到 300 秒 |
| 隐私 | 无平台弹窗，用协议页 | `getPrivacySetting`、官方或自定义弹窗；`privacy.require()` 主动弹出（`wx.requirePrivacyAuthorize`） | 仅 `onNeedPrivacyAuthorization`（基础库 4.17.0 起）；`privacy.require()` 直接返回 true |
| 顶部避让 | 默认 20 | 安全区 + 胶囊 | 安全区 + `getMenuButtonLayout` |
| 版本更新 | 无 | UpdateManager | UpdateManager |

判断能力用 `platform.name` 或各能力的 `supported` / `isSupported()`，不要用 `cc/env` 常量写业务分支。

## 12. 调试

- 调试构建右下角有 GM 按钮：切换环境、广告模拟（完成/跳过/失败）、支付模拟（成功/失败）、模拟侧边栏进入、性能面板、清空存档；切换环境与清空存档在 Web 自动刷新页面，小游戏需关闭后重新打开
- 环境覆盖只影响 `getEnv()` 读取的字段（服务器地址、mock、日志级别等），`frameRate`、`stats` 等 oops 启动时已使用的字段仍取 `config.json` 的 `type`
- 模拟侧边栏进入后，本次运行内 `sidebar.isLaunchedFromSidebar()` 一直为 true
- Web 调试构建在 `window.gameCore` 暴露核心对象，供控制台与冒烟测试使用
- `config.json` 的 `httpMock: true` 时请求走 `mockTransport`，内置登录、刷新、远程配置、埋点的 mock
- `coreOptions.gm = false` 可关闭 GM 按钮；发布构建不创建 GM 界面，但代码仍在包内（Cocos 不剔除未使用的项目脚本）

## 13. 删除示例游戏

新项目先把 `package.json` 的 `uuid` 换成新值（`node -e "console.log(crypto.randomUUID())"`），避免与模板及其他项目重复。

1. 删除 `assets/game/`、`assets/game.meta`、`assets/bundles/demo/`、`assets/bundles/demo.meta`（`TableTypes.ts` 一并删除，重新执行 `npm run tables` 会再生成）
2. 按需删除 `config-tables/demo.xlsx` 并重新执行 `npm run tables`
3. `npm run build -- web --debug && npm run smoke:web -- --skip-demo`
4. 写好自己的游戏入口后，把 `scripts/smoke-game.mjs` 改为本游戏的冒烟检查（或删除该文件只做通用检查），之后执行 `npm run smoke:web`

`smoke:web` 先做通用检查（启动、网络、存档、平台、通用 UI、GM），再调用 `scripts/smoke-game.mjs` 的默认导出 `smokeGame({ browser, page, origin, checks, pageErrors, consoleLines, timeout })`：在 `checks` 中追加通过项，抛错即失败。模板的 `smoke-game.mjs` 含"启动步骤失败时显示重试"的检查（拦截示例 Bundle 使启动失败），替换时建议改为拦截本游戏的某个启动资源保留这项检查。`--skip-demo` 不调用该文件，并检查未注册游戏入口时启动正常。

## 14. 监控

- `track(event, params)` 埋点，`reportError(err, source)` 错误上报；公共参数含版本、平台、envVersion。配置 `trackPath` 时错误上报经过限流：来源、信息与上下文相同的错误 60 秒内只上报一次，每分钟最多 30 条，合并次数 `repeated` 与丢弃数 `dropped` 随下一次上报或切后台时补报；日志输出不限流
- `config.json` 的 `trackPath` 非空时批量上报到该接口（20 条或 10 秒一批，切后台立即发送）；切后台时未上报的记录（最新的 200 条且不超过 100 KB）保存在本地，下次启动先补发 3 天内的记录，服务端收到请求但响应丢失时可能重复，可按 `time` 与事件去重，错误以 `error` 事件上报；上报请求携带登录 token，401 时不刷新 token，与网络错误、5xx 一样指数退避重试，退避期间不提前发送；其他 4xx 以及 2xx 但响应解析失败或业务校验失败时丢弃该批
- `remoteConfigPath` 非空时启动拉取远程配置，失败使用上次缓存，再失败使用默认值；远程值按默认值深合并，类型与默认值不一致的项忽略并输出警告（如布尔项下发字符串 `"false"`）
- 业务配置项扩展 `RemoteSettingsMap` 并在模块顶层提供默认值，`remoteConfig.get` 类型自动推导；未提供默认值且远程未下发的项读到 `undefined`：

```ts
declare module 'db://game-core/augment' {
    interface RemoteSettingsMap {
        dailyAdLimit: number;
    }
}
remoteConfig.setDefaults({ dailyAdLimit: 5 });
const limit = remoteConfig.get('dailyAdLimit');
```

- 内置的 `reviewMode`、`shareReward` 模板不读取，供业务使用
