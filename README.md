# cocos-game-template

Cocos Creator 多端小游戏模板，目标平台：Web、微信小游戏、抖音小游戏。

## 版本要求

| 依赖                  | 版本                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Cocos Creator         | 3.8.8                                                                                              |
| oops-plugin-framework | develop `0152111f7c0efd895d376e4c0caaf9027549c865`（`extensions/oops-plugin-framework`，原样提交） |
| Node.js               | `^22.13 \|\| ^24 \|\| >=26`                                                                        |
| Google Chrome         | 运行 `smoke:web` 需要                                                                              |

Creator 默认路径：macOS `/Applications/Cocos/Creator/3.8.8/CocosCreator.app`，Windows `C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe`。其他位置通过环境变量 `COCOS_CREATOR_APP` 指定（macOS 指向 `.app`，Windows 指向 `CocosCreator.exe`）。

## 快速开始

```bash
npm install
npm run build -- web --debug
npm run smoke:web           # 无头 Chrome 启动 Web 包并检查初始化、环境配置、Toast
```

用 Cocos Dashboard 以 3.8.8 打开项目根目录即可在编辑器中开发与预览。

## 小游戏 AppID

复制 `.env.example` 为 `.env.local`（不入库）并填写 `WECHAT_APPID`、`DOUYIN_APPID`，`npm run build` 会注入到构建配置；未设置时使用占位值 `touristappid`（微信）、`testappId`（抖音），只能在开发者工具中以游客或测试身份预览。发布构建（不带 `--debug`）遇到占位值会失败，需显式加 `--allow-placeholder-appid`。AppSecret 与上传密钥不要写进仓库文件。

## 常用命令

| 命令                                                                         | 作用                                                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build [-- web wechat douyin] [--debug] [--allow-placeholder-appid]` | 命令行构建，默认三端；退出码 36 且日志中没有匹配 `/ - error: /` 的行才算成功，日志在 `temp/build-logs/`；小游戏构建后自动检查包体 |
| `npm run build:web` / `build:wechat` / `build:douyin`                        | 单端构建                                                                                                                          |
| `npm run size [-- wechat douyin]`                                            | 检查已有构建产物的包体，上限在 `scripts/size-limits.json`                                                                         |
| `npm run upload:wechat -- --version 1.0.0 --desc 说明`                       | 上传微信体验版（`--robot` 指定机器人编号，`--dry-run` 只做检查）                                                                  |
| `npm run upload:douyin -- --version 1.0.0 --desc 说明`                       | 上传抖音测试版                                                                                                                    |
| `npm run smoke:web [-- --skip-demo]`                                         | 运行 `build/web-mobile`（需 `--debug` 构建）；`--skip-demo` 用于删除示例游戏后                                                    |
| `npm run verify`                                                             | 格式、lint、类型检查、单测、插件校验                                                                                              |
| `npm run check:plugins`                                                      | 校验 `extensions/oops-plugin-framework` 与锁定快照一致                                                                            |
| `npm run gen:cc-env`                                                         | 由本机引擎 `cc.config.json` 生成 `types/cc-env.d.ts` 与测试 stub                                                                  |

### 上传与远程资源

上传所需的变量写在 `.env.local`（见 `.env.example`）：

| 变量                    | 说明                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WECHAT_UPLOAD_KEY`     | 微信小游戏后台「开发管理 → 小程序代码上传」下载的密钥文件路径，文件放在仓库目录外（仓库已忽略 `*.key`），需同时配置上传 IP 白名单                                  |
| `DOUYIN_UPLOAD_TOKEN`   | 抖音开发者后台生成的上传 token；上传时写入临时目录，结束后删除                                                                                                     |
| `REMOTE_SERVER`         | 远程资源服务器地址，构建时注入                                                                                                                                     |
| `REMOTE_UPLOAD_COMMAND` | 构建产物含 `remote/` 时执行的上传命令，`{dir}` 替换为带引号的 remote 目录，例如 `ossutil cp -r {dir} oss://bucket/game/`；凭证放在上传工具自己的配置里，不写进命令 |

上传前会检查：版本号格式、AppID 与构建产物一致且不是占位值、密钥存在、不是调试包、包体不超限、含 `remote/` 时已配置远程服务器地址与上传命令。`remote/` 不随代码包上传。先用 `--dry-run` 确认检查通过。

上传与远程资源流程尚未在正式账号上执行过，待正式 AppID、上传密钥与 CDN 就绪后验证。发布前按 [发布清单](docs/release-checklist.md) 逐项确认。

## 示例游戏与业务入口

`assets/game/` 是示例游戏「点点乐」：首页（金币、设置、抖音侧边栏入口）→ 20 秒限时点击 → 结算（激励视频金币翻倍、分享成绩、插屏后返回首页），最高分与金币存在用户存档。

