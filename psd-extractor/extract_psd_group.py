"""
从 PSD 中按图层组名字提取图片。

支持图层特效：投影、外发光、内阴影、内发光、描边、渐变叠加、图案叠加、颜色叠加。

用法:
    from extract_psd_group import extract_group, list_groups

    # 列出所有组
    for g in list_groups("设计.psd"):
        print(g["name"])

    # 提取指定组（自动处理智能对象和所有图层特效）
    extract_group("设计.psd", "主视觉", "output.png")

    # 提取多个组
    extract_group("设计.psd", ["主视觉", "奖品区"], output_dir="./images/")
"""

import math
import logging
from pathlib import Path

# 抑制 psd-tools 内部告警（如 "not enough knots"）
logging.getLogger("psd_tools.composite.vector").setLevel(logging.ERROR)
logging.getLogger("psd_tools.composite").setLevel(logging.ERROR)

from PIL import Image, ImageFilter
from psd_tools import PSDImage
from psd_tools.api.layers import Group, SmartObjectLayer
from psd_tools.api.effects import DropShadow, OuterGlow, InnerShadow, InnerGlow


# ── 工具 ──────────────────────────────────────────────────────────────


def _bbox(layer):
    """返回 (x1, y1, x2, y2)，兼容 tuple 和 namedtuple。"""
    b = layer.bbox
    if hasattr(b, "x1"):
        return (int(b.x1), int(b.y1), int(b.x2), int(b.y2))
    return (int(b[0]), int(b[1]), int(b[2]), int(b[3]))


def _bbox_intersect(bbox, cw, ch):
    """裁剪 bbox 到画布范围内，返回 (x1,y1,x2,y2) 或 None。"""
    x1, y1, x2, y2 = bbox
    ix1 = max(x1, 0)
    iy1 = max(y1, 0)
    ix2 = min(x2, cw)
    iy2 = min(y2, ch)
    if ix1 >= ix2 or iy1 >= iy2:
        return None
    return (ix1, iy1, ix2, iy2)


def _effect_color_to_rgba(effect, default_alpha=255):
    """从 effect 中提取 (R, G, B, A)，兼容 float/int 颜色值。"""
    try:
        c = effect.color
        r = int(c[0] * 255) if isinstance(c[0], float) else int(c[0])
        g = int(c[1] * 255) if isinstance(c[1], float) else int(c[1])
        b = int(c[2] * 255) if isinstance(c[2], float) else int(c[2])
        a = int(c[3] * 255) if len(c) > 3 and isinstance(c[3], float) else default_alpha
        return (r, g, b, a)
    except Exception:
        return (0, 0, 0, default_alpha)


def _has_effect_type(layer, effect_cls):
    """检查图层是否有指定类型的特效。"""
    try:
        if not layer.has_effects():
            return False
        return any(isinstance(ef, effect_cls) and ef.enabled for ef in layer.effects)
    except Exception:
        return False


# ── 特效处理 ──────────────────────────────────────────────────────────


def _apply_drop_shadow(layer_img, effect):
    """投影：阴影偏移 + 模糊 + 着色，放在图层下方。"""
    opacity = effect.opacity / 100.0
    distance = getattr(effect, "distance", 5)
    angle = getattr(effect, "angle", 120)
    size = getattr(effect, "size", 5) or 1
    color = _effect_color_to_rgba(effect, int(255 * opacity))

    # Photoshop 角度: 0°=上, 90°=右 → PIL 坐标系 y 向下取反
    rad = math.radians(angle)
    dx = int(round(distance * math.sin(rad)))
    dy = -int(round(distance * math.cos(rad)))

    r, g, b, a = layer_img.split()
    blur_radius = size / 2.0

    # 扩展画布让阴影不裁剪
    pad = abs(dx) + int(blur_radius * 3) + 4
    pad = max(pad, abs(dy) + int(blur_radius * 3) + 4)
    w, h = layer_img.size
    pw, ph = w + pad * 2, h + pad * 2

    shadow_rgba = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    shadow_a = a.point(lambda p: int(p * opacity))
    if blur_radius > 0.3:
        shadow_a = shadow_a.filter(ImageFilter.GaussianBlur(blur_radius))
    # 着色
    shadow_colored = Image.merge("RGBA", (
        Image.new("L", a.size, color[0]),
        Image.new("L", a.size, color[1]),
        Image.new("L", a.size, color[2]),
        shadow_a,
    ))
    sx, sy = pad + dx, pad + dy
    shadow_rgba.paste(shadow_colored, (sx, sy), shadow_colored)
    # 在扩展画布上放原图
    shadow_rgba.paste(layer_img, (pad, pad), layer_img)
    return shadow_rgba, pad


