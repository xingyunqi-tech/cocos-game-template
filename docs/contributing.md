# 贡献流程

## 分支

- `main`：只接受合并，始终可构建
- `feat/<批次或任务>`：每个任务一个分支，完成后合并到 `main`

## 提交前

```bash
npm run verify
npm run build -- web --debug && npm run smoke:web
```

改动 game-core 启动流程时，另外在删除 `assets/game/` 的副本上执行 `npm run smoke:web -- --skip-demo`。

改动涉及构建配置、资源或场景时，再执行 `npm run build` 确认三端构建通过。

## 评审

- 每个任务合并前做一次代码评审（同事或 AI 评审）
- 每个里程碑结束做一次整体评审
- 评审意见修复后再提交

## 插件

- `extensions/oops-plugin-framework` 禁止修改，`npm run check:plugins` 会校验
- 升级 oops：替换目录后执行 `node scripts/check-plugins.mjs --update oops-plugin-framework --source <仓库@commit>`，用 `git add extensions/oops-plugin-framework && git add -f extensions/oops-plugin-framework/temp` 提交（插件自带的 `.gitignore` 会忽略上游已提交的 `temp/`），并复核开发计划 §2.3
- `game-core` 发版按 [升级指南](upgrade.md) 的「模板仓库发版步骤」执行；两次发版之间 game-core 版本号保持 `X.Y.Z-dev`，否则 `check:plugins` 会因与锁定快照不一致而失败

## 编码约束

- Cocos 构建使用 Babel loose 模式，对 Set、Map 等非数组可迭代对象使用展开语法（`[...set]`）会得到错误结果；改用 `Array.from(set)`。单测环境发现不了这类问题，依赖 `npm run smoke:web` 覆盖
- 平台无关的逻辑写成不依赖 `cc` 的纯 TS 模块，便于 Vitest 覆盖

## game-core 结构

- 单例在 `wiring/services.ts`，功能装配按 `services → sidebar → ui / auth / remote → core.ts` 单向依赖，`wiring/` 下的模块不 import `core.ts`
- 启动步骤由 `core.ts` 按顺序调用注册函数，不在模块顶层注册
- 新增 `.ts` 文件后执行一次构建（或用编辑器打开项目）生成 `.meta`，与源码一起提交

## 注释与命名

- 注释只描述当前代码，不写变更历史
- 测试用例名只陈述行为

## 提交与推送

提交与推送由负责人确认后执行。
