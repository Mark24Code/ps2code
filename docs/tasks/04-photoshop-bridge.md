# Task 04 — PhotoshopBridge 跨平台 JSX 执行层

## 目标
统一封装「向本地 Photoshop 执行一段 JSX 并拿到返回」的能力,屏蔽 mac/win 差异。图层增删改/重命名/导出都经此层。

## 接口
```ts
// electron/services/photoshop/index.ts
interface PhotoshopBridge {
  detect(): Promise<{ app: string; version?: string } | null>; // 探测已装/在跑的 PS
  runJsx(jsxSource: string): Promise<string>;                   // 执行内联 JSX,返回脚本 return 值
  runJsxFile(path: string, args?: string[]): Promise<string>;
}
```

## 平台实现
### macOS
参考 `backup/rename_group.sh`:
- 探测:`osascript -e 'tell application "System Events" to get name of (first process whose name contains "Photoshop")'`,否则扫 `/Applications/Adobe Photoshop*`。
- 执行:JSX 写入临时文件,UTF-8 读入避免中文乱码:
  ```
  osascript -e 'tell application "<PS_APP>"
    activate
    do javascript (read POSIX file "<JSX_FILE>" as «class utf8»)
  end tell'
  ```
- 中文路径:JSX 内用 `new File(path)` 打开,避免 `POSIX file ... as alias` 的 -43 错误。

### Windows
- COM 自动化:通过 PowerShell 调用
  ```powershell
  $ps = New-Object -ComObject Photoshop.Application
  $ps.DoJavaScriptFile("<JSX_FILE>")   # 或 DoJavaScript($src)
  ```
- 路径来自设置里的 PS path 或注册表探测。返回值经 stdout 回传。

## JSX 脚本(集中于 scripts/jsx/,附文档)
- `open-or-reuse.jsxinc`:按 fullName 判断文件是否已打开,复用或 `app.open`。
- `rename-groups.jsx`:递归 `layerSets` 改名(逻辑同 backup rename_group.sh 内联段)。
- `mutate-layers.jsx`:增/删/改可见性等图层操作。
- `export-groups.jsx`:导出逻辑移植自 `backup/jsx/psd-group-exporter.jsx`(去掉 UI,参数化:正则/组列表、1x/2x、裁剪、输出目录),复制组→转智能对象→独立临时文档→trim→导出 PNG-24。

## 通信约定
- JSX 统一返回 JSON 字符串(`{ ok, data, log }`),Bridge 解析。日志行流式回传给对话界面。

## 验收
- mac 上执行 `rename-groups.jsx` 对 `design-drafts/a签到.psd` 改名成功并保存。
- 导出脚本产出 PNG 到指定目录,1x/2x/裁剪符合选项。

## 依赖
- 无 npm 依赖;依赖本地 Photoshop + 系统脚本(osascript / powershell)。
