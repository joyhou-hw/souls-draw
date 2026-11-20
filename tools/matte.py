import argparse
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def matte_white_to_alpha(img_rgb, bg_color, tol=24.0, feather=1.5):
    arr = img_rgb.astype(np.float32)
    dist = np.sqrt(((arr - bg_color) ** 2).sum(axis=2))
    bg_candidate = dist < tol

    labels, n = ndimage.label(bg_candidate)
    border_ids = set()
    border_ids.update(labels[0, :].tolist())
    border_ids.update(labels[-1, :].tolist())
    border_ids.update(labels[:, 0].tolist())
    border_ids.update(labels[:, -1].tolist())
    border_ids.discard(0)
    bg_mask = np.isin(labels, list(border_ids))

    d = ndimage.distance_transform_edt(~bg_mask)
    alpha = np.clip(d / feather, 0.0, 1.0)

    a3 = alpha[..., None]
    clean = (arr - (1.0 - a3) * bg_color) / np.maximum(a3, 1e-4)
    clean = np.clip(clean, 0, 255).astype(np.uint8)
    alpha_u8 = (alpha * 255.0 + 0.5).astype(np.uint8)
    rgba = np.dstack([clean, alpha_u8])
    return rgba


def border_median_color(img_rgb):
    h, w, _ = img_rgb.shape
    px = np.concatenate(
        [img_rgb[0, :, :], img_rgb[-1, :, :], img_rgb[:, 0, :], img_rgb[:, -1, :]],
        axis=0,
    )
    return np.median(px, axis=0).astype(np.float32)


def main():
    ap = argparse.ArgumentParser(description="Convert white-ish background to alpha.")
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--tol", type=float, default=24.0)
    ap.add_argument("--feather", type=float, default=1.5)
    args = ap.parse_args()

    im = Image.open(args.input).convert("RGB")
    arr = np.asarray(im)
    bg = border_median_color(arr)
    rgba = matte_white_to_alpha(arr, bg, tol=args.tol, feather=args.feather)
    out = Image.fromarray(rgba, mode="RGBA")
    out.save(args.output)

    alpha = rgba[..., 3]
    print(
        f"bg_color={tuple(round(float(v), 1) for v in bg)} "
        f"transparent_ratio={float((alpha == 0).mean()):.3f} "
        f"semi_ratio={float(((alpha > 0) & (alpha < 255)).mean()):.3f} "
        f"opaque_ratio={float((alpha == 255).mean()):.3f}"
    )


if __name__ == "__main__":
    sys.exit(main())
