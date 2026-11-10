# CI

工作流在 `.github/workflows/`：

| 工作流 | 任务 | 运行环境 | 触发 | 内容 |
| --- | --- | --- | --- | --- |
| `check.yml` | `verify` | GitHub 托管 Ubuntu | push 到 master / `release/**`、指向这些分支的 PR、手动触发 | `npm ci`、`npm run verify`（Node 版本取 `.nvmrc`） |
| `check.yml` | `smoke` | 自建 Runner | push 到 master / `release/**`、手动触发，且仓库变量 `COCOS_RUNNER` 为 `true` | Web 调试构建与冒烟，截图与构建日志上传为 artifact |
| `deploy.yml` | `preflight` → `build` → `upload` → `summary` | 前置检查与汇总用托管 Ubuntu，构建与上传用自建 Runner | 仅手动触发 | 小游戏发布构建、包体检查，上传微信 / 抖音体验版 |

## 发布（deploy.yml）

在 Actions → Deploy → Run workflow 中填写：

| 参数 | 说明 |
| --- | --- |
| `target` | `all` / `wechat` / `douyin` |
| `version` | 版本号，格式 `x.y.z` |
| `desc` | 版本说明 |
| `dry_run` | 只构建并执行上传前检查（`upload.mjs --dry-run`），不上传 |

流程：

1. `preflight`：校验版本号格式、`COCOS_RUNNER`，以及所选平台的 AppID 是否已配置，缺少时列出全部缺项并失败；上传凭证在 `upload` 的上传前检查中校验
2. `build`：发布构建（使用 `config.json` 的 `prod` 环境）与包体检查，产物上传为 artifact `packages-<sha>`（保留 14 天），构建日志与报告上传为 `build-logs-<sha>`
3. `upload`：按平台并行，绑定 Environment `mini-game-production`；下载构建产物后执行 `scripts/upload.mjs`，上传前检查与本地相同（AppID 一致、非调试包、包体、remote 配置）；构建产物含 `remote/` 时先执行 `REMOTE_UPLOAD_COMMAND`
4. `summary`：在运行摘要中输出各阶段结果、版本号与提交

同一时间只运行一个发布；运行期间再触发时，只保留最后一次触发排队，之前排队的会被取消。

## 自建 Runner

Cocos 命令行构建需要图形会话，Runner 需满足：

- macOS，用户登录状态下以 LaunchAgent 方式运行 GitHub Actions Runner（不能用无界面的 LaunchDaemon）
- 安装 Cocos Creator 3.8.8（默认路径 `/Applications/Cocos/Creator/3.8.8/CocosCreator.app`，其他路径设置 `COCOS_CREATOR_APP`）
- 安装 Google Chrome（冒烟测试用，其他路径设置 `CHROME_PATH`）
- 注册 Runner 时添加标签 `cocos-creator`，Runner 版本不低于 2.327.1（`actions/checkout@v7` 等运行在 Node 24）
- 微信上传需在小程序后台把 Runner 的出口 IP 加入上传 IP 白名单
- 使用远程资源时，Runner 上安装 `REMOTE_UPLOAD_COMMAND` 用到的上传工具，并在工具自己的配置中保存 CDN 凭证
- Runner 就绪后在仓库 Settings → Secrets and variables → Actions → Variables 中添加 `COCOS_RUNNER=true`，未设置时 `smoke` 跳过、`deploy.yml` 在前置检查失败
- 仓库为公开仓库，fork 的 PR 可以修改工作流：在 Settings → Actions → General 中把 fork PR 工作流设为需要审批（Require approval for all external contributors），并只把 Runner 加入本仓库

Node.js 由工作流按 `.nvmrc` 安装。工作流只读仓库内容（`permissions: contents: read`）；同一 PR 的新提交会取消进行中的检查，push 的每个提交都完整运行；`verify` 超时 15 分钟、`smoke` 30 分钟、发布构建 60 分钟、每个平台上传 30 分钟。

## Secrets 与 Variables

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `WECHAT_APPID`、`DOUYIN_APPID` | 发布构建与上传使用的正式 AppID，须配置为仓库级 Secret |
| Secret | `WECHAT_UPLOAD_KEY` | 微信「开发管理 → 小程序代码上传」下载的密钥文件**内容**，上传时写入 Runner 临时目录，结束后删除 |
| Secret | `DOUYIN_UPLOAD_TOKEN` | 抖音开发者后台生成的上传 token |
| Variable | `COCOS_RUNNER` | 自建 Runner 就绪后设为 `true` |
| Variable | `REMOTE_SERVER` | 远程资源服务器地址，构建时注入；不使用远程 Bundle 时留空 |
| Variable | `REMOTE_UPLOAD_COMMAND` | 构建产物含 `remote/` 时的上传命令，写法同 `.env.example`；凭证不写进命令 |

`WECHAT_UPLOAD_KEY`、`DOUYIN_UPLOAD_TOKEN` 可以只配置在 Environment `mini-game-production` 中，并为该 Environment 设置审批人（Settings → Environments → Required reviewers），每次上传前需要审批。Environment 在首次运行发布时自动创建。

发布前仍需按 [发布清单](release-checklist.md) 逐项确认；上传流程待正式 AppID、上传密钥与 Runner 就绪后验证。
