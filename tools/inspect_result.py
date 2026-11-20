import base64
import json
import struct
import sys


def png_color_type(data: bytes):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return "not-png"
    # IHDR: len(4) 'IHDR'(4) width(4) height(4) bitdepth(1) colortype(1) ...
    if len(data) < 26 or data[12:16] != b"IHDR":
        return "unknown"
    width, height = struct.unpack(">II", data[16:24])
    bit_depth = data[24]
    color_type = data[25]
    names = {
        0: "grayscale",
        2: "rgb",
        3: "indexed",
        4: "gray+alpha",
        6: "rgba",
    }
    return f"{names.get(color_type, 'type' + str(color_type))} bitdepth={bit_depth} {width}x{height}"


def find_b64(node):
    if isinstance(node, dict):
        if "b64_json" in node and isinstance(node["b64_json"], str):
            return node["b64_json"]
        for v in node.values():
            hit = find_b64(v)
            if hit:
                return hit
    elif isinstance(node, list):
        for v in node:
            hit = find_b64(v)
            if hit:
                return hit
    return None


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        data = json.load(f)
    b64 = find_b64(data)
    if not b64:
        print("NO_B64_FOUND")
        sys.exit(1)
    png = base64.b64decode(b64)
    out = sys.argv[2]
    with open(out, "wb") as f:
        f.write(png)
    print(f"saved={out} bytes={len(png)} color={png_color_type(png)}")


if __name__ == "__main__":
    main()