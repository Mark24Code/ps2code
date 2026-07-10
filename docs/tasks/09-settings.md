# Task 09 — 设置界面(PS路径 / API配置 / 关于 / 检查更新)

## 目标
集中配置,写入 settings 表(Task 02)。

## 分区
### Photoshop
- 感知/配置 Photoshop path:自动探测(mac 扫 `/Applications/Adobe Photoshop*`;win 注册表/常见路径),允许手动选择。
- 展示探测到的版本;"测试连接"按钮跑一段无害 JSX 验证 Bridge 通(Task 04)。

### API(Agent)
- API 地址(`ANTHROPIC_BASE_URL`)
- API 密钥(`ANTHROPIC_API_KEY`,密码框,存储不回显)
- 模型(`model`)
- 均写 settings,供 Task 05 读取。

### 导出
- 默认导出路径(default_export_dir),供新对话初始化。

### About / 检查更新
- 展示当前版本(来自 package.json / app.getVersion())。
- **检查更新**:请求 GitHub `GET /repos/<owner>/<repo>/tags`(或 releases/latest),取最新 tag,与当前版本 semver 比较。
  - 最新 > 当前 → 提示有新版本,提供按钮 `shell.openExternal` 打开 Release 页。
  - 仓库 owner/repo 先用**占位常量**(`shared/config.ts` 中 `GITHUB_REPO = 'OWNER/REPO'`),后续填真实值。
  - 仅提示 + 打开页面,**不做自动下载安装**。
  - 网络失败/无网优雅降级提示。

## 视觉
- 黑白灰 + 商务蓝,无渐变;分区清晰。

## 验收
- 保存后 Agent 用新 API 配置生效。
- 检查更新对比逻辑正确(可用占位 tag 手动验证 semver 比较)。

## 依赖
- Task 02(settings 存储)
