# PSD 图层组重命名实现思路

## 需求
将 `a签到.psd` 设计稿中的图层组 **【组 93】** 改名为 **【组 193】**。

## 环境探测
1. **定位文件**：文件不在当前目录，通过 AppleScript 向正在运行的 Photoshop 查询当前文档路径：
   ```applescript
   tell application "Adobe Photoshop 2024" to get file path of current document
   ```
   得到实际路径 `/Users/bilibili/Workspace/ps2code/target/a签到.psd`。
2. **确认可用工具**：
   - Photoshop 2024 已运行（可直接通过 AppleScript + ExtendScript 操作）
   - `psd-tools 1.12.0`（Python，备用离线方案）
   - ImageMagick（`convert` / `magick`）

## 技术选型
优先用 **Photoshop 实时操作** 而非离线解析 PSD，原因：
- 文件已在 PS 中打开，直接改动无需重新解析二进制、避免破坏原文件结构。
- AppleScript 的 `layer set` 查询**不会递归**进入嵌套组，所以改用 `do javascript`（ExtendScript）执行，能可靠遍历整棵图层树。

## 实现步骤

### 1. 递归查找目标组
用 ExtendScript 递归遍历 `layerSets`，列出所有匹配 “组 93” 的路径，确认唯一性与所在层级：
```javascript
function walk(container, path){
  var out = [];
  for (var i=0; i<container.layerSets.length; i++){
    var g = container.layerSets[i];
    out.push(path + "/" + g.name);
    out = out.concat(walk(g, path + "/" + g.name));
  }
  return out;
}
```
结果：全文档共 66 个组，`组 93` 唯一，且位于顶层。

### 2. 执行重命名
定位顶层同名组并赋新名：
```javascript
var doc = app.activeDocument;
for (var i=0; i<doc.layerSets.length; i++){
  if (doc.layerSets[i].name == "组 93"){
    doc.layerSets[i].name = "组 193";
    break;
  }
}
```

## 注意事项
- 改动目前仅存在于**打开的 PS 文档内存中**，尚未写盘。需要持久化时再执行保存。
- 若目标组存在于嵌套层级或有多个同名组，应改为遍历 `walk()` 的结果精确匹配路径后再改名，避免误改。

## AppleScript 驱动 Photoshop 的两种方式

### 方式 A：AppleScript 原生操作
AppleScript 自身可直接操作文档对象：
```applescript
tell application "Adobe Photoshop 2024"
    tell current document
        set name of layer set "组 93" to "组 193"
    end tell
end tell
```
局限：`layer set "xxx"` **只在当前层级查找，不递归**，深层嵌套或需遍历整棵图层树时很别扭。

### 方式 B：AppleScript 调 ExtendScript（本次采用）
用 `do javascript` 把 JSX 传给 Photoshop 的 JS 引擎执行，可用完整 DOM API 与灵活的逻辑控制：
```applescript
tell application "Adobe Photoshop 2024"
    do javascript "app.activeDocument.layerSets[0].name = '组 193';"
end tell
```
补充能力：
- `do javascript` 后可跟 JSX 字符串，也可跟文件：`do javascript file "/path/script.jsx"`。
- 传参：`do javascript file "..." with arguments {"arg1", "arg2"}`。
- 命令行直跑：`osascript -e '...'`，或 `open -a "Adobe Photoshop 2024" script.jsx`。
- 首次运行可能弹**自动化授权**（允许终端/脚本控制 Photoshop），同意一次即可。

## 是否必须打开 Photoshop？

| | Photoshop + JSX | psd-tools 离线 |
|---|---|---|
| 需要装/开 PS | 是（`tell` 会自动启动 PS，但进程必须在跑；且依赖已打开的文档，否则脚本内需先 `open`） | 否 |
| 保真度 | 100%，PS 自己读写 | 高，但智能对象、部分图层样式、调整图层等复杂特性写回时有丢失风险 |
| 适合场景 | 就在 PS 里操作、要求绝对可靠 | 批处理、CI、服务器、无 PS 环境 |
| 速度 | 受 PS 启动/响应影响 | 快 |

### 离线方案（无需 Photoshop）
PSD 格式公开，可用 `psd-tools` 直接读写：
```python
from psd_tools import PSDImage
psd = PSDImage.open("a签到.psd")
for layer in psd.descendants():   # descendants() 会递归所有嵌套层
    if layer.name == "组 93":
        layer.name = "组 193"
psd.save("a签到.psd")
```

### 选型建议
- **改图层名等轻量元数据操作** → `psd-tools` 离线改即可，快且不依赖 PS。
- **涉及渲染、导出、智能对象/复杂图层样式** → 走 Photoshop（方式 B）更稳，保真度 100%。

## 封装脚本 `rename_group.sh`

将「传入设计稿 + 改名规则 → 调 PS 执行」封装成可复用的命令行脚本。

### 用法
```bash
./rename_group.sh <设计稿> "<旧组名>=<新组名>" ["<旧组名>=<新组名>" ...]
```

### 示例
```bash
./rename_group.sh a签到.psd "组 93=组 193"                  # 单条
./rename_group.sh a签到.psd "组 93=组 193" "组 5=组 105"     # 多条批量
./rename_group.sh /abs/path/x.psd "banner=顶部横幅"           # 绝对路径
```

### 设计要点
1. **参数解析**：第一个参数是设计稿，其余每个参数是一条 `旧组名=新组名` 规则，支持批量。
2. **路径解析**：设计稿支持绝对路径、相对当前目录、相对脚本所在目录三种查找方式。
3. **PS 版本自适应**：先查正在运行的 Photoshop 进程名，否则从 `/Applications/Adobe Photoshop*` 探测，不硬编码 “2024”。
4. **规则转 JSX**：把每条 `旧=新` 转成 `{from,to}` 对象数组注入 JSX；对引号/反斜杠做转义，规避注入与中文问题。
5. **打开策略**：遍历 `app.documents` 按 `fullName.fsName` 判断文件是否已打开——已开则复用，未开则 `new File()` + `app.open()`（规避中文路径 alias 报错 -43）。
6. **递归改名**：`renameIn()` 递归遍历所有层级的 `layerSets`，同名组全部改名并计数。
7. **结果回显**：每条规则输出 `OK/SKIP` 与改动数量，最后 `doc.save()` 写回并输出 `SAVED`。
8. **临时文件**：JSX 写入 `mktemp` 临时文件，以 UTF-8 读入执行，`trap` 退出时清理。

### 关键踩坑（本次实测）
- **文档可能已被关闭**：不能假设 `current document` 存在，`count documents` 为 0 时需先 `open`。
- **中文路径 alias 失败**：`POSIX file "...中文..." as alias` 会报 `-43 找不到文件`；改在 ExtendScript 内用 `new File(path)` 打开可靠。
- **JSX 用 UTF-8 读入**：`do javascript (read POSIX file "..." as «class utf8»)`，否则中文组名乱码。