def _apply_outer_glow(layer_img, effect):
    """外发光：模糊 + 着色，放在图层下方。"""
    opacity = effect.opacity / 100.0
    size = getattr(effect, "size", 5) or 1
    spread = getattr(effect, "spread", 0)
    color = _effect_color_to_rgba(effect, int(255 * opacity))

    r, g, b, a = layer_img.split()
    blur_radius = max(size / 2.0, 0.5)

    pad = int(blur_radius * 3) + 4
    w, h = layer_img.size
    pw, ph = w + pad * 2, h + pad * 2

    glow_rgba = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    glow_a = a.point(lambda p: int(p * opacity))
    if spread > 0:
        # spread 扩展发光范围（近似: 阈值降低）
        glow_a = glow_a.point(lambda p: min(255, int(p + (255 - p) * (spread / 100))))
    glow_a = glow_a.filter(ImageFilter.GaussianBlur(blur_radius))
    glow_colored = Image.merge("RGBA", (
        Image.new("L", a.size, color[0]),
        Image.new("L", a.size, color[1]),
        Image.new("L", a.size, color[2]),
        glow_a,
    ))
    glow_rgba.paste(glow_colored, (pad, pad), glow_colored)
    glow_rgba.paste(layer_img, (pad, pad), layer_img)
    return glow_rgba, pad


def _apply_inner_shadow(layer_img, effect):
    """内阴影：在图层内部偏移 + 模糊 + 着色。"""
    opacity = effect.opacity / 100.0
    distance = getattr(effect, "distance", 5)
    angle = getattr(effect, "angle", 120)
    size = getattr(effect, "size", 5) or 1
    choke = getattr(effect, "choke", 0)
    color = _effect_color_to_rgba(effect, int(255 * opacity))

    rad = math.radians(angle)
    dx = int(round(distance * math.sin(rad)))
    dy = -int(round(distance * math.cos(rad)))

    r, g, b, a = layer_img.split()
    blur_radius = size / 2.0

    # 从 alpha 中生成阴影区域，偏移并剪裁到 alpha 内
    shadow_a = a.point(lambda p: int(p * opacity))
    if blur_radius > 0.3:
        shadow_a = shadow_a.filter(ImageFilter.GaussianBlur(blur_radius))
    # 偏移阴影
    offset = Image.new("L", a.size, 0)
    offset.paste(shadow_a, (dx, dy))
    # 用原 alpha 剪裁（内阴影只在图层内部可见）
    inner = Image.new("L", a.size, 0)
    inner.paste(offset, (0, 0), a)

    # 合成到原图上
    result = layer_img.copy()
    overlay = Image.merge("RGBA", (
        Image.new("L", a.size, color[0]),
        Image.new("L", a.size, color[1]),
        Image.new("L", a.size, color[2]),
        inner,
    ))
    result = Image.alpha_composite(result, overlay)
    return result, 0


def _apply_inner_glow(layer_img, effect):
    """内发光：图层内部边缘发光。"""
    opacity = effect.opacity / 100.0
    size = getattr(effect, "size", 5) or 1
    color = _effect_color_to_rgba(effect, int(255 * opacity))

    r, g, b, a = layer_img.split()
    blur_radius = max(size / 2.0, 0.5)

    # 在 alpha 边缘用模糊模拟发光
    blurred = a.filter(ImageFilter.GaussianBlur(blur_radius))
    # 只保留 alpha 覆盖范围内的发光部分（内部发光）
    inner = Image.composite(blurred, Image.new("L", a.size, 0), a)

    result = layer_img.copy()
    overlay = Image.merge("RGBA", (
        Image.new("L", a.size, color[0]),
        Image.new("L", a.size, color[1]),
        Image.new("L", a.size, color[2]),
        inner.point(lambda p: int(p * opacity)),
    ))
    result = Image.alpha_composite(result, overlay)
    return result, 0


