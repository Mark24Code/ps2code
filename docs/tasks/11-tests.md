# Task 11–13 — 单元测试

围绕 SPEC 核心纯逻辑做单测,框架用 Vitest(贴合 Vite/TS 栈)。

## 运行
```bash
npm test          # 单次运行
npm run test:watch
```

## 覆盖范围(对应 SPEC 要求)
| 测试文件 | SPEC 关联 | 要点 |
|---|---|---|
| `tests/version.test.ts` | 检查更新(tag > 当前版本才提示) | semver 解析/比较、选最大 tag、位数不等补零 |
| `tests/naming.test.ts` | 导出重名不覆盖(_01/_02) | 批内重名编号、目标目录去重、`@2x` 序号插在倍率标记前 |
| `tests/psd-normalize.test.ts` | 读取图层结构 | 组/层区分、bounds/宽高、hidden、递归计数、稳定 id、无全局状态串扰 |
| `tests/db.test.ts` | 项目按路径去重、一项目多对话、默认 2x/裁剪、设置 | 内存 sqlite 注入(`setDatabaseForTest`) |

## 可测性重构
为让主进程逻辑脱离 Electron/文件系统可测,抽出纯函数模块:
- `shared/version.ts` — 版本比较(updater 复用)
- `shared/naming.ts` — 导出命名/去重(ipc 复用)
- `electron/services/psd/normalize.ts` — 图层树规范化(去掉原先的模块级全局计数器)
- `electron/services/db/schema.ts` + `setDatabaseForTest()` — 建表与注入

测试通过 `vitest.config.ts` 的 alias 把 `electron` 替换为 `tests/mocks/electron.ts` 轻量 stub。

## ⚠ 原生模块 ABI 注意
`better-sqlite3` 是原生模块,Electron 与 Node 的 ABI 不同:
- **跑测试(纯 Node)**:`npm rebuild better-sqlite3`
- **跑应用(Electron)**:`npm run rebuild`(electron-rebuild)

两者切换时需对应重建。CI 里建议测试步骤前执行 `npm rebuild better-sqlite3`。
