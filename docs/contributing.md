# 贡献流程

## 分支

- `main`：只接受合并，始终可构建
- `feat/<批次或任务>`：每个任务一个分支，完成后合并到 `main`

## 提交前

```bash
npm run verify
npm run build -- web --debug && npm run smoke:web
```

改动涉及构建配置、资源或场景时，再执行 `npm run build` 确认三端构建通过。

## 评审

- 每个任务合并前做一次代码评审（同事或 AI 评审）
- 每个里程碑结束做一次整体评审
- 评审意见修复后再提交

## 插件

- `extensions/oops-plugin-framework` 禁止修改，`npm run check:plugins` 会校验
- 升级 oops：替换目录后执行 `node scripts/check-plugins.mjs --update oops-plugin-framework --source <仓库@commit>`，用 `git add extensions/oops-plugin-framework && git add -f extensions/oops-plugin-framework/temp` 提交（插件自带的 `.gitignore` 会忽略上游已提交的 `temp/`），并复核开发计划 §2.3
- `game-core` 发版：更新 `CHANGELOG.md` 与 `package.json` 版本，打 tag `core-vX.Y.Z`

## 注释与命名

- 注释只描述当前代码，不写变更历史
- 测试用例名只陈述行为

## 提交与推送

提交与推送由负责人确认后执行。
