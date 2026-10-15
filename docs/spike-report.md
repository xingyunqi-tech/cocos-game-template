# S0 技术验证报告

> 日期：2026-10-15｜环境：macOS 27.0.1 arm64，Node 22.22.3，Cocos Creator 3.8.8（`/Applications/Cocos/Creator/3.8.8`）

## 1. 结论摘要

| 项 | 结论 | 状态 |
|---|---|---|
| 版本组合 | **锁定 Creator 3.8.8 + oops develop `0152111f`**。最小项目三端构建无 error；Web 运行时 Toast、等待提示渲染已截图确认 | 完成 |
| 工具链 | TypeScript 6.0.3（7.0.2 与 typescript-eslint 不兼容）；引用 oops 的代码 strict tsc 0 错误（需 §3.2 的类型声明） | 完成 |
| `cc/env` | `WECHAT`、`BYTEDANCE` 等 48 个常量；`@cocos/creator-types` 不含 `cc/env`，仓库自行维护 | 完成 |
| 资源与脚本放置 | 插件目录可作 Asset Bundle；启动场景可引用插件非 bundle 目录的脚本 | 完成 |
| 引擎模块 | 最小可运行集 12 个模块，`profiler` 必须保留 | 完成 |
| 包体基线 | 空模板微信 2,495,078 字节，距 4MB 主包上限约 1.6MB | 完成 |
| 平台规则 | 12 项核实，2 项官方未写明 | 完成 |
| CLI 判定 | 资源引用脚本失效时仍返回 36；语法错误返回 34 | 完成 |
| 小游戏模拟器运行 | 未运行（微信开发者工具 CLI 需在工具内开启服务端口；抖音开发者工具未安装） | 遗留，批次 3 结束前 |
| 微信分离引擎 | 需正式 AppID | 遗留，批次 4 前 |
| 真机性能基线 | 需 AppID 与测试机 | 遗留，批次 4 前 |

## 2. 版本清单（2026-10-15 查询）

| 依赖 | 锁定版本 | 来源 |
|---|---|---|
| Cocos Creator | 3.8.8 | GitHub `cocos/cocos-engine` 最新正式 release（2025-12-16） |
| oops-plugin-framework | develop `0152111f7c0efd895d376e4c0caaf9027549c865`（2026-07-04） | Gitee / GitHub `dgflash/oops-plugin-framework`，当日 HEAD 未变 |
| oops 教程工程（资源来源） | `c231adf1ba7fe134ed683a70448c0fba50ee72bb`（2026-04-12） | GitHub `dgflash/oops-framework` |
| `@cocos/creator-types` | 3.8.8 | npm |
| `typescript` | 6.0.3 | npm（`latest` 为 7.0.2，见 §3.1） |
| `eslint` | 10.12.0 | npm |
| `typescript-eslint` | 8.71.2 | npm |
| `prettier` | 3.9.10 | npm |
| `vitest` | 5.0.4 | npm |
| `miniprogram-ci` | 2.1.31 | npm |
| `tt-ide-cli` | 0.1.33 | npm |
| `exceljs` | 4.4.0 | npm |
| `tsrpc` / `tsrpc-browser` / `tsrpc-miniapp` | 3.4.21 / 3.4.18 / 3.4.18 | npm |
| Node.js | `^22.13 \|\| ^24 \|\| >=26` | ESLint 10（`^20.19.0 \|\| ^22.13.0 \|\| >=24`）与 Vitest 5（`^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`）的交集 |

## 3. 工具链

### 3.1 基础组合

| 检查 | 结果 |
|---|---|
| `typescript@7.0.2` + `typescript-eslint@8.71.2` | npm 安装失败：peer 要求 `typescript >=4.8.4 <6.1.0` |
| `typescript@6.0.3` + `@cocos/creator-types@3.8.8`，strict `tsc --noEmit` | 通过 |
| ESLint 10 flat config + `recommendedTypeChecked` + `projectService` | 通过；配置文件与 stub 目录需加入 `ignores` |
| Vitest 5 + `cc`、`cc/env` alias stub | 通过 |
| Prettier 3.9 | 可用 |

### 3.2 引用 oops 的类型检查

paths `db://oops-framework/*` 指向 oops `assets/`，import `core/Oops`、`core/Root`，strict 下：

| 配置 | 错误数 |
|---|---|
| 仅 include oops `assets/types` + 部分 `cc/env` 声明 | 17（13 个 `GameStorageKey` 未定义、2 个 `cc/env` 缺常量、`Node.uiSprite`、`ViewModel`） |
| + 完整 `cc-env.d.ts`（48 个常量，按引擎 `cc.config.json` 生成） + `declare type GameStorageKey = string` | 4 |
| + include oops `libs/extension/NodeExt.ts` + `declare type ViewModel<T> = { $data: T }` | **0** |