def _apply_layer_effects(layer, layer_img):
    """对一个图层的 PIL Image 应用所有特效，返回 (处理后的图片, padding)。

    padding 表示图片比原始 bbox 扩展了多少像素（因为投影/发光会超出边界）。
    """
    effects = []
    try:
        if layer.has_effects():
            effects = list(layer.effects)
    except Exception as e:
        print(f"  ⚠ 读取 '{layer.name}' 特效数据失败: {e}")

    if not effects:
        return layer_img, 0

    # 特效在 Photoshop 中的堆叠顺序（从下到上）：
    # 1. 投影 (DropShadow) — 在图层下方
    # 2. 外发光 (OuterGlow) — 在图层下方（投影上方）
    # 3. 内阴影 (InnerShadow) — 在图层上方
    # 4. 内发光 (InnerGlow) — 在图层上方
    # 5. 颜色/渐变/图案叠加 — 由 psd-tools composite 处理
    # 6. 描边 — 由 psd-tools composite 处理

    has_ds = any(isinstance(ef, DropShadow) and ef.enabled for ef in effects)
    has_og = any(isinstance(ef, OuterGlow) and ef.enabled for ef in effects)
    has_is = any(isinstance(ef, InnerShadow) and ef.enabled for ef in effects)
    has_ig = any(isinstance(ef, InnerGlow) and ef.enabled for ef in effects)

    # 找到具体的 effect 对象
    ds_ef = next((ef for ef in effects if isinstance(ef, DropShadow) and ef.enabled), None)
    og_ef = next((ef for ef in effects if isinstance(ef, OuterGlow) and ef.enabled), None)
    is_ef = next((ef for ef in effects if isinstance(ef, InnerShadow) and ef.enabled), None)
    ig_ef = next((ef for ef in effects if isinstance(ef, InnerGlow) and ef.enabled), None)

    # 先处理下方特效（需要扩展画布）
    pad = 0
    current = layer_img

    if has_ds:
        current, p = _apply_drop_shadow(current, ds_ef)
        pad = max(pad, p)
    if has_og:
        current, p = _apply_outer_glow(current, og_ef)
        pad = max(pad, p)
    if has_is:
        current, p = _apply_inner_shadow(current, is_ef)
        pad = max(pad, p)
    if has_ig:
        current, p = _apply_inner_glow(current, ig_ef)
        pad = max(pad, p)

    return current, pad


# ── 合成（含特效） ────────────────────────────────────────────────────


def _composite_layer_with_effects(layer, respect_visibility=True):
    """合成单个图层（含特效），返回 (PIL Image, padding, bbox)。

    padding 表示图像比原始 bbox 扩展的像素数。
    bbox 是扩展后的边界框 (x1, y1, x2, y2)。
    """
    if respect_visibility and not layer.visible:
        return None, 0, None

    try:
        # psd-tools 处理：像素、形状、文字、智能对象 + 叠加类特效/描边
        if isinstance(layer, Group):
            # 嵌套图层组递归合成（确保子图层特效也被处理）
            group_img, group_bbox = _composite_group_with_effects(
                layer, respect_visibility, canvas_size=None,
                return_bbox=True
            )
            if group_img is None:
                return None, 0, None
            img = group_img
            lb = group_bbox
        elif isinstance(layer, SmartObjectLayer):
            img = _composite_smart_object(layer)
            lb = _bbox(layer)
        else:
            img = layer.composite(force=True)
            lb = _bbox(layer)
    except Exception as e:
        print(f"  ⚠ 合成 '{layer.name}' 失败: {e}")
        return None, 0, None

    if img is None:
        return None, 0, None
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    if not isinstance(layer, Group):
        # 非 Group 图层：应用 psd-tools 未处理的特效（投影、外发光等）
        img, pad = _apply_layer_effects(layer, img)
        if pad > 0:
            bbox_ext = (lb[0] - pad, lb[1] - pad, lb[2] + pad, lb[3] + pad)
        else:
            bbox_ext = lb
    else:
        # Group 图层：递归已处理了子图层的特效
        # bbox_ext 由递归返回的 group_bbox 确定
        bbox_ext = lb

    return img, 0, bbox_ext


