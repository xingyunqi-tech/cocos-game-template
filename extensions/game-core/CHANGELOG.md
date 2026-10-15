# game-core 变更记录

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