`GameStorageKey` 是 develop 要求项目侧声明的全局类型（`StorageDecorator.ts:13`）；`ViewModel` 在 `VMBase.ts` 中使用但未导出。无 strictness 类错误，strict 仅作用于 `game-core` 与 `assets/game` 可行。

### 3.3 ESLint 依赖约束

| 写法 | 规则 | 结果 |
|---|---|---|
| `wx`、`tt`（全局声明在 `.d.ts`） | `no-restricted-globals` | 拦截 |
| `window.location` | `no-restricted-globals` | 拦截 |
| `(globalThis as …).tt`、`globalThis['wx']` | `no-restricted-syntax`：`Identifier[name='globalThis']` | 拦截 |

## 4. `cc/env` 平台常量

- 引擎 3.8.8 `cc.config.json` 的 `constants` 共 48 个，含 `WECHAT`、`WECHAT_MINI_PROGRAM`、`BYTEDANCE`、`MINIGAME`、`HTML5`、`PREVIEW`、`EDITOR`、`EDITOR_NOT_IN_PREVIEW`、`DEBUG`、`DEV`、`BUILD` 等
- `@cocos/creator-types@3.8.8` 只提供 `cc` 模块类型；`cc/env` 声明由编辑器生成在 `temp/declarations`，干净 clone 与 CI 中不存在
- 处理：仓库维护 `types/cc-env.d.ts`（由 `cc.config.json` 生成），Vitest 中 alias 到 stub

## 5. 平台规则核实

核实日期 2026-10-15，均来自官方文档页面。

