# cocos-game-template 开发计划

> 版本：v7（2026-10-16）｜依赖统一取最新稳定版｜状态：批次 1–6、8 完成（Web 验证通过，game-core 1.0.0）；批次 7 与全部小游戏模拟器、真机验证待定；新增批次 9 模板补充（§7 M6）

## 1. 目标与范围

交付模板仓库 `cocos-game-template`：新游戏 clone 后只写 `assets/game/` 业务层，即可构建 **Web、微信小游戏、抖音小游戏** 三端包并满足平台审核要求；模板核心以 **Cocos 编辑器插件 `game-core`** 交付，下游游戏通过替换插件目录获得后续修复。

**范围内**：oops 框架接入与运行资源；`game-core` 插件（启动、生命周期、平台适配、网络、存档、配置、通用 UI、合规、监控、调试）；工程化（规范、类型检查、构建、包体检查、上传、CI）；示例游戏；发布清单、升级流程与开发文档。

**范围外**：具体玩法；美术资源（只出资源规范）；服务端业务（只出接口约定与 mock）；原生 App 与热更新；内购实现、云存档实现、开放数据域排行榜（P2）。

**已确认前提**

| 项 | 结论 |
|---|---|
| 首批平台 | Web + 微信小游戏 + 抖音小游戏（抖音为 P0） |
| 后端 | HTTP 服务，域名后续完成 ICP 备案与 https；备案前真机走调试模式 |
| 变现 | 激励视频、插屏广告；内购只定义接口 |
| 模板分发 | `game-core` 做成编辑器插件，下游按版本替换目录升级 |
| 版本策略 | 所有依赖取最新稳定版（不用 beta / rc），已锁定 Creator 3.8.8 + oops-plugin-framework develop `0152111f`（详见 §2.1） |

## 2. 技术选型与版本

### 2.1 引擎与框架版本（已锁定：Creator 3.8.8 + oops develop `0152111f`）

**版本策略**：所有依赖取最新稳定版，2026-10-15 查询并锁定，写入 README 与 lock 文件；之后每季度评估一次升级，升级单独提任务。

| 项 | 选定 | 版本 | 发布日期 | 说明 |
|---|---|---|---|---|
| Cocos Creator | 最新稳定版 | 3.8.8 | 2025-12-16 | GitHub cocos-engine 最新正式 release |
| oops-plugin-framework | develop | `0152111f7c0efd895d376e4c0caaf9027549c865`（包内版本 3.1.0.20260504） | 2026-07-04 | 2026-10-15 的 develop HEAD |

oops 备选（develop 出现阻塞问题时评估）：

| 回退 | commit | 包内版本 | 日期 | 与 develop 差异（assets） |
|---|---|---|---|---|
| 1. 3.1 发布分支 | `75df7296a27b5c5aa1df55b2b0addaf9f2edad60` | 3.1.0.20260504 | 2026-06-16 | 262 个文件 |
| 2. master | `46bcb588282c7635e5c02411d9f17112ae1a9cca` | 2.1.0.20251026 | 2026-03-31 | 348 个文件 |

- develop 为未发布分支，作者未配套教程资源；S0 已验证它与 Creator 3.8.8 的最小项目组合（三端构建无 error，Web 运行与渲染通过）。
- 运行资源来源：官方教程工程 `dgflash/oops-framework`（2026-04-12，`c231adf`，Creator 3.8.7，配套 master）。移植 `assets/main.scene`、`assets/resources/config.json`、`assets/resources/common/prefab/{notify,wait,mask}.prefab` 及其贴图、`assets/resources/language`；`alert`、`confirm` 与 develop 不兼容，不移植。
- 提示 prefab 路径用 `GuiPromptConfig` 覆盖为 `common/prefab/{notify,wait,mask}`。
- 教程资源由 3.8.8 命令行构建时自动完成导入升级；移植后在编辑器中打开并保存一次，使 meta 落盘为 3.8.8 格式。
- 项目设置（`settings/v2/packages/*.json`）不整体继承教程，按 M0 任务"项目设置"逐项确定。

### 2.2 其他选型

版本为 2026-10-15 查询的 npm `latest`。

| 层 | 选型 | 版本 | 说明 |
|---|---|---|---|
| 引擎 | Cocos Creator | 3.8.8 | 全员统一，写入 README |
| 引擎类型 | `@cocos/creator-types` | 3.8.8 | 无编辑器环境下的 `cc` 类型来源，与引擎版本一致；不含 `cc/env`，仓库内按引擎 `cc.config.json` 维护 `types/cc-env.d.ts` |
| 模板核心 | `game-core` 编辑器插件 | 语义化版本 | 结构同 oops 插件：`package.json` 的 `asset-db.mount` 挂载 `assets/`，以 `db://game-core/*` 引用 |
| 语言（编辑器编译） | TypeScript | Creator 内置 | 引擎自带编译链，不受外部 TS 版本影响 |
| 类型检查 | `typescript` | 6.0.3 | 最新的 7.0.2 不满足 typescript-eslint 8.71.2 的 peer 要求（`>=4.8.4 <6.1.0`），取兼容的最新版；strict 仅覆盖 `game-core` 与 `assets/game`。tsconfig 需要：`paths`（`db://oops-framework/*`、`db://game-core/*`）、`include` oops 的 `assets/types` 与 `libs/extension/NodeExt.ts`、项目侧 `types/cc-env.d.ts`（48 个常量）、`types/game-storage.d.ts`（`GameStorageKey`）、`types/oops-shims.d.ts`（`ViewModel`），S0 已验证 0 错误 |
| 运行时 | Node.js | `^22.13 \|\| ^24 \|\| >=26` | ESLint 10 与 Vitest 5 的 engines 交集；写入 `package.json` `engines` |
| HTTP | 自研 HttpClient（XMLHttpRequest） | — | 不使用 oops HTTP |
| 日志 | 自研分级 Logger | — | prod 不调用 `oops.log.disable()` |
| 配置表 | Excel → JSON + TS 类型 | `exceljs` 4.4.0 | npm 上的 `xlsx` 停在 0.18.5（SheetJS 已改为自有源发布），不采用；优先评估教程工程附带的 excel-to-json 插件 |
| 实时通信（可选） | TSRPC | tsrpc 3.4.21 / tsrpc-browser、tsrpc-miniapp 3.4.18 | 默认不启用 |
| 规范 | `eslint` + `typescript-eslint` + `prettier` | 10.12.0 / 8.71.2 / 3.9.10 | ESLint 10 仅支持 flat config |
| 单测 | `vitest` | 5.0.4 | `cc`、`cc/env`、`db://*` 配 alias stub |
| 构建 | Cocos CLI | 随编辑器 | 需图形会话；退出码 36 成功、32 参数错误、34 构建失败 |
| 上传 | `miniprogram-ci` / `tt-ide-cli` | 2.1.31 / 0.1.33 | |

