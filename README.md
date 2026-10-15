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

## 常用命令

| 命令                                             | 作用                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `npm run build [-- web wechat douyin] [--debug]` | 命令行构建，默认三端；退出码 36 且日志中没有匹配 `/ - error: /` 的行才算成功，日志在 `temp/build-logs/` |
| `npm run smoke:web`                              | 运行 `build/web-mobile`（需 `--debug` 构建）                                                            |
| `npm run verify`                                 | 格式、lint、类型检查、单测、插件校验                                                                    |
| `npm run check:plugins`                          | 校验 `extensions/oops-plugin-framework` 与锁定快照一致                                                  |
| `npm run gen:cc-env`                             | 由本机引擎 `cc.config.json` 生成 `types/cc-env.d.ts` 与测试 stub                                        |

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

`assets/resources/config.json` 的 `type` 选择 `config.dev / test / prod`。模板在 oops 字段之外增加 `httpServer`、`httpTimeout`，代码中用 `getEnv()` 读取。

## game-core 用法

```ts
import { bootPipeline, http, mockTransport, userSave, setSaveUser, track, createLogger } from 'db://game-core';

bootPipeline.register(
  'login',
  async () => {
    const res = await http.post<{ userId: string }>('auth/login', { code: 'x' }, { skipAuth: true });
    setSaveUser(res.data.userId);
  },
  { weight: 2 },
);

const profile = userSave.slot('profile', { version: 1, defaults: () => ({ level: 1 }) });
profile.update((p) => (p.level += 1));
track('level_up', { level: profile.get().level });
```

- 启动步骤在模块顶层注册，`GameRoot` 在 oops 初始化完成后按顺序执行；用 `{ before: 'remote-config' }` / `{ after: 'login' }` 指定位置，`ctx.signal` 在步骤超时或结束后触发
- 必需步骤失败时显示“启动失败，点击重试”，点击后重新执行整条流水线
- 设备级数据（设置、隐私同意）用 `deviceSave`，用户存档用 `userSave`；`userSave` 在 `setSaveUser` 之前读写会告警；不要调用 `oops.storage.setUser`
- 存档对象可长期持有，切换用户或清空后自动重新读取；值可以是对象、数组或原始类型
- `httpMock: true` 时请求走 `mockTransport`，用 `mockTransport.on(method, path, handler)` 注册假数据

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
