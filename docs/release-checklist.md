# 发布清单

每次提交体验版或提审前逐项确认。平台后台规则以官方文档为准，核实来源见 `docs/spike-report.md` §5。

## 1. 构建与包体

- [ ] `.env.local` 已填写正式 `WECHAT_APPID`、`DOUYIN_APPID`，发布构建未使用 `--allow-placeholder-appid`
- [ ] `assets/resources/config.json` 的 `type` 为 `prod`，`httpMock` 为 `false`，`loginFallback` 符合产品要求；构建后在体验版确认环境（服务器地址）正确
- [ ] prod 环境的 `remoteConfigPath`、`trackPath` 已填正式接口或确认留空
- [ ] `npm run verify` 通过
- [ ] `npm run build:wechat`、`npm run build:douyin` 成功，包体检查通过（主包 ≤ 4MB；微信总包 ≤ 30MB；抖音总包 ≤ 20MB，开通虚拟支付后改 `scripts/size-limits.json` 为 30MB）
- [ ] 包体报告（构建输出中的主包、分包、remote 大小）已存档
- [ ] 使用远程 Bundle 时：构建设置了 `REMOTE_SERVER`，远程资源已上传 CDN，资源地址与本次构建一致

## 2. 隐私与合规

- [ ] 微信后台《用户隐私保护指引》已声明游戏使用的全部隐私接口（剪贴板、设备信息等）
- [ ] 抖音后台隐私协议已配置
- [ ] `assets/resources/legal/privacy.txt`、`agreement.txt` 已替换为法务审核的正式文本，与后台指引一致
- [ ] 使用自定义隐私弹窗时，`createPrivacyPrompt({ guideName })` 已填后台指引全称
- [ ] 隐私弹窗同意、拒绝两条路径都能继续基础玩法
- [ ] 健康游戏忠告在加载页展示
- [ ] 后台已完成适龄提示设置，`coreOptions.ageRating` 与后台一致，并替换为正式适龄提示图标
- [ ] 防沉迷：小游戏端由平台负责；Web 国内运营已接入实名与时长限制（`IAntiAddiction`）
- [ ] 软著、版号等资质与变现方式匹配（立项前确认）

## 3. 平台后台

- [ ] 服务器域名（request、socket、downloadFile）已配置，均为 ICP 备案的 https / wss 域名；`REMOTE_SERVER` 的 CDN 域名已加入 downloadFile 合法域名
- [ ] 最低基础库版本：微信 ≥ 2.32.3，抖音 ≥ 2.92.0
- [ ] 广告位已创建，`ads.configure` 中的广告单元 ID 为正式值（不是 `adunit-*-placeholder`）
- [ ] 分享标题与图片不含诱导分享文案，分享不发奖励

## 4. 抖音侧边栏（必接）

- [ ] 上传预检通过（包内存在 `tt.navigateToScene` 调用）
- [ ] 主界面一级入口可见，引导文案与实际奖励一致（`coreOptions.sidebarEntry.rewardText`）
- [ ] 从侧边栏进入后奖励到账，同一天不重复发放
- [ ] 按官方方法验证：开发者工具模拟器，或编译模式选场景 021036 真机调试，或加白后全入口打开指定版本

## 5. 真机回归

按开发计划 §8 机型矩阵（iOS 新旧各 1 台，Android 中端、低端各 1 台）逐项确认：

- [ ] 冷启动：加载页 ≤ 2s，主界面可交互 ≤ 5s
- [ ] 登录成功；断网冷启动可离线进入；恢复网络后请求正常
- [ ] 完整玩一局：开始、玩法、结算、最高分保存
- [ ] 激励视频：完整观看发奖，中途关闭不发奖，无广告时有提示
- [ ] 插屏：频控生效（启动 30s 内不出现，两次间隔 ≥ 60s，激励视频后 60s 内不出现）
- [ ] 分享：拉起分享面板，从分享卡片进入正常
- [ ] 存档：杀进程重启后进度、设置项保留；切换账号后存档隔离
- [ ] 前后台：切后台再回来音乐、计时正常，存档已落盘
- [ ] 断网横幅出现与消失
- [ ] 顶部 UI 不被刘海、胶囊遮挡
- [ ] 登录后修改系统日期，侧边栏奖励不会重复发放（`serverTime.calibrated` 为 true，确认 `getPerformance` 单位判定正确）
- [ ] 抓包确认登录等 POST 请求只有一个 `content-type: application/json`
- [ ] 断网冷启动时 10 秒左右离线进入（平台登录超时），恢复网络后自动重新登录
- [ ] 抖音录屏：开始后立即停止不残留录制，录制 3 秒以上可分享
- [ ] 主场景 60s 采样帧率 ≥ 55，内存峰值 ≤ 300MB
- [ ] 性能报告（首屏、可交互耗时、帧率、内存，按机型）已存档

## 6. 上传

- [ ] `--dry-run` 检查通过
- [ ] 微信上传 IP 白名单包含本机或 CI 出口 IP
- [ ] `npm run upload:wechat -- --version <版本号> --desc <说明>` 成功，体验版可打开，平台统计的包体与构建报告一致
- [ ] `npm run upload:douyin -- --version <版本号> --desc <说明>` 成功，预检通过
- [ ] 版本号与 `config.json` 的 `version`、`game-core` CHANGELOG 记录一致