### 2.3 oops 能力核实结果（基于 develop `0152111f` 源码）

| 能力 | 结论 | 模板处理 |
|---|---|---|
| UI 层级 | 由 `config.json` 的 `gui` 数组驱动，可注册自定义层 | 直接使用；协议页、隐私相关弹窗放 System 层 |
| 提示 prefab | 插件不带，依赖项目侧资源；从默认 bundle 加载 | 从教程工程移植到项目 `assets/resources/common/prefab/` |
| 启动 | `Root` 从 `resources/config.json` 加载，失败时无限重试；`config.json` 的 `stats` 决定调用 `profiler.showStats/hideStats` | `game-core` 继承 Root，加入失败上限与兜底；引擎模块必须保留 `profiler` |
| 前后台 | `Root` 已处理计时器、音频、`director`/`game` 暂停恢复，派发 `GAME_SHOW/GAME_HIDE` | 只订阅事件补自动存档 |
| 环境配置 | `config.json` 内置 dev / test / prod | 扩展 `IConfigEnvironment` |
| 资源加载 | `ResLoader` 支持 Bundle；`ZipLoader` 依赖外部 JSZip | 默认不启用 Zip |
| 本地存储 | XOR 混淆，`PREVIEW` 不加密；`setUser` 后 key 带前缀；`clear()` 清空整个域；key 类型为项目侧声明的全局 `GameStorageKey` | 分设备级 / 用户级 key；禁止 `clear()`；`GameStorageKey` 在 `game-core` 声明为字面量联合，业务可扩展 |
| 音频 | 已持久化开关与音量，在 `setUser` 前加载 | 设置面板读写 `oops.audio`；音频设置归设备级 |
| HTTP | 仅 200 回调，401/404 等永久挂起 | 不使用 |
| WebSocket | 心跳、重连可用；pako 依赖外部全局库 | 可选，默认不压缩 |
| Logger | 标签位掩码，无级别；`disable()` 置空 console | 不用于分级 |
| 平台 | 仅 `DeviceUtil` 判断 | `game-core` 自建 |
| 插件副作用 | 写 `.oops/bridge.json`，在 127.0.0.1:56688 启本地 HTTP 服务 | `.oops/` 加入 `.gitignore`，README 告知 |

## 3. 架构、目录与分发

依赖方向：`assets/game → game-core → oops / cc`；`game` 也可直接使用 oops 公开 API。

**依赖约束**（ESLint 落地）：

- `game` 允许 import `db://oops-framework/*`、`db://game-core/*` 的公开入口
- `game` 禁止访问 `wx`、`tt`、`window` 全局与任何 `globalThis` 访问（`no-restricted-globals` + `no-restricted-syntax` 的 `Identifier[name='globalThis']`，S0 已验证）
- `game` 禁止 import `db://game-core/**/impl/**`
- `game-core` 禁止 import `assets/game`

```
cocos-game-template/
├─ extensions/
│   ├─ oops-plugin-framework/   # 锁定 commit，原样提交
│   └─ game-core/               # 模板核心插件，语义化版本
│       ├─ package.json         # asset-db.mount → ./assets
│       ├─ CHANGELOG.md
│       └─ assets/                 # 只有脚本，不设为 bundle；自有界面用代码构建
│           ├─ boot/  platform/  ads/  net/  save/  config/  payment/  time/
│           ├─ ui/  compliance/  monitor/  debug/  types/
│           ├─ wiring/          # 单例与功能装配：services、sidebar、ui、auth、remote、mocks
│           ├─ core.ts          # 装配入口：启动步骤注册顺序、initGameCore，重新导出 wiring
│           └─ index.ts         # 公开入口
├─ assets/
│   ├─ resources/               # config.json 等必须位于项目 resources 的资源
│   ├─ scenes/                  # Root 场景
│   ├─ game/                    # 示例游戏，可整体删除
│   └─ bundles/
├─ build-configs/  build-templates/  config-tables/
├─ scripts/                     # 构建、包体、上传、配置表、插件校验、core 升级
├─ tests/
└─ docs/
```

**资源归属**（S0 已验证）：

| 资源 | 位置 | 原因 |
|---|---|---|
| `config.json` | 项目 `assets/resources/` | `Root` 用 `resources.load` 加载 |
| 提示 prefab（notify、wait、mask） | 项目 `assets/resources/` | oops 从默认 bundle 加载，`GuiPromptConfig` 不支持指定 bundle |
| Root 场景 | 项目 `assets/` | 启动场景 |
| `game-core` 自有 UI（设置、协议页、确认框、断网横幅、健康忠告加载页） | 插件 `assets/ui/`、`assets/compliance/` 脚本，运行时用代码构建节点（批次 5） | 不依赖 prefab 与贴图，无需编辑器即可修改与构建；样式集中在 `THEME` |
| 隐私政策、用户协议文本 | 项目 `assets/resources/legal/{privacy,agreement}.txt` | 文本随项目修改，上线前替换为正式文本 |
| `game-core` 脚本（含 Root 子类） | 插件非 bundle 目录 | 设为 bundle 的目录中的脚本需 `loadBundle` 后才可用；S0 已验证启动场景可引用插件非 bundle 目录的脚本，bundle 内 prefab 可引用插件非 bundle 目录的脚本 |

项目侧资源由模板提供，升级说明逐版列出。教程的 `alert`、`confirm` prefab 与 develop 不兼容，不移植。

**资源规范**：`game-core` bundle 与项目侧共用的贴图会在两个 bundle 中各存一份（S0 观察到），共享贴图统一放项目 `resources` 并由 `game-core` 按路径加载，或只在一处引用。

**分发与升级**：

