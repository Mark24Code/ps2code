"""
从 PSD 中按图层组名字提取图片。

用法:
    from extract_psd_group import extract_group, list_groups

    # 列出所有组
    for g in list_groups("设计.psd"):
        print(g["name"])

    # 提取指定组（自动处理智能对象）
    extract_group("设计.psd", "主视觉", "output.png")

    # 提取多个组
    extract_group("设计.psd", ["主视觉", "奖品区"], output_dir="./images/")
"""

from pathlib import Path

from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import Group, SmartObjectLayer


# ── 工具 ──────────────────────────────────────────────────────────────


def _bbox(layer):
    """返回 (x1, y1, x2, y2)，兼容 tuple 和 namedtuple 两种 bbox 格式。"""
    b = layer.bbox
    if hasattr(b, "x1"):
        return (int(b.x1), int(b.y1), int(b.x2), int(b.y2))
    return (int(b[0]), int(b[1]), int(b[2]), int(b[3]))


def _bbox_intersect(bbox, canvas_w, canvas_h):
    """裁剪 bbox 到画布范围内，返回裁剪后的 (x1, y1, x2, y2)。

    如果完全在画布外则返回 None。
    """
    x1, y1, x2, y2 = bbox
    ix1 = max(x1, 0)
    iy1 = max(y1, 0)
    ix2 = min(x2, canvas_w)
    iy2 = min(y2, canvas_h)
    if ix1 >= ix2 or iy1 >= iy2:
        return None
    return (ix1, iy1, ix2, iy2)


def _composite_smart_object(layer):
    """合成智能对象，失败时尝试 placed_layer。"""
    try:
        return layer.composite(force=True)
    except Exception:
        try:
            if hasattr(layer, "placed_layer") and layer.placed_layer is not None:
                print(f"  ⚠ 智能对象 '{layer.name}' 需要外部文件，跳过")
        except Exception:
            pass
        return None


def _manual_composite(group, respect_visibility=True):
    """逐层合成（当 group.composite() 失败时的降级路径）。"""
    bbox = _bbox(group)
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    if bw == 0 or bh == 0:
        return None

    canvas = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))

    for layer in group:
        if respect_visibility and not layer.visible:
            continue
        try:
            if isinstance(layer, Group):
                img = _manual_composite(layer, respect_visibility)
            elif isinstance(layer, SmartObjectLayer):
                img = _composite_smart_object(layer)
            else:
                img = layer.composite(force=True)

            if img is None:
                continue
            if img.mode != "RGBA":
                img = img.convert("RGBA")

            lb = _bbox(layer)
            ox, oy = lb[0] - bbox[0], lb[1] - bbox[1]
            canvas.paste(img, (ox, oy), img)
        except Exception as e:
            print(f"  ⚠ 跳过图层 '{layer.name}': {e}")
            continue

    return canvas


# ── 公开接口 ──────────────────────────────────────────────────────────


def list_groups(psd_path, include_hidden=False):
    """列出 PSD 中的所有图层组。

    返回 [{name, visible, bbox, layer_count}, ...]
    """
    psd = PSDImage.open(psd_path)
    groups = []
    for layer in psd.descendants():
        if isinstance(layer, Group) and (include_hidden or layer.visible):
            b = _bbox(layer)
            groups.append({
                "name": layer.name,
                "visible": layer.visible,
                "bbox": b,
                "size": (b[2] - b[0], b[3] - b[1]),
                "layer_count": len(list(layer.descendants())),
            })
    return groups


def composite_group(group, respect_visibility=True, background_color=None):
    """合成一个图层组，返回 PIL Image。

    自动处理智能对象；如果 group.composite() 抛出异常，
    自动降级到逐层合成。
    """
    if respect_visibility and not group.visible:
        print(f"  ⚠ 组 '{group.name}' 已隐藏，跳过")
        return None

    if not group:
        print(f"  ⚠ 组 '{group.name}' 为空")
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))

    try:
        image = group.composite(force=True)
    except Exception as e:
        print(f"  ⚠ 合成组 '{group.name}' 失败 ({e})，降级到逐层合成…")
        image = _manual_composite(group, respect_visibility)

    if image is None:
        return None
    if image.mode != "RGBA":
        image = image.convert("RGBA")
    if background_color:
        bg = Image.new("RGBA", image.size, tuple(background_color) + (255,))
        bg.paste(image, (0, 0), image)
        image = bg
    return image


def extract_group(psd_path, group_names, output=None, output_dir=None,
                  fmt="PNG", respect_visibility=True, background_color=None):
    """从 PSD 中提取指定图层组，保存为图片。

    参数
    ----------
    psd_path : str | Path
        PSD 文件路径。
    group_names : str | list[str]
        要提取的图层组名，可以是单个名字或名字列表。
    output : str | Path | None
        输出文件路径。当 group_names 为列表时，自动加序号后缀。
        不传则用组名作为文件名。
    output_dir : str | Path | None
        输出目录（当 output 未指定时生效）。默认 output/。
    fmt : str
        "PNG" / "JPEG" / "WEBP"。
    respect_visibility : bool
        是否跳过隐藏图层。
    background_color : tuple | None
        JPEG 的背景色，如 (255, 255, 255)。
    """
    if isinstance(group_names, str):
        group_names = [group_names]

    psd = PSDImage.open(psd_path)
    print(f"📂 打开 PSD: {psd_path}  ({psd.width}×{psd.height})")

    out_dir = Path(output_dir) if output_dir else Path.cwd() / "output"

    results = []
    for idx, name in enumerate(group_names):
        groups = [
            l for l in psd.descendants()
            if isinstance(l, Group) and l.name == name
        ]

        if not groups:
            print(f"  ⚠ 未找到图层组: '{name}'")
            continue

        for gi, group in enumerate(groups):
            print(f"  🎨 合成组 '{name}'…")
            image = composite_group(group, respect_visibility, background_color)
            if image is None:
                continue

            # 确定输出路径
            multi = len(groups) > 1
            if output and len(group_names) == 1 and not multi:
                out_path = Path(output)
            else:
                safe_name = "".join(
                    c for c in name if c.isalnum() or c in " _-."
                ).strip() or "group"
                suffix = f"_{gi}" if multi else ""
                if output and len(group_names) == 1:
                    stem = Path(output).stem
                    out_path = Path(output).parent / f"{stem}{suffix}.{fmt.lower()}"
                else:
                    out_path = out_dir / f"{safe_name}{suffix}.{fmt.lower()}"

            out_path.parent.mkdir(parents=True, exist_ok=True)

            if fmt.upper() in ("JPEG", "JPG"):
                bg = Image.new("RGB", image.size, background_color or (255, 255, 255))
                if image.mode == "RGBA":
                    bg.paste(image, (0, 0), image)
                else:
                    bg.paste(image, (0, 0))
                bg.save(out_path, format="JPEG", quality=95)
            else:
                image.save(out_path, format=fmt.upper())

            print(f"  ✅ 保存: {out_path}")
            results.append(out_path)

    return results


# ── 独立运行 ──────────────────────────────────────────────────────────


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("用法: python extract_psd_group.py <psd文件> <图层组名> [图层组名...]")
        print("示例: python extract_psd_group.py target/设计.psd 主视觉 奖品区")
        sys.exit(1)

    psd_path = sys.argv[1]
    names = sys.argv[2:]
    extract_group(psd_path, names)