业务入口在模块顶层注册，启动流水线完成后调用：

```ts
import { setGameEntry } from 'db://game-core';
setGameEntry(() => openMainScreen());
```

开始自己的游戏时删除 `assets/game/` 整个目录即可，项目仍可构建运行（`npm run smoke:web -- --skip-demo` 验证）。

示例为了不依赖编辑器资源，界面用 `db://game-core` 的构建函数代码绘制；正式项目的界面用 prefab + `oops.gui.open`。可照抄的是流程：入口注册、存档 slot、广告结果分支（只有 `completed` 发奖）、分享在点击回调中同步调用、侧边栏奖励用 `claim()` 判重、等待广告期间锁住本页按钮。修改示例文案或节点名会影响 `npm run smoke:web` 的示例检查。

## 目录

```
extensions/oops-plugin-framework/   oops 框架，禁止修改
extensions/game-core/               模板核心插件，以 db://game-core 引用（import-map.json 映射到 index.ts）
assets/scenes/main.scene            启动场景，根节点挂 GameRoot
assets/resources/config.json        环境配置（type: dev / test / prod）
assets/resources/common/            提示 prefab（notify、wait、mask）
assets/game/                        业务代码（示例游戏，可整体删除）
build-configs/                      各平台构建参数（Cocos CLI configPath）
scripts/                            构建、冒烟、插件校验脚本
types/                              无编辑器环境的类型声明
docs/                               开发计划、验证报告、贡献流程、发布清单
```

业务代码约束（ESLint 检查）：不直接访问 `wx`、`tt`、`window`、`globalThis`；只通过 `db://game-core` 公开入口使用模板能力，不引用 `db://game-core/**/impl/**`。

## 环境配置

`assets/resources/config.json` 的 `type` 选择 `config.dev / test / prod`。模板在 oops 字段之外增加 `httpServer`、`httpTimeout`、`httpMock`、`logLevel`、`loginFallback`，代码中用 `getEnv()` 读取。

## game-core 用法

```ts
import { bootPipeline, http, userSave, track } from 'db://game-core';

bootPipeline.register(
  'load-profile',
  async ({ signal }) => {
    await http.get('profile', undefined, { signal });
  },
  { after: 'login', weight: 2 },
);

const profile = userSave.slot('profile', { version: 1, defaults: () => ({ level: 1 }) });
profile.update((p) => (p.level += 1));
track('level_up', { level: profile.get().level });
```

- 内置启动步骤依次为 `login`、`remote-config`，业务步骤用不同的名字注册
- 启动步骤在模块顶层注册，`GameRoot` 在 oops 初始化完成后按顺序执行；用 `{ before: 'remote-config' }` / `{ after: 'login' }` 指定位置，`ctx.signal` 在步骤超时或结束后触发
- 必需步骤失败时显示“启动失败，点击重试”，点击后重新执行整条流水线
- 设备级数据（设置、隐私同意）用 `deviceSave`，用户存档用 `userSave`；`login` 步骤完成后 `userSave` 已切到当前用户；不要调用 `oops.storage.setUser`
- 存档对象可长期持有，切换用户或清空后自动重新读取；值可以是对象、数组或原始类型
- `httpMock: true` 时请求走 `mockTransport`，用 `mockTransport.on(method, path, handler)` 注册假数据

### 登录

`login` 步骤调用 `POST /auth/login { platform, deviceId, code | anonymousCode }`，响应 `{ token, refreshToken, userId, expiresIn }`；请求 401 时调用 `POST /auth/refresh { refreshToken }`，失败再重新登录。userId 不能包含冒号。

登录失败时的行为由 `config.json` 的 `loginFallback` 决定：

| 值              | 行为                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| `guest`（默认） | 以上次登录的 userId 进入；从未登录过则以 `guest-<设备 ID>` 进入。适合单机或后端未就绪 |
| `last-user`     | 只有网络失败且有上次 userId 时离线进入，否则显示“启动失败，点击重试”                  |

离线进入后网络恢复会自动重新登录；如果服务端返回的 userId 与当前存档不同，本局存档不切换，下次启动生效。游客存档与登录后的存档不合并。

### 平台能力

```ts
import { ads, appUpdate, network, platform, sidebar } from 'db://game-core';

ads.configure({ rewarded: { revive: 'adunit-xxx' }, interstitial: { level_end: 'adunit-yyy' } });
const { result, reason } = await ads.showRewarded('revive'); // completed / skipped / failed

if (await sidebar.isSupported()) void sidebar.open(); // 抖音侧边栏
if (sidebar.isLaunchedFromSidebar()) grantSidebarReward();

network.onChange((online) => showOfflineTip(!online));
appUpdate.onReady(() => confirmAndApply(() => appUpdate.apply()));
const { safeTop, menuRect } = platform.getTopInset(); // 窗口逻辑像素
```