- `game-core` 每次发版打 tag（`core-vX.Y.Z`）并更新 CHANGELOG，破坏性变更升主版本并附迁移说明
- 下游执行 `scripts/update-core.sh <version>` 替换 `extensions/game-core/`，项目侧资源变更按 CHANGELOG 手工合入
- `npm run check:plugins` 校验 `oops-plugin-framework` 与 `game-core` 未被本地修改；`game-core` 的锁定快照随版本生成并分发（当前锁定 1.2.2；版本号为 `-dev` 时只提示差异）

## 4. game-core 模块设计

### 4.1 启动与生命周期（boot）

- 流水线：`Splash（健康忠告） → 隐私监听注册 → 预加载 → 登录 → 远程配置 → 主场景`
- `bootPipeline.register(name, run, { weight, optional, timeoutMs, before, after })` 注册，驱动进度条，步骤耗时上报；`before` / `after` 在执行时解析，同一锚点按注册顺序
- 业务入口 `setGameEntry` 抛错时显示“启动失败，点击重试”，点击后重新调用入口
- `onUserReady` 在登录步骤完成（含离线进入）与离线后重新登录成功时回调
- 隐私不阻塞启动：只注册监听，调用隐私接口时由平台弹窗
- config 加载失败：重试上限 3 次后兜底提示
- 版本更新：`onUpdateReady` 到达后弹窗确认并 `applyUpdate()`
- 前后台：订阅 oops `GAME_SHOW/GAME_HIDE`；`GAME_HIDE` 内同步落盘；`GAME_SHOW` 透传 LaunchOptions
- 全局异常：平台钩子优先（`wx.onError`/`onUnhandledRejection`、`tt.onError`），Web 用 `window.onerror`/`unhandledrejection`；监听 `onMemoryWarning`

### 4.2 平台适配（platform）

实现选择使用 `cc/env` 常量（`WECHAT`、`BYTEDANCE`，已对照引擎 3.8.8 `cc.config.json` 核实），运行时只实例化当前平台实现。`cc/env` 在项目脚本中是运行时导入，Cocos 也不对项目脚本做 tree-shaking，三端实现会同时打进各端包体（批次 4 构建核实）。

```ts
interface IPlatform {
  readonly name: 'web' | 'wechat' | 'douyin';
  readonly ads: AdProvider;                    // 由 AdService 包装，业务用 ads.showRewarded(placement)
  readonly sidebar: ISidebar;
  readonly recorder: IRecorder;                // 抖音录屏，其他平台 supported 为 false
  login(): Promise<{ code?: string; anonymousCode?: string }>;
  checkSession(): Promise<boolean>;
  getLaunchOptions(): LaunchOptions;           // 含 scene、query、抖音 launchFrom / location
  getShowOptions(): LaunchOptions;             // 最近一次 onShow 参数（侧边栏判断用）
  onShow(cb: (opts: LaunchOptions) => void): () => void;
  share(opts: ShareOptions): Promise<'success' | 'fail' | 'unknown'>; // 微信固定 unknown
  setShareMenu(opts: ShareOptions): void;      // 重复调用替换上一次的监听
  getSystemInfo(): SystemInfo;                 // 微信用 getWindowInfo/getDeviceInfo/getAppBaseInfo
  getTopInset(): { safeTop: number; menuRect?: Rect }; // 窗口逻辑像素
  getNetworkType(): Promise<NetworkType>;
  onNetworkChange(cb: (online: boolean, type: NetworkType) => void): () => void;
  vibrate(type: 'short' | 'long'): void;
  setClipboard(text: string): Promise<boolean>;
  getPrivacySetting(): Promise<{ supported: boolean; needAuthorization: boolean }>; // 查询失败按需要授权处理
  openPrivacyContract(): Promise<boolean>;
  onNeedPrivacyAuthorization(handler: (resolve: (agree: boolean) => void, exposed: () => void) => void): boolean;
  onUpdateReady(cb: () => void): () => void;
  onUpdateFailed(cb: () => void): () => void;
  applyUpdate(): void;
  installErrorHooks(reporter: ErrorReporter): () => void; // onError / onUnhandledRejection / onMemoryWarning
  getEnvVersion(): 'develop' | 'trial' | 'release';
  getStorageUsage(): { currentKB: number; limitKB: number } | null;
  monotonicNow(): number | null;               // 单调时钟（毫秒）；小游戏用 getPerformance 并在首次调用时判定毫秒或微秒
}

interface AdService {                  // core 导出的 ads
  configure(units: { rewarded?: Record<string, string>; interstitial?: Record<string, string>; policy?: Partial<AdPolicyOptions> }): void;
  showRewarded(placement: string): Promise<{ result: 'completed' | 'skipped' | 'failed'; reason?: AdFailReason; errCode?: number }>;
  showInterstitial(placement: string): Promise<{ result: 'shown' | 'failed'; reason?: AdFailReason; errCode?: number }>;
}
// AdFailReason: unsupported | not_configured | busy | frequency | load_failed | show_failed

interface IPayment {                 // core 导出的 payment 包装：并发拒绝、GM 模拟
  readonly supported: boolean;
  pay(item: { productId: string; price: number; title?: string; extra?: Record<string, unknown> }):
    Promise<{ result: 'success' | 'failed' | 'pending'; orderId?: string; reason?: 'unsupported' | 'not_logged_in' | 'cancelled' | 'order_failed' | 'pay_failed' | 'busy' | 'timeout' }>;
  queryOrder?(orderId: string): Promise<PayResult>; // pending 订单与登录后补单
}

interface ISidebar {                 // 抖音必接
  isSupported(): Promise<boolean>;   // tt.checkScene
  open(): Promise<boolean>;          // tt.navigateToScene
  isLaunchedFromSidebar(opts: LaunchOptions): boolean;
}
```

约定：

- `share()` 在触摸回调中同步调用平台 API（抖音要求）
- 分享不发奖励
- 广告统一频控（抖音插屏：启动 30s 内不展示、两次插屏间隔 ≥ 60s、激励视频后间隔 ≥ 60s，间隔从广告关闭时算起；错误码 2002 后 30s 内不展示；实例成功展示后销毁重建，失败时同实例重新 load；展示后出错而未关闭时按失败结束）
- 抖音实现必须包含 `tt.navigateToScene` 的静态调用，否则上传预检拦截
- 抖音顶部避让使用 `tt.getMenuButtonLayout`；抖音隐私只使用 `tt.onNeedPrivacyAuthorization`（基础库 4.17.0，运行时能力检测），`getPrivacySetting`、`openPrivacyContract` 返回降级结果
- Web 广告：调试构建（`DEBUG`）返回 completed，可改 `platform.ads.mode` 模拟其他结果；发布构建返回 failed / unsupported
- 低频能力扩展接口 `IPlatformExtra` 尚未定义
- `IPayment` 只定义 `pay(item)` 与服务端发货回调约定（批次 9 已定义，三端默认返回 unsupported）；微信 iOS 走 `wx.requestVirtualPayment`，抖音 Android 走 `tt.requestGamePayment`、iOS 走钻石兑换（P2 实施前核实）

