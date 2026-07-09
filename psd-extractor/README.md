# psd-extractor

从 PSD 设计稿中按**图层组名字**提取图片的脚本。

- 支持所有**图层特效**：投影、外发光、内阴影、内发光、描边、渐变叠加、颜色叠加、图案叠加
- 自动处理**智能对象（Smart Object）**
- 内容自动裁剪到画布范围
- 支持 PNG / JPEG / WEBP
- 一个 Python 文件，零 CLI 依赖

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

# 1. 看看 PSD 里有哪些图层组
groups = list_groups("target/b时光赠礼-周边抽奖活动横板 1658x705.psd")
for g in groups:
    print(g["name"], g["size"])

# 2. 提取指定组（含智能对象 + 所有图层特效）
extract_group("target/b时光赠礼-周边抽奖活动横板 1658x705.psd", "主视觉", "output.png")
extract_group("target/b时光赠礼-周边抽奖活动横板 1658x705.psd",
              ["主视觉", "奖品区"], output_dir="./导出图片/")

# 3. 在内存中合成，自己处理
from psd_tools.api.layers import Group
psd = PSDImage.open("target/b时光赠礼-周边抽奖活动横板 1658x705.psd")
for layer in psd.descendants():
    if isinstance(layer, Group) and layer.name == "主视觉":
        img = composite_group(layer)          # PIL Image，含特效
        img.save("主视觉.png")
```

### 参数说明

**`extract_group(psd_path, group_names, ...)`**

| 参数 | 说明 |
|------|------|
| `psd_path` | PSD 文件路径 |
| `group_names` | 图层组名（str 或 list） |
| `output` | 输出文件路径（多个组时自动加序号） |
| `output_dir` | 输出目录（默认 output/） |
| `fmt` | `"PNG"` / `"JPEG"` / `"WEBP"` |
| `respect_visibility` | 是否跳过隐藏图层（默认 True） |
| `background_color` | JPEG 背景色，如 `(255,255,255)` |

## 支持的特效

| 特效 | 类型 | 状态 |
|------|------|------|
| 投影 | DropShadow | PIL 手动渲染 |
| 外发光 | OuterGlow | PIL 手动渲染 |
| 内阴影 | InnerShadow | PIL 手动渲染 |
| 内发光 | InnerGlow | PIL 手动渲染 |
| 颜色叠加 | ColorOverlay | psd-tools 原生 |
| 渐变叠加 | GradientOverlay | psd-tools 原生 |
| 图案叠加 | PatternOverlay | psd-tools 原生 |
| 描边 | Stroke | psd-tools 原生 |

## 工作原理

1. `PSDImage.open()` 读取 PSD
2. 遍历 `psd.descendants()` 找到匹配名字的 `Group`
3. **逐层合成**：每层通过 psd-tools 渲染，然后叠加投影/外发光等特效（使用 `PIL.ImageFilter.GaussianBlur` + `alpha_composite`）
4. 特效图层按 Photoshop 顺序堆叠：投影 → 外发光 → 内阴影 → 内发光 → 叠加类特效 → 描边
5. 裁剪到 PSD 画布范围，输出图片
