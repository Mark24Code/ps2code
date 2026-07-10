# Task 10 — 端到端联调、跨平台构建与验证

## 目标
串通全链路并产出可分发安装包。

## 端到端场景(用 design-drafts 真实 PSD)
1. 启动 → 拖入 `design-drafts/a签到.psd` → 建项目(去重生效)。
2. 进入项目 → 图层树正确展示(ag-psd)。
3. 新建对话 → 输入"把 组93 改名为 组193" → Agent 调 rename 工具 → PS 执行 → 日志回传。
4. 输入导出意图(勾 2x + 裁剪)→ tmp 预览出图 → 确认 → 落到设计稿目录。
5. 设置页:配置 PS 路径 + API + 检查更新提示。

## 构建
- `electron-builder`:mac(dmg,arm64+x64)/ win(nsis,x64)。
- 原生模块 better-sqlite3:electron-builder 自动 rebuild 或 `@electron/rebuild`。
- 图标、应用名、版本号(与检查更新对齐)。

## 验证清单
- 空环境冷启动无报错。
- 无 Photoshop 时:解析/浏览可用,导出/改名操作给出友好提示。
- 中文路径 PSD 正常。
- mac 与 win 分别验证 Bridge(win 需实测 COM 路径)。

## 依赖
- Task 08、Task 09(全部功能就位)
