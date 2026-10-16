# 开发指南

## 1. 分层与约束

```
assets/game/          业务层：只依赖 db://game-core 公开入口、oops 公开 API 与 cc
extensions/game-core/ 模板核心：平台适配、网络、存档、UI、合规、监控，以插件分发
extensions/oops-plugin-framework/  oops 框架，禁止修改
```

- 业务层不直接访问 `wx`、`tt`、`window`、`globalThis`，平台能力通过 `platform` 使用（ESLint 检查）
- 业务层不引用 `db://game-core/**/impl/**`
- 修改 game-core 前先确认能否通过 `coreOptions`、`coreUi.setConfirm`、`THEME` 等扩展点实现；必须修改时向模板仓库提交，避免下游各自改插件

## 2. 启动顺序

`GameRoot` 加载 `config.json` → oops 初始化 → `initGameCore()` → 启动流水线（`tables` → `login` → `remote-config` → 业务步骤）→ 关闭健康忠告加载页 → `setGameEntry` 注册的入口。

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
- 单个 slot 超过 512KB 会告警，平台单 key 上限 1MB、总量 10MB

## 4. 配置表

1. 在 `config-tables/` 放 `.xlsx`，每个工作表是一张表，表名即工作表名（以 `#` 开头的工作表不导出）
2. 第 1 行字段名、第 2 行类型、第 3 行说明，第 4 行起为数据；第 1 列为主键（`int` 或 `string`）；以 `#` 开头的列不导出
3. 类型：`int`、`float`、`string`、`bool`（true/false/1/0/是/否）、`json`、`int[]`、`float[]`、`string[]`（逗号或竖线分隔）
4. 执行 `npm run tables`，生成 `assets/resources/tables/<表名>.json` 与 `assets/game/tables/TableTypes.ts`
5. 代码中 `Tables.get('demo_level', 1)`、`Tables.all('demo_level')`，类型自动推导

启动流水线的 `tables` 步骤加载 `resources/tables` 下全部 JSON。`assets/resources/tables/` 完全由 `npm run tables` 管理，脚本会删除没有对应 Excel 的 JSON，不要在其中手写文件。

## 5. 平台差异

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

## 6. 调试

- 调试构建右下角有 GM 按钮：切换环境、广告模拟（完成/跳过/失败）、模拟侧边栏进入、性能面板、清空存档；切换环境与清空存档在 Web 自动刷新页面，小游戏需关闭后重新打开
- 环境覆盖只影响 `getEnv()` 读取的字段（服务器地址、mock、日志级别等），`frameRate`、`stats` 等 oops 启动时已使用的字段仍取 `config.json` 的 `type`
- 模拟侧边栏进入后，本次运行内 `sidebar.isLaunchedFromSidebar()` 一直为 true
- Web 调试构建在 `window.gameCore` 暴露核心对象，供控制台与冒烟测试使用
- `config.json` 的 `httpMock: true` 时请求走 `mockTransport`，内置登录、刷新、远程配置、埋点的 mock
- `coreOptions.gm = false` 可关闭 GM 按钮；发布构建不创建 GM 界面，但代码仍在包内（Cocos 不剔除未使用的项目脚本）

## 7. 删除示例游戏

1. 删除 `assets/game/` 目录（`TableTypes.ts` 一并删除，重新执行 `npm run tables` 会再生成）
2. 按需删除 `config-tables/demo.xlsx` 并重新执行 `npm run tables`
3. `npm run build -- web --debug && npm run smoke:web -- --skip-demo`

## 8. 监控

- `track(event, params)` 埋点，`reportError(err, source)` 错误上报；公共参数含版本、平台、envVersion
- `config.json` 的 `trackPath` 非空时批量上报到该接口（20 条或 10 秒一批，切后台立即发送），错误以 `error` 事件上报
- `remoteConfigPath` 非空时启动拉取远程配置，失败使用上次缓存，再失败使用默认值
