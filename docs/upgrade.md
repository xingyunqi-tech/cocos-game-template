# 升级指南

## game-core

模板仓库每次发版打 tag `core-vX.Y.Z`，`extensions/game-core/CHANGELOG.md` 记录变更，`scripts/plugin-locks/game-core.json` 记录该版本的文件快照。

下游项目升级：

```bash
scripts/update-core.sh 1.1.0 --source <模板仓库地址或 file:// 本地路径>
# 或 GAME_CORE_SOURCE=<地址> scripts/update-core.sh 1.1.0
# Windows：node scripts/update-core.mjs 1.1.0 --source <地址>
```

| 参数 | 作用 |
| --- | --- |
| `--force` | 本地 game-core 与锁定快照不一致时仍然覆盖 |
| `--allow-downgrade` | 允许目标版本低于当前版本 |

脚本会：

1. 检查本地 game-core 是否被修改（与锁定快照比对），有修改则中止
2. 拉取 tag `core-v1.1.0`，确认其中 game-core 版本号一致
3. 先复制到临时目录再整体替换 `extensions/game-core/` 与 `scripts/plugin-locks/game-core.json`
4. 打印从当前版本到目标版本的 CHANGELOG
5. 执行 `npm run check:plugins`

脚本只替换插件目录与锁定文件。之后按 CHANGELOG 逐条手工合入：

- 「项目侧资源」：`config.json` 新字段、`assets/resources` 下的新资源等
- 「构建」：`scripts/`、`build-configs/`、`package.json` 的脚本与依赖（例如新增的 devDependencies）

0.x 版本的项目没有升级脚本，第一次升级前从模板仓库复制 `scripts/update-core.mjs`、`scripts/update-core.sh`、`scripts/check-plugins.mjs`、`scripts/lib/cocos.mjs` 到项目中，`package.json` 需有 `creator.version` 字段。

从模板复制来的 `tests/game-core/` 测试的是模板自身的 game-core 与示例数据（如 `demo_level` 表），升级后可能与项目不符。game-core 已在模板仓库测试，项目中可以删除该目录；保留时按目标版本从模板仓库同步。

合入后执行：

```bash
npm install
npm run verify
npm run build -- web --debug && npm run smoke:web
```

`check:plugins` 发现 game-core 与锁定快照不一致时失败，说明插件被本地修改过。版本号以 `-dev` 结尾（如 `1.0.1-dev`）时只提示差异，供模板仓库开发期间使用。

模板仓库发版步骤：

1. 把 `extensions/game-core/package.json`、`assets/index.ts` 的版本号从 `X.Y.Z-dev` 改为 `X.Y.Z`，CHANGELOG 小节标题写上日期
2. `node scripts/check-plugins.mjs --update game-core --source core-vX.Y.Z`
3. 提交后打 tag `core-vX.Y.Z`
4. 版本号改为下一个 `-dev` 版本再继续开发

## oops-plugin-framework

1. 用新 commit 的插件目录替换 `extensions/oops-plugin-framework/`
2. `node scripts/check-plugins.mjs --update oops-plugin-framework --source <仓库@commit>`
3. `git add extensions/oops-plugin-framework && git add -f extensions/oops-plugin-framework/temp`（插件自带的 `.gitignore` 会忽略上游已提交的 `temp/`）
4. 复核开发计划 §2.3 的能力核实表，`npm run typecheck` 与三端构建通过后提交

## Cocos Creator

1. 修改 `package.json` 的 `creator.version` 与 `@cocos/creator-types` 版本
2. `npm run gen:cc-env` 重新生成 `types/cc-env.d.ts`
3. 用新版本编辑器打开项目并保存一次，使 meta 升级
4. 三端构建与冒烟通过后提交
