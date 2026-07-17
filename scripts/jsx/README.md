# JSX 脚本集

由 `electron/services/photoshop` 的 PhotoshopBridge 调用执行。两端(mac/win)共用。

## 参数传递约定
Bridge 在脚本顶部注入一个全局 `PS2CODE_PARAMS`(JSON 字符串)。各脚本用 `eval('(' + PS2CODE_PARAMS + ')')` 解析。所有脚本统一 `return` 一个 JSON 字符串:
```
{ "ok": true|false, "data": {...}, "log": ["行1","行2"], "error": "..." }
```

## 脚本列表
| 文件 | 作用 |
|---|---|
| `_common.jsxinc` | 公共函数:打开/复用文档、递归查找 layerSets、按 psId/名称定位(`PS2.locate`)、日志、JSON 序列化 |
| `rename-groups.jsx` | 按 `{from,to}` 规则递归重命名图层组,保存 |
| `mutate-layers.jsx` | 显示/隐藏/删除图层(任意类型:组与普通图层)。psId 优先精确定位,回退按名匹配所有同名图层 |
| `set-text.jsx` | 修改文字图层内容(目标须为文字图层)。psId 优先,回退按名定位第一个 |
| `merge-groups.jsx` | 把图层组合并(压平)为单个图层,不可逆。psId 优先,回退按名定位第一个 |
| `export-groups.jsx` | 导出匹配的图层组为 PNG(1x/2x/裁剪),移植自 backup/jsx/psd-group-exporter.jsx 的导出逻辑。重名组自动追加 `_01/_02` 后缀避免覆盖 |
| `export-selection.jsx` | 导出用户 Photoshop 选区范围内的目标图层为 PNG。先读取选区边界,新建等尺寸临时透明文档,复制目标图层到临时文档,再裁剪到选区边界后导出(1x/2x/裁剪)。需要 PS 中有激活的选区(矩形选框/套索等均支持) |

## 参数示例
- rename-groups:`{ "targetPath": "/a.psd", "rules": [{"from":"组 93","to":"组 193"}] }`
- export-groups:`{ "targetPath": "/a.psd", "pattern": "^导出", "names": [], "x1": false, "x2": true, "trim": true, "outputDir": "/tmp/xxx" }`
- export-selection:`{ "targetPath": "/a.psd", "targets": [{"psId":84,"name":"图标","exportName":"图标_84"}], "x1": true, "x2": false, "trim": true, "outputDir": "/tmp/xxx" }`
- mutate-layers:`{ "targetPath": "/a.psd", "ops": [{"action":"hide","name":"组 5"}, {"action":"show","psId":84}, {"action":"delete","name":"组 7"}] }`(psId 优先精确定位;仅给 name 时匹配所有同名图层)
- set-text:`{ "targetPath": "/a.psd", "edits": [{"psId":120,"text":"新文案"}, {"name":"标题","text":"Hello"}] }`
- merge-groups:`{ "targetPath": "/a.psd", "targets": [{"psId":84}, {"name":"组 5"}] }`

## 注意(源自实测)
- 中文路径用 `new File(path)` 打开,勿用 `POSIX file ... as alias`(报 -43)。
- ExtendScript 基于 ES3,无 `Array.prototype.map/forEach`、`JSON`、`String.trim`,需 polyfill(见 `_common.jsxinc`)。
- 同步长循环需在关键处不依赖 UI 重绘。
