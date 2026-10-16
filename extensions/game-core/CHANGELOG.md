# game-core 变更记录

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