### 4.3 网络（net）

- 自研 HttpClient：完整状态码、JSON body、拦截器、token 注入与 401 刷新（单飞，刷新期间排队）、指数退避重试（仅幂等）、错误码映射、取消、并发队列（上限 10）
- baseURL 写入 `config.json` 的环境扩展字段，构建脚本只改写 `type`
- mock：dev 可切换，示例游戏默认 mock
- 可选：WebSocket、TSRPC 客户端

- 平台登录（`wx.login` / `tt.login`）10 秒无响应按网络失败处理，走 `loginFallback`
- `XhrTransport` 以小写发送请求头名，覆盖小游戏 adapter 默认的 `content-type: application/x-www-form-urlencoded`
- 请求选项 `skipRefresh`：携带 token，401 时不刷新、不重新登录（埋点上报使用）

**登录接口约定**（交给后端）：`POST /auth/login { platform, deviceId, code | anonymousCode } → { token, refreshToken, userId, expiresIn }`，userId 不含冒号；`POST /auth/refresh { refreshToken } → { token, expiresIn, refreshToken? }`。登录失败回退由 `config.json` 的 `loginFallback` 决定：`guest`（默认，上次 userId 或设备游客）、`last-user`（仅网络失败且有上次 userId）。

### 4.4 存档（save）

- 设备级 key（音频、震动、隐私同意、设备 ID）不带用户前缀；用户级 key（存档）在 `setUser` 后读写
- 登录账号在本设备没有存档时，并入本设备游客身份的存档（首次启动离线进入后再登录成功的场景）
- 存档带 `version` 与 `migrations[version]`
- 写入节流；`GAME_HIDE` 同步落盘
- 接近平台上限时告警（微信单 key 1MB、总量 10MB）
- 清空按前缀删除，禁止 `sys.localStorage.clear()`
- 同一存档对象中 slot key 只能注册一次；本地存档版本高于代码时读默认值且不写入
- 不承担防作弊；`ICloudSave` 预留，冲突以服务端版本号判定

### 4.5 配置（config）

- 环境：扩展 oops `IConfigEnvironment`
- 配置表：`Tables.get<T>(name, id)`
- 远程配置：`remoteConfigPath` 非空时启动拉取（附 `platform`、`version`、`envVersion`），失败用缓存（键为 platform、envVersion、version、httpServer），再失败用默认值；业务扩展 `RemoteSettingsMap` 并用 `remoteConfig.setDefaults` 提供默认值；内置 `reviewMode`、`shareReward` 模板不读取，审核期行为由业务决定
- Bundle：`loadBundle`、`preloadBundle`、`loadAsset`；`releaseBundle` 同时清理 `sound` 的音频缓存，引擎内置 Bundle 不能释放

### 4.6 通用 UI（ui）

- 提示 prefab（Toast、等待、遮罩）统一样式
- 确认框 `coreUi.confirm`（System 层）、断网横幅（Notify 层，自动随网络状态显示）
- 设置面板 `coreUi.openSettings`（Dialog 层）：音乐音效读写 `oops.audio`，震动开关存设备级 key
- 隐私政策、用户协议页 `coreUi.openDocument`（System 层，可滚动）；微信隐私政策页附《小游戏隐私保护指引》入口
- 顶部避让：`getDesignInset()` 把平台安全区与胶囊位置换算为设计分辨率，内容放在胶囊下方；Web 用默认内边距 20；`SafeTopAdapter` 组件挂在顶部节点上自动下移（节点有纵向对齐的 Widget 时调整其对齐值，含百分比）；oops 的 `mobileSafeArea` 关闭，避免与之叠加
- 抖音侧边栏入口 `coreUi.createSidebarEntry(parent)`（平台不支持时不创建）+ `sidebarReward` 复访奖励（每天一次）+ `onSidebarLaunch`
- 版本更新就绪时弹窗确认后应用
- 以上界面用代码构建节点，`coreOptions` 可关闭断网横幅、更新弹窗、健康忠告加载页

### 4.7 合规（compliance）

| 类别 | 内容 | 负责 |
|---|---|---|
| 代码 | 健康游戏忠告文案、适龄图标占位 | 模板 |
| 代码 | 隐私：`getPrivacySetting` 预判，默认官方弹窗；拒绝后基础玩法可继续 | 模板 |
| 代码 | `IAntiAddiction` 接口；小游戏端由平台负责，Web 国内运营另接实名 | 模板 / 业务 |
| 后台 | 《用户隐私保护指引》声明所用隐私接口 | 发布清单 |
| 后台 | 适龄提示设置 | 发布清单 |
| 后台 | 合法域名（ICP 备案 + https/wss） | 发布清单 |
| 资质 | 软著、版号按变现方式与类目确认 | 立项前 |

### 4.8 监控与调试（monitor / debug）

- Logger：debug / info / warn / error，prod 保留 warn 以上
- `track(event, params)`：`trackPath` 非空时批量上报（20 条或 10 秒一批，切后台发送），失败指数退避且退避期间不提前发送，401 不刷新 token，2xx 但响应解析或业务校验失败时丢弃该批
- 错误上报：JS 异常、未处理 Promise、资源失败、接口错误、内存告警，附平台、版本、envVersion
- GM 面板（仅 dev）：切换环境、清空存档、模拟广告、模拟侧边栏进入、FPS / DrawCall

## 5. 构建、包体与发布

**包体限制**（`scripts/size-limits.json`，分平台检查主包 / 各分包 / 总包）：

| 平台 | 主包 | 分包 | 总计 |
|---|---|---|---|
| 微信 | ≤ 4MB | 普通分包不限，独立分包 ≤ 4MB | ≤ 30MB |
| 抖音 | ≤ 4MB | 单个 ≤ 20MB（开通虚拟支付 ≤ 30MB） | ≤ 20MB（开通虚拟支付 ≤ 30MB） |

