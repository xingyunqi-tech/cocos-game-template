# CI

工作流在 `.github/workflows/ci.yml`：

| 任务 | 运行环境 | 触发 | 内容 |
| --- | --- | --- | --- |
| `verify` | GitHub 托管 Ubuntu | push 到 main、PR | `npm ci`、`npm run verify` |
| `build` | 自建 Runner（标签 `self-hosted`、`macOS`、`cocos-creator`） | push 到 main | Web 调试构建 + 冒烟、三端发布构建 + 包体检查，产物与包体报告上传为 artifact |

## 自建 Runner

Cocos 命令行构建需要图形会话，Runner 需满足：

- macOS，用户登录状态下以 LaunchAgent 方式运行 GitHub Actions Runner（不能用无界面的 LaunchDaemon）
- 安装 Cocos Creator 3.8.8（默认路径 `/Applications/Cocos/Creator/3.8.8/CocosCreator.app`，其他路径设置 `COCOS_CREATOR_APP`）
- 安装 Google Chrome（冒烟测试用，其他路径设置 `CHROME_PATH`）
- Node.js 22.13 以上
- 注册 Runner 时添加标签 `cocos-creator`

## Secrets

| 名称 | 用途 |
| --- | --- |
| `WECHAT_APPID`、`DOUYIN_APPID` | 发布构建使用正式 AppID；未配置时以占位 AppID 构建 |

上传体验版需要密钥与 token，CI 中默认不执行；需要时在仓库 Secrets 中配置 `WECHAT_UPLOAD_KEY`（写入临时文件）与 `DOUYIN_UPLOAD_TOKEN`，并增加 `npm run upload:*` 步骤。
