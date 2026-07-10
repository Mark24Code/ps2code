# Task 01 — 项目骨架(Electron + React + Vite + TypeScript)

## 目标
建立可启动的空窗口应用,主/渲染/preload 三层就位,跨平台构建配置到位。

## 交付物
- `package.json`:脚本 `dev` / `build` / `dist:mac` / `dist:win`
- Electron 主进程 `electron/main.ts`、`electron/preload.ts`
- React + Vite 渲染进程 `src/`,`index.html`
- TypeScript 配置(主进程与渲染进程分别 tsconfig)
- `electron-builder` 配置(mac dmg / win nsis)
- 共享类型目录 `shared/`

## 技术要点
- 构建工具用 `electron-vite`(集成主进程/preload/渲染三份构建),或 Vite + electron-builder 手工整合。优先 `electron-vite`。
- `contextIsolation: true`,`nodeIntegration: false`;通过 preload + `contextBridge` 暴露受限 IPC。
- 主进程 TS 用 esbuild/tsc 产出 CJS 或 ESM(与 electron 版本匹配)。
- 渲染进程 React 18 + Vite。

## 依赖(实际版本 install 后以 package.json 为准)
- electron, electron-vite, electron-builder
- react, react-dom, react-router-dom
- typescript, vite, @vitejs/plugin-react

## 验收
- `npm run dev` 弹出空窗口,渲染进程热更新可用。
- preload 暴露的 `window.api` 在渲染进程可访问(先放一个 `ping` 验证 IPC 通)。

## 注意
- 依赖下载若受限,使用代理:
  `export https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897 all_proxy=socks5://127.0.0.1:7897`
- 原生模块(better-sqlite3)需 `electron-rebuild` 或 electron-builder 自动重建,骨架阶段预留配置。