**默认构建配置**：

- 主包优化以 `includeModules` 裁剪为主。S0 验证的最小可运行模块集：`base`、`gfx-webgl`、`2d`、`ui`、`animation`、`audio`、`tween`、`mask`、`graphics`、`affine-transform`、`custom-pipeline`、`profiler`（oops `Root` 调用 profiler，不可去除）；该配置下微信引擎 1,520,150 字节，空模板主包 2,495,078 字节
- 分离引擎（微信引擎插件 CocosCreatorV3 已支持 3.8.8）：仅内置引擎、非调试模式、js 模式，需客户端 ≥ 7.0.7、基础库 ≥ 2.9.0；引擎代码仍计入首包，作用是跨游戏缓存复用，不降低主包上限占用
- 引擎原生代码分包、首场景分包；主包只放启动必需资源

**远程资源**：远程 Bundle + CDN 上传，资源带内容哈希，版本与构建号绑定。

| 命令 | 作用 |
|---|---|
| `npm run build:<web\|wechat\|douyin>` | 读取 `build-configs/<platform>.json` 调用 Cocos CLI；退出码 36 且日志中无匹配 `/ - error: /` 的行才判定成功（资源引用脚本失效时 CLI 仍返回 36；脚本语法错误返回 34；日志中的 `debug: Error: Exit process ...` 与 Chromium `ERROR:` 行不计），随后包体检查 |
| `npm run upload:<wechat\|douyin>` | 上传 remote 到 CDN，上传代码到体验版 |
| `npm run check:plugins` | 校验 oops 与 game-core 插件未被修改 |
| `npm run tables` | 配置表转换 |

三端构建串行。CI 用自建带图形会话的 Mac / Windows Runner。

**发布清单**（`docs/release-checklist.md`）：隐私指引声明、适龄提示、合法域名、广告位、抖音侧边栏自查、包体报告、性能报告、真机回归项。

## 6. 外部前置条件

| # | 事项 | 需在何时就绪 | 负责人 | 未就绪的影响 |
|---|---|---|---|---|
| 1 | 微信小游戏 AppID（主体资质）；此前用测试号 | 批次 4 前 | 待指派 | 无法测分离引擎、上传体验版 |
| 2 | 抖音小游戏 AppID（主体资质） | 批次 4 前 | 待指派 | 无法真机预览与上传预检 |
| 3 | 真机测试机（见 §8 机型矩阵） | 批次 4 前 | 待指派 | 无法测性能基线 |
| 3a | 抖音开发者工具安装；微信开发者工具开启服务端口 | 批次 3 结束前 | 待指派 | 无法在模拟器运行小游戏包 |
| 4 | 后端登录接口（§4.3 约定） | M1b 结束 | 待指派 | 真机登录只能 mock，验收第 4 条不能完成 |
| 5 | 微信、抖音广告位 / 测试广告位 | M1b | 待指派 | 广告只能 GM 模拟 |
| 6 | 后台隐私指引、适龄提示配置权限 | M3 前 | 待指派 | 体验版隐私接口不可调用 |
| 7 | CDN 与上传凭证 | M2 | 待指派 | 远程 Bundle 无法发布 |
| 8 | 后端域名 ICP 备案 + https | 正式提审前 | 待指派 | 只能调试模式运行 |
| 9 | 埋点与错误上报服务 | M4 | 待指派 | 只有控制台输出 |
| 10 | CI Runner 机器 | M4 | 待指派 | 只能本地构建 |
| 11 | 软著 / 版号确认 | 正式上线前 | 待指派 | 无法开通部分变现能力 |

## 7. 里程碑与任务

工期按 1 名熟悉 TS、初次接触 Cocos 的开发者估算。审核等待与开发并行。

### S0 技术验证（2 天）

进入 M0 的条件：版本组合、工具链、资源归属、平台规则、包体基线完成。小游戏模拟器运行、分离引擎、真机基线为遗留项，截止点见下表，不阻塞 M0、M1a。

| 任务 | 产出物 | 完成标准 | 状态 |
|---|---|---|---|
| 版本查询 | 报告中的版本清单 | §2.1、§2.2 全部依赖取最新稳定版 | 完成 |
| 版本组合验证 | `docs/spike-report.md` | Creator 3.8.8 + oops develop + 移植资源三端构建无 error；Web 运行与渲染通过 | 完成 |
| 小游戏模拟器运行 | 报告补充 | 微信开发者工具（测试号）、抖音开发者工具中运行空包无报错 | 遗留，批次 3 结束前（需开启微信开发者工具服务端口、安装抖音开发者工具） |
| 工具链兼容 | 报告结论 | TS、ESLint、Vitest、creator-types 协同可用；引用 oops 的代码 strict tsc 0 错误 | 完成 |
| 插件资源挂载验证 | 报告结论 | 资源与脚本在插件中的放置规则明确 | 完成 |
| 平台常量与 API 核实 | 报告结论 | 见报告 §5 | 完成 |
| 包体基线 | 报告中的基线数据 | 三端空包按字节统计；最小模块集 | 完成 |
| 分离引擎 | 报告补充 | 记录可用性与缓存效果 | 遗留，批次 4 前（需正式 AppID） |
| 真机性能基线 | 报告补充 | 首屏、可交互耗时与内存 | 遗留，批次 4 前（需测试机） |
| 锁定版本 | README 与本计划 §2.1 更新 | Creator 版本与 oops commit 写入 | 本计划已写入，README 在 M0 |

### M0 环境与骨架（5 天）

