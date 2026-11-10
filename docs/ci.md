# CI

工作流在 `.github/workflows/ci.yml`：

| 任务 | 运行环境 | 触发 | 内容 |
| --- | --- | --- | --- |
| `verify` | GitHub 托管 Ubuntu | push 到 master / `release/**`、指向这些分支的 PR、手动触发 | `npm ci`、`npm run verify`（Node 版本取 `.nvmrc`） |
| `build` | 自建 Runner（标签 `self-hosted`、`macOS`、`cocos-creator`） | push 到 master / `release/**`、手动触发，且仓库变量 `COCOS_RUNNER` 为 `true` | Web 调试构建 + 冒烟、三端发布构建 + 包体检查，产物与包体报告上传为 artifact |

## 自建 Runner

Cocos 命令行构建需要图形会话，Runner 需满足：

- macOS，用户登录状态下以 LaunchAgent 方式运行 GitHub Actions Runner（不能用无界面的 LaunchDaemon）
- 安装 Cocos Creator 3.8.8（默认路径 `/Applications/Cocos/Creator/3.8.8/CocosCreator.app`，其他路径设置 `COCOS_CREATOR_APP`）
- 安装 Google Chrome（冒烟测试用，其他路径设置 `CHROME_PATH`）
- 注册 Runner 时添加标签 `cocos-creator`，Runner 版本不低于 2.327.1（`actions/checkout@v7` 等运行在 Node 24）
- Runner 就绪后在仓库 Settings → Secrets and variables → Actions → Variables 中添加 `COCOS_RUNNER=true`，未设置时 `build` 跳过
- 仓库为公开仓库，fork 的 PR 可以修改工作流：在 Settings → Actions → General 中把 fork PR 工作流设为需要审批（Require approval for all external contributors），并只把 Runner 加入本仓库

Node.js 由工作流按 `.nvmrc` 安装。工作流只读仓库内容（`permissions: contents: read`）；同一 PR 的新提交会取消进行中的运行，push 的每个提交都完整运行；`verify` 超时 15 分钟、`build` 超时 60 分钟；构建失败时仍上传日志与已有产物。

## Secrets

| 名称 | 用途 |
| --- | --- |
| `WECHAT_APPID`、`DOUYIN_APPID` | 发布构建使用正式 AppID；未配置时以占位 AppID 构建 |

上传体验版需要密钥与 token，CI 中默认不执行；需要时在仓库 Secrets 中配置 `WECHAT_UPLOAD_KEY`（写入临时文件）与 `DOUYIN_UPLOAD_TOKEN`，并增加 `npm run upload:*` 步骤。
