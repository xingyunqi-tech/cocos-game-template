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

| 命令                                                                         | 作用                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run build [-- web wechat douyin] [--debug] [--allow-placeholder-appid]` | 命令行构建，默认三端；退出码 36 且日志中没有匹配 `/ - error: /` 的行才算成功，日志在 `temp/build-logs/` |
| `npm run smoke:web`                                                          | 运行 `build/web-mobile`（需 `--debug` 构建）                                                            |
| `npm run verify`                                                             | 格式、lint、类型检查、单测、插件校验                                                                    |
| `npm run check:plugins`                                                      | 校验 `extensions/oops-plugin-framework` 与锁定快照一致                                                  |
| `npm run gen:cc-env`                                                         | 由本机引擎 `cc.config.json` 生成 `types/cc-env.d.ts` 与测试 stub                                        |

## 目录

```
extensions/oops-plugin-framework/   oops 框架，禁止修改
extensions/game-core/               模板核心插件，以 db://game-core 引用（import-map.json 映射到 index.ts）
assets/scenes/main.scene            启动场景，根节点挂 GameRoot
assets/resources/config.json        环境配置（type: dev / test / prod）
assets/resources/common/            提示 prefab（notify、wait、mask）
assets/game/                        业务代码
build-configs/                      各平台构建参数（Cocos CLI configPath）
scripts/                            构建、冒烟、插件校验脚本
types/                              无编辑器环境的类型声明
docs/                               开发计划、验证报告、贡献流程
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
