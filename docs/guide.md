# 开发指南

## 1. 分层与约束

```
assets/game/          业务层：只依赖 db://game-core 公开入口、oops 公开 API 与 cc
assets/bundles/       业务 Asset Bundle（界面 prefab、音频等），约束同业务层
extensions/game-core/ 模板核心：平台适配、网络、存档、UI、合规、监控，以插件分发
extensions/oops-plugin-framework/  oops 框架，禁止修改
```

- 业务层不直接访问 `wx`、`tt`、`window`、`globalThis`，平台能力通过 `platform` 使用（ESLint 检查）
- 业务层不引用 `db://game-core/**/impl/**`
- 修改 game-core 前先确认能否通过 `coreOptions`、`coreUi.setConfirm`、`THEME` 等扩展点实现；必须修改时向模板仓库提交，避免下游各自改插件

## 2. 启动顺序

`GameRoot` 加载 `config.json` → oops 初始化 → `initGameCore()` → 启动流水线（`tables` → `login` → `remote-config` → 业务步骤（示例为 `demo-bundle`））→ 关闭健康忠告加载页 → `setGameEntry` 注册的入口。

业务步骤用 `bootPipeline.register(name, run, { after: 'login' })` 注册；必需步骤失败显示“启动失败，点击重试”，`optional: true` 的步骤失败只上报。

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
- slot 的 `version` 递增时提供 `migrations[newVersion]`，迁移失败回退默认值
- 本地存档版本高于代码中的 `version`（版本回退、灰度回滚）时读到默认值，本次运行的修改不写入，原存档保留
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
- 包体检查按 `game.json` 的分包分别统计；微信普通分包不限大小、总包 ≤ 30MB，抖音单个分包与总包 ≤ 20MB

远程 Bundle：把目录 meta 的 `bundleConfigID` 改为 `remote`，构建时设置 `REMOTE_SERVER`（以 `/` 结尾），把构建产物的 `remote/` 上传到该地址（`REMOTE_UPLOAD_COMMAND`）。服务器需允许跨域（Web）并加入小游戏 downloadFile 合法域名。本地验证可用任意带 CORS 头的静态服务器作为 `REMOTE_SERVER`。小游戏不允许加载远程代码，远程 Bundle 中的脚本仍会打进本地包，只有资源走远程。

## 6. 音频

- 音频资源放在业务 Bundle 的 `audio/` 下，通过 `sound.playMusic({ bundle, path })`、`sound.playEffect({ bundle, path })` 播放，加载结果缓存
- 模板按钮的点击音效：`coreOptions.clickSound = { bundle: 'demo', path: 'audio/click' }`；音效所在 Bundle 加载完成前的点击（如启动阶段的弹窗）不会立即出声，需要启动阶段即有点击音效时把音效放在 `resources` 并使用 `{ bundle: 'resources', path }`
- 开关与音量由 `oops.audio` 管理并持久化（设备级），设置面板直接读写；关闭时 `playEffect` 不播放，重新打开音乐时恢复播放
- 切后台、回前台由 oops Root 暂停与恢复

## 7. 内购接口

`payment.pay({ productId, price })` 返回 `{ result: 'success' | 'failed' | 'pending', orderId?, reason? }`，`reason` 为 `unsupported`、`not_logged_in`、`cancelled`、`order_failed`、`pay_failed`、`busy`、`timeout`。平台 120 秒未回调时返回 `pending`（`reason: 'timeout'`）；`pending` 订单与登录后补单用 `payment.queryOrder(orderId)` 查询（实现 `IPayment.queryOrder`）。微信虚拟支付所需的 `signData`、`paySig`、`signature` 由服务端生成，经 `PayItem.extra` 传入实现。模板只定义接口，三端默认返回 `unsupported`；GM 面板可模拟成功或失败。

接入真实支付时实现 `IPayment` 并 `payment.setImplementation(impl)`。约定：客户端请求服务端创建订单 → 服务端返回平台支付参数 → 客户端调起平台支付（微信 iOS `wx.requestVirtualPayment`，抖音 Android `tt.requestGamePayment`，iOS 钻石兑换，实施前按平台最新规则核实）→ 平台回调服务端 → 服务端发货；客户端只以服务端订单状态为准，不在客户端发货。

## 8. 服务器时间

`serverTime.now()`、`serverTime.today()`（默认东八区自然日）以服务器时间为准：登录响应的 `serverTime`（毫秒）与 HTTP 响应头 `Date` 自动校准。单调时钟由平台提供（Web 用 `performance.now`，小游戏用 `wx.getPerformance` / `tt.getPerformance`，启动时自动判定毫秒或微秒），校准后按单调时钟推算，修改系统时间不影响，`serverTime.calibrated` 为 true。未校准（离线进入或服务端未返回 `serverTime`）时使用本机时间；平台不提供单调时钟时按服务器偏移修正本机时间，两种情况 `calibrated` 都为 false，修改系统时间可以影响结果，奖励价值高时可在 `calibrated` 为 false 时不发放。按天发放的奖励（如 `sidebarReward`）使用 `serverTime.today()`。Web 跨域请求读取 `Date` 头需要服务端设置 `Access-Control-Expose-Headers: Date`。

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
| 激励视频、插屏 | 调试构建模拟成功，发布构建 `unsupported` | 实例按广告单元缓存 | 插屏展示后销毁重建 |
| 侧边栏 | 不支持 | 不支持 | `tt.checkScene` / `tt.navigateToScene`，必接 |
| 录屏分享 | 不支持 | 不支持 | `platform.recorder`，时长 3 到 300 秒 |
| 隐私 | 无平台弹窗，用协议页 | `getPrivacySetting`、官方或自定义弹窗 | 仅 `onNeedPrivacyAuthorization`（基础库 4.17.0 起） |
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

1. 删除 `assets/game/`、`assets/game.meta`、`assets/bundles/demo/`、`assets/bundles/demo.meta`（`TableTypes.ts` 一并删除，重新执行 `npm run tables` 会再生成）
2. 按需删除 `config-tables/demo.xlsx` 并重新执行 `npm run tables`
3. `npm run build -- web --debug && npm run smoke:web -- --skip-demo`

## 14. 监控

- `track(event, params)` 埋点，`reportError(err, source)` 错误上报；公共参数含版本、平台、envVersion
- `config.json` 的 `trackPath` 非空时批量上报到该接口（20 条或 10 秒一批，切后台立即发送），错误以 `error` 事件上报
- `remoteConfigPath` 非空时启动拉取远程配置，失败使用上次缓存，再失败使用默认值
