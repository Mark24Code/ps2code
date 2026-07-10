# PS2Code 任务拆解

> 依据 `SPEC.md` 拆解。技术栈:Electron + React + Vite + TypeScript。
> 单机应用,无用户登录。跨平台 macOS / Windows。

## 目标

帮助用户管理本地 PSD 设计稿:拖入设计稿 → 读取图层结构 → 通过类 Agent 对话围绕图层做增删改查/重命名 → 调用本地 Photoshop 执行 JSX 导出图片。

## 已锁定的架构决策

| 决策点 | 选择 |
|---|---|
| 图层增删改/重命名/导出 | **统一走 Photoshop JSX**(保真度 100%) |
| PSD 元信息读取(图层树) | **ag-psd**(纯 JS,主进程解析) |
| Agent 职责 | **仅意图解析 → 本地工具调度**,工具实际执行 JSX/解析 |
| 检查更新 | **仅提示 + 打开 GitHub Release 页**(仓库地址先占位) |
| 本地存储 | **better-sqlite3**(projects / conversations / settings) |
| 第一版范围 | **完整功能一次建成** |

## 跨平台 Photoshop 桥接

backup 脚本基于 macOS `osascript` → `do javascript`。需抽象 `PhotoshopBridge`:
- **macOS**:`osascript -e 'tell application "Adobe Photoshop ..." to do javascript (read POSIX file "..." as «class utf8»)'`
- **Windows**:COM 自动化 `Photoshop.Application.DoJavaScriptFile(...)`,经 PowerShell/VBScript 驱动
- JSX 脚本两端共用,集中在 `scripts/jsx/` 维护并附文档

## 目录规划

```
ps2code/
├── electron/               # 主进程 + preload
│   ├── main.ts
│   ├── preload.ts
│   └── services/           # db / psd / photoshop / agent / updater
├── src/                    # React 渲染进程
│   ├── pages/              # Home / Project / Conversation / Settings
│   ├── components/
│   ├── store/
│   └── ipc/                # 渲染侧 IPC 封装
├── scripts/jsx/            # 共用 JSX(rename / export / mutate)+ 文档
├── shared/                 # 主/渲染共享的类型定义
├── docs/tasks/             # 本目录
└── design-drafts/          # 测试用真实 PSD
```

## 任务清单与依赖

执行顺序按依赖拓扑。详见各任务文档。

| # | 任务 | 依赖 |
|---|---|---|
| 01 | 项目骨架(Electron+React+Vite+TS) | — |
| 02 | SQLite 数据层与项目/对话管理 | 01 |
| 03 | PSD 解析(ag-psd 读图层树) | 01 |
| 04 | PhotoshopBridge 跨平台 JSX 执行层 | 01 |
| 05 | 集成 claude-agent-sdk(意图→工具调度) | 01, 04 |
| 06 | 主界面(+号/拖拽/去重/路由) | 02, 03 |
| 07 | 对话界面(左列表+中对话+右预览) | 05, 06 |
| 08 | 导出选项与预览确认流程 | 04, 07 |
| 09 | 设置界面(PS路径/API/关于/更新) | 02 |
| 10 | 端到端联调、跨平台构建与验证 | 08, 09 |

## 验证方式

用 `design-drafts/` 下真实 PSD 跑通:拖入 → 图层树展示 → 对话"把 组X 改名为 组Y" → 预览 → 确认导出。构建用 electron-builder 产出 mac/win 包。