| 任务 | 产出物 | 完成标准 | 依赖 |
|---|---|---|---|
| 工程初始化 | Cocos 工程、`.gitignore`（含 `.oops/`、`library/`、`temp/`、`local/`、`build/`）、README 初稿、`package.json` `engines` | 编辑器打开无报错 | S0 |
| 项目设置 | `settings/v2/packages/*.json` | 引擎模块按 §5 最小集；设计分辨率、横竖屏、bundle 配置逐项确定，不整体继承教程 | 工程初始化 |
| 插件引入 | `extensions/oops-plugin-framework`（锁定 commit） | `check:plugins` 通过 | S0 |
| `game-core` 插件骨架 | `extensions/game-core`（package.json、mount、index.ts、CHANGELOG）、`import-map.json` | game 中可 `import 'db://game-core'`，三端构建覆盖 `assets/game/GameEntry.ts` | S0 |
| 运行资源移植 | config.json、Root 场景、提示 prefab，标注来源 commit | 空项目启动显示 Toast 正常 | 插件引入 |
| Root 子类 | `boot/Root` | config 缺失时 3 次后兜底提示 | 运行资源移植 |
| 规范与类型检查 | ESLint 依赖约束、Prettier、tsconfig、类型声明（§2.2） | 无编辑器环境下 `npm run lint`、`npm run typecheck` 通过 | 骨架 |
| 环境配置 | `IConfigEnvironment` 扩展 | `type` 切换后 baseURL 随之改变 | 运行资源移植 |
| 分支与评审流程 | `docs/contributing.md` | 见 §10 | — |
| 构建与冒烟脚本（基础版） | `scripts/build.mjs`、`scripts/smoke-web.mjs` | 三端构建按 §5 规则判定；Web 冒烟检查初始化、环境、Toast | 工程初始化 |

### M1a 基础能力（6 天）

| 任务 | 产出物 | 完成标准 | 依赖 |
|---|---|---|---|
| 启动流水线 | `boot/pipeline` | 步骤可注册，进度条按权重推进，每步耗时打印 | M0 |
| 生命周期 | `boot/lifecycle` | 切后台时存档已落盘（真机验证） | 存档 |
| Logger / track / 错误上报接口 | `monitor/*` | prod 构建无 debug 输出；未捕获异常进入上报接口 | M0 |
| HttpClient + mock | `net/*` | 单测覆盖 401 刷新、重试、取消、并发上限 | M0 |
| 存档 | `save/*` | 单测覆盖迁移链；设置项在登录前后一致 | M0 |
| 远程配置默认实现 | `config/remote` | 无网络时启动不受影响 | HttpClient |

### M1b 平台与 UI（10 天）

| 任务 | 产出物 | 完成标准 | 依赖 |
|---|---|---|---|
| `IPlatform` + 三端实现 | `platform/impl/{web,wechat,douyin}` | 三端真机调用全部接口无报错；运行时只实例化当前平台实现 | M1a |
| 登录接入 | `platform` + `net` | 后端就绪时真机拿到 token；未就绪时 mock 通过 | 前置 #4 |
| `IAds` + 频控 | `ads/*` | 三种结果与失败原因可区分；频控单测通过 | 前置 #5 |
| 抖音侧边栏 | `platform/impl/douyin.ts`（`DouyinSidebar`）、主界面入口 | 上传预检通过；按官方方法验证复访奖励 | M1a |
| 错误钩子、网络、更新 | `platform` | 断网提示出现与消失正确；更新弹窗可应用 | M1a |
| 隐私流程 | `compliance/PrivacyFlow.ts` | 同意、拒绝两条路径都可继续游戏 | M1a |
| 通用 UI | `ui/*` | 设置、协议页、确认框、顶部避让在三端截图验收 | M1a |
| 健康忠告 | `compliance/HealthNotice.ts` | 三端加载页展示 | M1a |

### M2 构建与示例游戏（7 天）

| 任务 | 产出物 | 完成标准 | 依赖 |
|---|---|---|---|
| 构建脚本 | `build-configs/*`、`scripts/build` | 三端命令可用，退出码判定正确 | M1b |
| 包体检查 | `scripts/size-check`、`size-limits.json` | 人为超限时构建失败 | 构建脚本 |
| 构建优化默认值 | 构建配置 | 主包大小优于 S0 基线（批次 6 未达成：加入 game-core 与示例后微信主包 2,532,085 字节，比 S0 空模板多约 36KB；项目脚本已压缩，oops 插件内 pako 46KB 不可改；分离引擎待正式 AppID） | 构建脚本 |
| 远程 Bundle 与上传 | `scripts/upload` | 体验版可加载 CDN 资源 | 前置 #7 |
| 示例游戏 | `assets/game/*` | 覆盖验收第 4 条全部链路 | M1b |
| 发布清单 | `docs/release-checklist.md` | 覆盖 §5 所列项 | — |

### M3 真机联调与提审（5 天，含等待）

| 任务 | 产出物 | 完成标准 | 依赖 |
|---|---|---|---|
| 微信体验版 | 体验版 + 回归记录 | 按机型矩阵完成回归，性能指标达标 | 前置 #6 |
| 抖音提审 | 审核记录 | 预检通过，真机回归完成 | 前置 #6 |
| 修正 | 修复提交 | 审核意见全部关闭 | — |

### M4 P1 完善（7 天）

| 任务 | 产出物 | 完成标准 | 依赖 |
|---|---|---|---|
| 远程配置接远端 | `config/remote` | 改远端开关后重启生效 | 后端 |
| 埋点服务 | `monitor/track` 实现 | 启动漏斗可在服务端查看 | 前置 #9 |
| 配置表工具链 | `scripts/tables` | Excel 改动后一条命令生成 JSON + 类型 | — |
| GM 面板 | `debug/GmPanel.ts` | 发布构建不创建 GM 界面（批次 8：Cocos 不剔除未使用的项目脚本，GM 代码仍在包内） | — |
| 抖音录屏分享 | `platform/impl/douyin.ts`（`DouyinRecorder`） | 真机录屏并分享成功 | — |
| 脚手架 | 新模块模板 | 一条命令生成 view + 业务骨架 | — |
| CI | Runner 配置与流水线 | 每次合并产出三端包与包体报告 | 前置 #10 |
| `game-core` 首个版本 | tag `core-v1.0.0`、`scripts/update-core.sh` | 在一个新 clone 的项目上完成一次升级演练 | — |

### M5 文档与测试（3 天）

| 任务 | 产出物 | 完成标准 |
|---|---|---|
| README | 快速开始、版本要求、插件副作用 | 新人按文档 30 分钟跑起 Web 版 |
| 开发指南 | 新增模块、平台差异、删除示例游戏 | 按文档删除示例后可构建 |
| 升级指南 | oops 与 game-core 升级流程 | 覆盖项目侧资源的合入步骤 |
| 单测 | `tests/*` | 存档迁移、重试与 401 刷新、频控、侧边栏来源识别全部通过 |

### M6 模板补充（8 天）