| # | 项 | 结论 | 来源 |
|---|---|---|---|
| 1 | 抖音包体 | 主包 ≤ 4MB；单个分包 ≤ 20MB，整体 ≤ 20MB；开通虚拟支付后单个分包与整体 ≤ 30MB；开放数据域 ≤ 4MB | [分包介绍](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/basic-function/subpackages/introduction) |
| 2 | 抖音插屏频控 | 启动 30s 内不展示；两次插屏间隔 ≥ 60s；激励视频展示后与插屏间隔 ≥ 60s；实例成功展示一次后须 `destroy()` 再新建（错误码 123324）；load / show 失败可在同一实例重新 `load()`；未展示过的实例不能 destroy；错误码 2002 需等待 ≥ 30s；需在后台开通流量主并建广告位 | [插屏广告指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/ad/interstitial-ad)、[注意事项](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/ads/interstitial-ad/interstitial-ad-notice) |
| 3 | 侧边栏复访 | 必接（2023-11-24 起）；上传预检静态扫描 js 文件中的 `tt.navigateToScene` 调用，缺失则**拦截上传** | [必接能力技术指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/open-ability/Introduction-for-tech)、[开发者工具](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/dev-tools/mini-app-developer-instrument) |
| 4 | 侧边栏 API | `tt.checkScene` / `tt.navigateToScene` 基础库 2.92.0，参数 `{ scene: 'sidebar' }`；`checkScene` 返回 `isExist`；错误码 20001 参数错误、21101 场景不可达、10101 需升级抖音；`tt.onShow` 须在启动时同步注册，以最新回调判断来源 | [tt.checkScene](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/sidebar-capacity/tt-check-scene)、[tt.navigateToScene](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/sidebar-capacity/tt-navigate-to-scene) |
| 5 | 侧边栏来源识别 | `scene`（抖音 021036、抖音极速版 101036、番茄小说 181036、红果短剧 261036）+ `launch_from: 'homepage'` + `location: 'sidebar_card'` | 同 #3 |
| 6 | 侧边栏测试 | 方案 1：开发者工具 ≥ 4.1.7 模拟器；方案 2：编译模式选场景 021036 后真机调试；方案 3（推荐）：未上线游戏先联系客服加白，后台添加测试设备，抖音开发者模式开启「全入口打开指定版本小游戏」 | 同 #3 |
| 7 | 抖音胶囊位置 | 小游戏使用 `tt.getMenuButtonLayout`（基础库 1.25.0，同步，单位 dp）；`getMenuButtonBoundingClientRect` 仅小程序 | [tt.getMenuButtonLayout](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/interface/menu/tt-get-menu-button-layout) |
| 8 | 抖音隐私 | 小游戏仅有 `tt.onNeedPrivacyAuthorization`（基础库 4.17.0，回调 `(resolve, eventInfo)`，`resolve({ event: 'agree' \| 'disagree' })`）；`getPrivacySetting`、`openPrivacyContract` 只见于小程序文档 | [tt.onNeedPrivacyAuthorization](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/authorization/tt-need-privacy-auth) |
| 9 | 微信隐私 | `wx.getPrivacySetting` / `onNeedPrivacyAuthorization` / `requirePrivacyAuthorize` 基础库 2.32.3；不注册监听时由平台统一弹窗；`game.json` 中不存在 `officialPrivacyAuthorizationShowingGap` | [wx.getPrivacySetting](https://developers.weixin.qq.com/minigame/dev/api/open-api/privacy/wx.getPrivacySetting.html)、[game.json 配置](https://developers.weixin.qq.com/minigame/dev/reference/configuration/app.html) |
| 10 | 微信引擎插件 | 插件 CocosCreatorV3 已发布 3.8.8（2025-12-15）；构建选项 `separateEngine`，仅内置引擎、非调试模式；只支持 js 模式；需客户端 ≥ 7.0.7、基础库 ≥ 2.9.0；引擎代码仍计入首包 | [Cocos 引擎插件](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/wechatgame-plugin.html)、[微信引擎插件](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/game-engine-plugin.html) |
| 11 | Cocos CLI | 退出码 32 参数不合法、34 构建失败、36 成功；`platform` 为 `web-mobile`、`wechatgame`、`bytedance-mini-game`；`configPath` 指向构建面板导出的 JSON，命令行显式参数优先；平台参数放 `packages.<平台名>` | [命令行发布](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html) |
| 12 | 微信系统信息 | `getWindowInfo` / `getDeviceInfo` / `getAppBaseInfo` 基础库 2.25.3；`getSystemInfoSync` 自 2.20.1 停止维护（未移除） | [wx.getWindowInfo](https://developers.weixin.qq.com/minigame/dev/api/base/system/wx.getWindowInfo.html)、[wx.getSystemInfoSync](https://developers.weixin.qq.com/minigame/dev/api/base/system/wx.getSystemInfoSync.html) |

**未能核实**：抖音插屏的个人开发者开通门槛（官方未写）；抖音小游戏能否调用 `tt.getPrivacySetting`、`tt.openPrivacyContract`（无小游戏文档，按不支持处理并做运行时能力检测）；微信小游戏后台"基础库最低版本"的设置位置（小程序后台有该设置，小游戏后台待批次 4 用正式账号确认）。

## 6. 编辑器验证

全部通过 Cocos CLI 构建；Web 产物用本地 HTTP 服务 + 无头 Chrome（playwright-core，SwiftShader）运行，采集控制台、pageerror 与定时截图。两条 404 均为 `/favicon.ico`。

### 6.1 教程工程 + master 插件（作者配套组合）

| 平台 | 退出码 | ` - error: ` 行 | 运行 |
|---|---|---|---|
| Web | 36 | 0 | 场景、UI、角色正常渲染，无运行时错误 |
| 微信 | 36 | 0 | 未运行 |
| 抖音 | 36 | 0 | 未运行 |

### 6.2 教程工程 + develop 插件

| 平台 | 退出码 | ` - error: ` 行 | 运行 |
|---|---|---|---|
| Web | 36 | 17 | `TypeError: Cannot read properties of undefined (reading 'prototype')`，无法启动 |
| 微信 | 36 | 17 | 未运行（评审复现） |

17 条 error 均为教程业务脚本与 develop API 不兼容导致的脚本失效，`main.scene` 根节点 `Main` 脚本失效。

### 6.3 CLI 失败判定

| 场景 | 退出码 | 日志 |
|---|---|---|
| 资源引用的脚本失效 | 36 | ` - error: Script "…" attached to … is missing or invalid` |
| 脚本 TS 语法错误 | 34 | ` - error: [buildScriptCommand]SyntaxError: …` |
| 正常构建 | 36 | 无 ` - error: ` 行；每份日志都有 `debug: Error: Exit process with code:null …` 与 Chromium `ERROR:mach_port_rendezvous` 行，不属于失败 |

判定规则：退出码 36 且无匹配 `/ - error: /` 的行。

### 6.4 最小项目 + develop 插件（模板实际形态）

构成：教程的 `main.scene`、`resources/config.json`、`resources/common`（notify、wait、mask 及贴图）、`resources/language`；删除教程业务代码、`content`、`audios`、热更新 manifest、`config/game`、`alert`、`confirm`。`Main` 脚本放在测试插件 `extensions/s0-core/assets/scripts/`（非 bundle 目录），保留原 meta UUID，继承 develop `Root`，`GuiPromptConfig` 指向 `common/prefab/{notify,wait,mask}`。

| 检查 | 方法 | 结果 |
|---|---|---|
| 三端构建 | CLI | 退出码 36，` - error: ` 行 0 |
| 启动场景引用插件脚本 | `main.scene` 根节点脚本位于插件非 bundle 目录 | `Root.run` 执行 |
| Toast | 启动页结束后（7s）调用 `oops.gui.toast`，400ms 后截图与节点树 | 截图可见"S0 toast"；节点树 `LayerNotify/notify/item/prompt` |
| 等待提示 | `oops.gui.waitOpen()`，1.5s 后截图 | 截图可见转圈 |
| 遮罩 | `ViewUtil.createPrefabNodeAsync(mask)` 挂到 `LayerPopUp` | 实例化与挂载无异常；黑色背景下无法目视确认 |
| 插件 Asset Bundle | 测试插件 `assets/ui` 设为 bundle `core-ui`，内含 notify prefab 副本（引用 oops 插件非 bundle 目录的 Notify 脚本） | 构建产出 `assets/core-ui`；`loadBundle` + `load` + `instantiate` 成功 |
| 跨 bundle 资源 | 比对产物 | `core-ui` 与 `resources` 各有一份相同的贴图与 bin（`ef58b575…png`、`4cecde51…bin`） |

未验证：场景放在插件挂载目录（模板 Root 场景放项目 `assets/`，不需要）。

### 6.5 引擎模块

教程的 `settings/v2/packages/engine.json` 为裁剪后的 2D 配置（18 个模块，含 spine-3.8、dragon-bones、video、particle-2d、rich-text、intersection-2d、profiler），最小项目最初整体继承了该文件。

| 模块集 | 结果 |
|---|---|
| 去掉 dragon-bones、spine、video、particle-2d、rich-text、intersection-2d、profiler | 运行时 `Cannot read properties of undefined (reading 'hideStats')`：oops `Root` 按 `config.json` 的 `stats` 调用 `profiler` |
| 上述基础上保留 `profiler`（共 12 个：`base`、`gfx-webgl`、`2d`、`ui`、`animation`、`audio`、`tween`、`mask`、`graphics`、`affine-transform`、`custom-pipeline`、`profiler`） | 三端构建无 error；Web 运行、Toast、等待提示、插件 bundle 全部通过 |

oops 源码引用 `sp`、`dragonBones`、物理、3D 类型，在上述模块集下未出现运行时错误（相关类未在启动路径实例化）；业务用到 Spine 等能力时再按需开启模块。

### 6.6 包体基线（按文件字节统计）

最小模块集，删除教程遗留后的空模板：

| 平台 | 总计 | 引擎 `cocos-js` | `main` | `internal` | `resources` | `core-ui` | `src` |
|---|---|---|---|---|---|---|---|
| Web | 2,609,034 | 1,675,474 | 435,131 | 230,743 | 93,122 | 54,227 | 112,903 |
| 微信 | 2,495,078 | 1,520,150 | 425,449 | 164,161 | 93,122 | 54,227 | 76,759 |
| 抖音 | 2,469,444 | 1,527,848 | 425,449 | 164,161 | 93,122 | 54,227 | 96,115 |

- 微信、抖音距 4MB（4,194,304 字节）主包上限约 1.6MB
- 对照：继承教程 18 个模块时微信引擎 2,123,286 字节，裁剪节省约 0.6MB
- `main` 约 0.42MB 主要为 oops 全部脚本
- 测试插件 bundle `core-ui` 不会出现在模板中，实际 `game-core` bundle 大小在批次 5 后重新统计

## 7. 遗留项

| # | 项 | 前置 | 截止 |
|---|---|---|---|
| 1 | 微信开发者工具模拟器运行 wechatgame 空包（测试号） | 微信开发者工具开启服务端口，或手工导入构建目录 | 批次 3 结束前 |
| 2 | 抖音开发者工具模拟器运行 bytedance-mini-game 空包 | 安装抖音开发者工具 | 批次 3 结束前 |
| 3 | 微信 `separateEngine` 构建，记录可用性与缓存效果 | 正式 AppID | 批次 4 前 |
| 4 | 机型矩阵冷启动：首屏、可交互耗时与内存 | AppID、测试机 | 批次 4 前 |
| 5 | 小游戏后台"基础库最低版本"设置位置 | 正式账号 | 批次 4 前 |
