# Task 08 — 导出选项与预览确认流程

## 目标
落地对话框下方的导出设置,以及"tmp 预览 → 确认 → 导出到目标路径"的闭环。

## 选项(对话框下方勾选,作为默认上下文每次传输)
- **裁剪**:导出时自动去掉四周透明边(JSX 的 `trim(TRANSPARENT)`)。
- **倍率**:1x / 2x,**默认勾选 2x**(export-groups.jsx 支持)。
- **导出路径**:默认与设计稿同目录,展示且可点击修改,修改后记住(写 conversations.export_dir 或 settings.default_export_dir)。

## 流程
1. Agent 或用户触发导出 → PhotoshopBridge 执行 `export-groups.jsx`,先导到**本对话 tmp 目录**。
2. 右侧预览区展示 tmp 产物(1x/2x 分组、命名 `组名.png` / `组名@2x.png`)。
3. 用户**确认** → 将 tmp 产物拷贝/移动到导出路径(去重命名逻辑沿用 backup 脚本:同名追加补零序号)。
4. 回显最终导出路径,可一键打开所在文件夹。

## 技术要点
- 导出脚本参数化:正则或明确组列表、x1/x2、trim、outputDir。
- 预览用 `file://` 或经 IPC 读 tmp 为 dataURL;注意 CSP 与本地文件访问。

## 验收
- 勾 2x + 裁剪 → tmp 出现 `@2x.png` 且已裁剪 → 确认后落到设计稿目录。
- 改导出路径后下次记住。

## 依赖
- Task 04(bridge/export jsx)、Task 07(对话/预览 UI)