批次 8 完成后对照"开箱即用"目标复核，补充业务开发起步必然用到、当前缺少范例或接口的部分。全部可在本地完成，不依赖真机与正式账号。

| 任务 | 产出物 | 完成标准 | 依赖 |
|---|---|---|---|
| prefab 界面范例 | 示例游戏中 1 个 prefab 界面（如排行榜或商店）、`UIID` 枚举与 `UIConfig` 注册、界面组件基类用法、打开传参与关闭回调 | `oops.gui.open(UIID.Xxx, params)` 打开与关闭正常；三端构建无 error；开发指南写明 prefab 放置位置、注册方式与传参 | M4 |
| 业务 Asset Bundle 与分包 | `assets/bundles/<名称>/`（设为 Bundle，小游戏端配置为分包）存放示例界面 prefab 与资源；启动后按进度加载；Bundle 加载失败可重试 | 微信、抖音构建产物出现分包，包体检查按分包统计；删除示例后不残留空 Bundle 配置 | prefab 界面范例 |
| 远程 Bundle 范例 | 一个可选的远程 Bundle 配置与说明 | 以本地静态服务器作为 `REMOTE_SERVER` 时 Web 端可加载；上传检查覆盖 `remote/` 与服务器地址；正式 CDN 验证并入批次 7 | 业务 Asset Bundle |
| 音频范例与封装 | 背景音乐、按钮音效各 1 个（无版权或自制）；`coreUi` 按钮默认音效开关；音频资源目录约定 | 设置面板开关音乐、音效立即生效；切后台暂停、回前台恢复；音频归设备级设置 | M1b |
| 内购接口 | `IPayment`：`pay(item)`、结果类型、服务端发货回调约定；三端返回"不支持"的默认实现；GM 模拟支付 | 接口与约定写入 §4.2 与开发指南；单测覆盖结果分支；不实现真实支付（P2） | M1b |
| 服务器时间 | `serverTime`：从登录响应或 HTTP `Date` 头校准，提供 `now()` 与自然日计算；`sidebarReward` 改用服务器时间 | 本机改时间后不能重复领取侧边栏奖励；无网络时回退本机时间并标记未校准；单测覆盖 | M4 |
| 横屏支持说明 | 开发指南新增"横屏游戏"一节：设计分辨率、`build-configs` 方向、`game.json` 方向、顶部避让与示例界面的调整点 | 按文档切换为横屏后 Web 端可运行 | — |
| 多语言（可选） | 模板界面文案接入 oops 多语言，`language/json` 补齐中英文 | 切换语言后模板界面文案随之变化；只做国内市场可跳过 | — |

**风险**：prefab 与 Bundle 配置通常在编辑器中完成，命令行无法创建 prefab。处理方式：在编辑器中制作并保存后提交（需人工打开 Creator 一次），或手写 prefab 与 meta 后以三端构建与 Web 冒烟验证。

### P2（不排期）

红点系统、虚拟列表、内购实现、云存档实现、开放数据域排行榜、订阅消息、WebSocket / TSRPC 联网示例。

**合计 45 个工作日（S0 2 天 + 43 天），另留 20% 缓冲（约 9 天），总计约 54 个工作日。M6 模板补充另计 8 个工作日。**

### 执行批次

每批结束：子 agent 代码评审 → 修复 → 提交 → 进入下一批。单测随每批编写。

| 批次 | 内容 | 执行方 | 通过条件 |
|---|---|---|---|
| 0 前置准备 | 安装 Creator 3.8.8、申请两端 AppID、准备测试机、指派 §6 负责人 | 团队 | AppID 与测试机就绪 |
| 1 S0 技术验证 | 版本查询、版本组合、工具链兼容、平台规则核实、包体基线 | 开发 | 版本锁定，`spike-report.md` 结论通过；遗留项按 S0 表截止点补做 |
| 2 M0 骨架 | 工程、插件引入、`game-core` 骨架、资源移植、规范 | 开发 | 三端空项目启动；lint、typecheck 通过 |
| 3 M1a 基础能力 | 启动、生命周期、监控、HttpClient、存档、远程配置默认实现 | 开发 | 单测通过；真机切后台存档落盘 |
| 4 M1b-1 平台层 | `IPlatform` 三端、登录、广告、侧边栏、错误钩子、网络、更新 | 开发 + 真机 | 三端接口真机无报错；抖音预检通过 |
| 5 M1b-2 UI 与合规 | 通用 UI、隐私流程、健康忠告、顶部避让 | 开发 + 截图验收 | 三端截图验收；隐私两条路径可继续 |
| 6 M2 构建与示例 | 构建 / 包体 / 上传脚本、构建优化、示例游戏、发布清单 | 开发 + 团队（CDN、体验版） | 一条命令出三端包；示例全链路通过 |
| 7 M3 联调与提审 | 微信体验版、抖音提审、修正 | 团队为主 | 两端审核通过 |
| 8 M4 + M5 | P1 完善、`game-core` v1.0.0 与升级演练、文档 | 开发 + 团队（埋点、CI） | §9 验收 12 条通过 |
| 9 M6 模板补充 | prefab 界面范例、业务 Bundle 与分包、远程 Bundle 范例、音频、内购接口、服务器时间、横屏说明、多语言（可选） | 开发（制作 prefab 时需打开编辑器） | §9 验收第 13–16 条通过；Web 冒烟覆盖新增范例；game-core 发布 1.1.0 |

| 10 代码审查优化 | A 数据正确性（小游戏单调时钟、新版本存档保护、slot 重名）；B 竞态与平台适配（音乐竞态、录屏启动中停止、请求头大小写、平台登录超时）；C 埋点退避与鉴权循环；D 启动锚点执行时解析、业务入口失败重试；E 远程配置扩展、`onUserReady`、`releaseBundle`、SafeTopAdapter 纵向 Widget；F 拆分 `core.ts` 为 `wiring/` | 开发 | 已完成（`49ba84e`、`ad00ef2`、`d1e9130`、`75f592b`、`267a4b8`、`7361185`）；verify、Web 冒烟通过；涉及平台行为的项待批次 7 真机确认；发布为 game-core 1.2.0 |
| 11 正确性修复 | 存档无法迁移时不写入、损坏存档备份；音乐开关恢复当前背景音乐；广告展示超时；抖音录屏重复停止与超时；登录与 token 刷新的并发、取消、退出登录；侧边栏登录前热启动回调 | 开发 | 已完成；verify、Web 冒烟通过；子 agent 代码评审问题已修复；发布为 game-core 1.2.2 |