- 小游戏端广告位必须先 `ads.configure`，否则返回 `failed` / `not_configured`；Web 调试构建模拟成功，发布构建返回 `unsupported`
- 广告频控：启动 30s 内不展示插屏，插屏间隔 60s，激励视频关闭后 60s 内不展示插屏，错误码 2002 后 30s 内不展示；间隔从广告关闭时算起
- `platform.share()` 必须在触摸回调里同步调用；微信分享结果固定为 `unknown`，分享不发奖励
- 业务代码只能通过 `platform` 使用平台能力，不能直接访问 `wx`、`tt`

### 通用 UI 与合规

```ts
import {
  coreOptions,
  coreUi,
  createPrivacyPrompt,
  onSidebarLaunch,
  privacy,
  settings,
  sidebarReward,
} from 'db://game-core';

// 模块顶层设置，启动时生效
coreOptions.ageRating = '12+';
coreOptions.sidebarEntry.rewardText = '从侧边栏进入，每天领取 100 金币';
privacy.useCustomPrompt(createPrivacyPrompt({ guideName: '《xx小游戏隐私保护指引》' })); // 默认使用平台官方弹窗

const ok = await coreUi.confirm({ title: '提示', content: '确定退出关卡？' });
coreUi.openSettings();
settings.vibrate('short'); // 震动开关关闭时不震动

void coreUi.createSidebarEntry(topBarNode); // 仅抖音创建
onSidebarLaunch(() => {
  if (sidebarReward.claim()) grantReward(); // 奖励由业务发放，须与 rewardText 一致
});

coreUi.setConfirm((options) => openMyDialog(options)); // 替换模板内全部确认框
```

| `coreOptions` 字段                    | 默认                   | 作用                                                              |
| ------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| `healthNotice` / `healthNoticeMinMs`  | `true` / `1500`        | 启动时显示健康游戏忠告加载页及最短展示时间                        |
| `ageRating`                           | `'8+'`                 | 加载页适龄提示角标，`null` 不显示；上线前按后台结果替换为正式图标 |
| `offlineBanner` / `offlineBannerText` | `true`                 | 断网横幅                                                          |
| `updatePrompt`                        | 确认框文案             | 新版本下载完成时询问是否重启，`false` 不弹窗                      |
| `sidebarEntry`                        | `{ text, rewardText }` | 抖音侧边栏入口按钮与引导文案                                      |
| `settingsTitle`                       | `'设置'`               | 设置面板标题                                                      |

- 界面由代码构建，样式在 `THEME`；`addButton`、`addLabel`、`openModal` 等构建函数可直接复用
- 顶部避让：`assets/resources/config.json` 的 `mobileSafeArea` 保持 `false`，顶部 UI 挂 `SafeTopAdapter` 组件或按 `getDesignInset().top` 下移（`safeTop` 只避开刘海，适合与胶囊同一行的左侧元素）
- 隐私：`privacy.needAuthorization()` 预判是否需要授权；`useCustomPrompt` 须在任何隐私接口调用前注册；同意或拒绝都可继续游戏；抖音无法打开平台指引时显示游戏内隐私政策
- 侧边栏：登录完成前从侧边栏进入的，`onSidebarLaunch` 在登录后回调；同一次进入可能回调多次，用 `sidebarReward.claim()` 判重
- 启动加载页在 LayerSystem 并拦截输入；启动步骤中需要交互的界面用 `coreUi.confirm`，或先 `await healthNotice.hide()`
- 隐私政策、用户协议文本在 `assets/resources/legal/`，按行渲染，长度不限；上线前替换为正式文本，并与平台后台的隐私保护指引一致

## 存储 key

oops 存储接口的 key 类型为全局 `GameStorageKey`，由 `OopsFramework.TypedGameStorageKey` 推导。业务新增 key：

```ts
declare global {
  namespace OopsFramework {
    interface TypedGameStorageKey {
      PlayerLevel: 'PlayerLevel';
    }
  }
}
export {};
```

## oops 插件的本地副作用

编辑器加载 oops 插件时会在项目下写入 `.oops/bridge.json`，并在 `127.0.0.1:56688` 启动本地 HTTP 服务。`.oops/` 已加入 `.gitignore`。

## 文档

- [开发计划](docs/development-plan.md)
- [S0 技术验证报告](docs/spike-report.md)
- [贡献流程](docs/contributing.md)
- [发布清单](docs/release-checklist.md)
