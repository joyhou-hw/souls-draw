import sys

import numpy as np
from PIL import Image

for p in sys.argv[1:]:
    im = Image.open(p)
    arr = np.asarray(im)
    if im.mode == "RGBA" and arr.ndim == 3 and arr.shape[2] == 4:
        a = arr[..., 3]
        transparent = float((a == 0).mean())
        semi = float(((a > 0) & (a < 255)).mean())
        opaque = float((a == 255).mean())
        print(f"{p}: RGBA transparent={transparent:.3f} semi={semi:.3f} opaque={opaque:.3f}")
    else:
        print(f"{p}: mode={im.mode} shape={arr.shape}")