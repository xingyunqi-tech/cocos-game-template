# game-core 变更记录

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
