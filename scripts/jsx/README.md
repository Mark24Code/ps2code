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
| `_common.jsxinc` | 公共函数:打开/复用文档、递归查找 layerSets、日志、JSON 序列化 |
| `rename-groups.jsx` | 按 `{from,to}` 规则递归重命名图层组,保存 |
| `mutate-layers.jsx` | 增删改图层可见性等(按名称/路径匹配) |
| `export-groups.jsx` | 导出匹配的图层组为 PNG(1x/2x/裁剪),移植自 backup/jsx/psd-group-exporter.jsx 的导出逻辑 |

## 参数示例
- rename-groups:`{ "targetPath": "/a.psd", "rules": [{"from":"组 93","to":"组 193"}] }`
- export-groups:`{ "targetPath": "/a.psd", "pattern": "^导出", "names": [], "x1": false, "x2": true, "trim": true, "outputDir": "/tmp/xxx" }`
- mutate-layers:`{ "targetPath": "/a.psd", "ops": [{"action":"hide","name":"组 5"}, {"action":"show","name":"组 6"}, {"action":"delete","name":"组 7"}] }`

## 注意(源自实测)
- 中文路径用 `new File(path)` 打开,勿用 `POSIX file ... as alias`(报 -43)。
- ExtendScript 基于 ES3,无 `Array.prototype.map/forEach`、`JSON`、`String.trim`,需 polyfill(见 `_common.jsxinc`)。
- 同步长循环需在关键处不依赖 UI 重绘。