def _composite_smart_object(layer):
    """合成智能对象。"""
    try:
        return layer.composite(force=True)
    except Exception:
        try:
            if hasattr(layer, "placed_layer") and layer.placed_layer is not None:
                print(f"  ⚠ 智能对象 '{layer.name}' 需要外部文件，跳过")
        except Exception:
            pass
        return None


def _composite_group_with_effects(group, respect_visibility=True, canvas_size=None,
                                  return_bbox=False):
    """合成整个图层组（含所有特效），返回 PIL Image。

    这是主合成路径，替代 group.composite()。
    如果指定 canvas_size，结果会被裁剪到画布范围内。
    如果 return_bbox=True，返回 (image, bbox) 其中 bbox 是图像在文档中的 (x1,y1,x2,y2)。
    """
    if respect_visibility and not group.visible:
        return (None, None) if return_bbox else None

    if not group:
        return (None, None) if return_bbox else None

    # Step 1: 收集所有子图层及其扩展后的 bbox
    items = []  # [(img, pad, bbox_ext), ...]
    all_bboxes = []
    for layer in group:
        img, pad, bbox_ext = _composite_layer_with_effects(layer, respect_visibility)
        if img is None:
            continue
        items.append((img, pad, bbox_ext))
        all_bboxes.append(bbox_ext)

    if not items:
        return (None, None) if return_bbox else None

    # Step 2: 计算全局边界（所有图层的扩展 bbox 的并集）
    xs = [b[0] for b in all_bboxes] + [b[2] for b in all_bboxes]
    ys = [b[1] for b in all_bboxes] + [b[3] for b in all_bboxes]
    gx1, gy1, gx2, gy2 = min(xs), min(ys), max(xs), max(ys)

    # 如果有画布尺寸，先裁剪全局边界到画布内
    if canvas_size:
        clip = _bbox_intersect((gx1, gy1, gx2, gy2), canvas_size[0], canvas_size[1])
        if clip is None:
            return (None, None) if return_bbox else None
        gx1, gy1, gx2, gy2 = clip

    gw, gh = gx2 - gx1, gy2 - gy1
    if gw <= 0 or gh <= 0:
        return (None, None) if return_bbox else None

    # Step 3: 按顺序贴到全局画布上
    canvas = Image.new("RGBA", (gw, gh), (0, 0, 0, 0))
    for img, pad, bbox_ext in items:
        ox = bbox_ext[0] - gx1
        oy = bbox_ext[1] - gy1
        canvas.paste(img, (ox, oy), img)

    result_bbox = (gx1, gy1, gx2, gy2)
    if return_bbox:
        return canvas, result_bbox
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


def composite_group(group, respect_visibility=True, background_color=None,
                    canvas_size=None):
    """合成一个图层组，返回 PIL Image。

    支持所有图层特效：投影、外发光、内阴影、内发光、描边、叠加。
    """
    if respect_visibility and not group.visible:
        print(f"  ⚠ 组 '{group.name}' 已隐藏，跳过")
        return None

    if not group:
        print(f"  ⚠ 组 '{group.name}' 为空")
        return None

    # 使用我们的特效合成路径（替代 psd-tools 的 group.composite）
    # 内部已处理画布裁剪，确保特效不超出设计稿边界
    image = _composite_group_with_effects(
        group, respect_visibility, canvas_size, return_bbox=False
    )

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
            image = composite_group(group, respect_visibility, background_color,
                                     canvas_size=(psd.width, psd.height))
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