批次 3 中不依赖引擎的部分（HttpClient、存档迁移、频控）可在 S0 结束后与批次 2 并行；批次 7 审核等待期间可并行批次 8 中不依赖审核结果的任务。

## 8. 性能与兼容性指标

以下为初始目标，S0 测出基线后校准。

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 首屏出现（加载页） | ≤ 2s | 冷启动到加载页渲染，中端机 Wi-Fi |
| 可交互（主场景） | ≤ 5s | 冷启动到主场景可点击，中端机 Wi-Fi |
| 帧率 | 主场景稳定 ≥ 55 FPS | 示例游戏玩法中 60s 采样 |
| 内存峰值 | 示例游戏 ≤ 300MB | 微信开发者工具性能面板 / 真机 |
| 主包大小 | 见 §5 | 包体检查脚本 |

**机型矩阵**：iOS 新旧各 1 台（最低 iOS 15）；Android 中端 1 台、低端 1 台（2GB 内存级别）。

**最低基础库版本**：微信 2.32.3（隐私接口）；抖音 2.92.0（侧边栏），隐私监听低于 4.17.0 时跳过。最低版本在平台后台设置，列入发布清单（小游戏后台的具体位置在批次 4 用正式账号确认）；代码中对所用 API 做运行时能力检测。

## 9. 验收标准

1. 已安装指定版本 Creator 的前提下，全新 clone 按 README 操作，30 分钟内跑起 Web 版。
2. `npm run build:<platform>` 产出三端构建并通过包体检查；`npm run upload:<platform>` 完成 CDN 与体验版上传。
3. 包体满足 §5 限制，超限时构建失败。
4. 示例游戏在微信、抖音真机跑通：启动、登录、玩法、结算、分享、激励视频、存档、前后台；抖音侧边栏入口与复访奖励按官方方法验证。无正式广告位时允许测试广告位或 GM 模拟。
5. `game/` 无 `wx`、`tt`、`window` 全局访问，无 `game-core` impl 引用（ESLint 通过）。
6. 删除 `assets/game/` 后项目仍可构建运行。
7. 隐私同意与拒绝两条路径均可继续基础玩法；健康忠告正常展示。
8. 设置项在重启和登录前后保持。
9. `check:plugins`、Vitest、无编辑器环境的 tsc 与 ESLint 均通过。
10. §8 性能指标在机型矩阵上达标。
11. `game-core` 升级演练成功：新 clone 项目执行 `update-core.sh` 后可构建运行。
12. 文档覆盖：快速开始、新增模块、平台差异、发布清单、升级指南。
13. 示例游戏包含 prefab 界面，通过 `oops.gui.open` 打开并传参；开发指南说明 prefab 界面的新增步骤。
14. 小游戏构建包含业务分包，包体检查按主包、分包分别统计并通过；Bundle 加载失败可重试。
15. 音乐、音效开关立即生效，前后台切换后音频状态正确。
16. `IPayment` 接口、服务器时间可用；本机修改时间不影响按天发放的奖励。

## 10. 开发流程

- 分支：`main` 只接受合并；功能在 `feat/*` 开发，每个任务一个分支
- 评审：每个任务合并前做一次代码评审（同事或 AI 评审），里程碑结束做一次整体评审
- 版本：模板仓库按里程碑打 tag；`game-core` 独立语义化版本
- 提交与推送由负责人确认后执行

## 11. 风险与应对

| 风险 | 应对 |
|---|---|
| oops develop 为未发布分支，稳定性与配套资源无作者背书 | S0 关卡验证；按 §2.1 回退顺序兜底；锁 commit、源码入库 |
| oops 各分支差异大（develop 与 master 差 348 个文件），升级成本高 | `game-core` 只用公开 API；升级单列任务评估 |
| 最新版依赖之间不兼容（如 TypeScript 7 与 typescript-eslint） | S0 验证；不兼容的依赖退到兼容的最新版本并记录原因 |
| 最新版依赖引入破坏性变更 | lock 文件锁定；每季度评估升级，单独提任务 |
| oops 基本由一人维护 | 同上，并保留替换为自研基础模块的退路 |
| oops 运行依赖项目侧资源 | S0 明确资源归属，升级说明逐版列出 |
| 项目侧资源（config.json、提示 prefab、Root 场景）随模板升级需手工合入 | CHANGELOG 逐版列出变更与合入步骤 |
| 引擎模块裁剪导致 oops 运行时缺类 | 模块集变更须跑 Web 运行检查；`profiler` 必须保留 |
| 下游游戏修改 `game-core` 导致无法升级 | `check:plugins` 进 CI；扩展点通过注册接口提供 |
| TSRPC 一年未发版 | 可选模块，默认 HTTP |
| 平台规则变化 | 平台差异集中在 `platform/impl`；每次提审前更新发布清单 |
| 后端域名未备案 | 调试模式开发；正式提审前完成备案、https、域名配置 |
| 后端登录接口延期 | 按 §4.3 约定 mock；验收第 4 条登录项顺延 |
| 隐私指引未声明 | M3 前完成，发布清单首项 |
| 主包超限 | 构建优化 + 远程 Bundle + 包体检查进 CI |
| CI 需图形会话 | 自建 Runner |
| iOS 内存与音频中断 | 监听内存告警释放 Bundle；回归覆盖来电、锁屏 |
| 广告位开通门槛 | 测试广告位或 GM 模拟 |
| 微信 iOS 虚拟支付无沙盒 | P2 时正式环境小额测试 |
| 版号 / 软著 | 立项前确认 |
| 单人开发、初次接触 Cocos | S0 设关卡；任务级评审；20% 缓冲 |

## 12. 待决策事项

| # | 事项 | 需在何时决定 |
|---|---|---|
| 1 | 配置表工具：教程附带插件还是自写 | M4 前 |
| 2 | 埋点与错误上报服务选型 | M4 前 |
| 3 | CDN 服务商 | M2 前 |
| 4 | CI 平台与 Runner 机器 | M4 前 |
| 5 | 后端登录接口与备案完成时间 | M1b 前 |
| 6 | §6 各前置条件负责人 | S0 前 |
