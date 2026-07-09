# psd-extractor

从 PSD 设计稿中按**图层组名字**提取图片的脚本。

- 自动处理**智能对象（Smart Object）**
- 支持 PNG / JPEG / WEBP
- 没有第三方 CLI 依赖，一个 Python 文件搞定

## 环境

```bash
pip install psd-tools Pillow
```

## 用法

### 命令行

```bash
# 提取单个组
python extract_psd_group.py "target/b时光赠礼-周边抽奖活动横板 1658x705.psd" 主视觉

# 提取多个组
python extract_psd_group.py "target/b时光赠礼-周边抽奖活动横板 1658x705.psd" 主视觉 奖品区 背景
```

### Python 代码调用

```python
from extract_psd_group import list_groups, extract_group, composite_group
from psd_tools import PSDImage

# 1. 看看 PSD 里有哪些图层组
groups = list_groups("target/b时光赠礼-周边抽奖活动横板 1658x705.psd")
for g in groups:
    print(g["name"], g["size"])

# 2. 提取指定组（自动合成 + 智能对象渲染）
extract_group("target/b时光赠礼-周边抽奖活动横板 1658x705.psd", "主视觉", "output.png")
extract_group("target/b时光赠礼-周边抽奖活动横板 1658x705.psd",
              ["主视觉", "奖品区"], output_dir="./导出图片/")

# 3. 在内存中合成，自己处理
psd = PSDImage.open("target/b时光赠礼-周边抽奖活动横板 1658x705.psd")
for layer in psd.descendants():
    if isinstance(layer, Group) and layer.name == "主视觉":
        img = composite_group(layer)          # PIL Image，含智能对象
        img.save("主视觉.png")
```

### 参数说明

**`extract_group(psd_path, group_names, ...)`**

| 参数 | 说明 |
|------|------|
| `psd_path` | PSD 文件路径 |
| `group_names` | 图层组名（str 或 list） |
| `output` | 输出文件路径（多个组时自动加序号） |
| `output_dir` | 输出目录（默认当前目录） |
| `fmt` | `"PNG"` / `"JPEG"` / `"WEBP"` |
| `respect_visibility` | 是否跳过隐藏图层（默认 True） |
| `background_color` | JPEG 背景色，如 `(255,255,255)` |

## 工作原理

1. `PSDImage.open()` 读取 PSD
2. 遍历 `psd.descendants()` 找到匹配名字的 `Group`
3. `group.composite(force=True)` 合成组内所有可见层（像素、形状、文字、智能对象）
4. 如果合成抛出异常，自动降级到逐层合成
5. 输出图片



python extract_psd_group.py "../target/b时光赠礼-周边抽奖活动横板 1658x705.psd" "组 7849"