"""Generate the placeholder app icon (PNG sizes for the extension + a multi-size .ico).

Pure standard library (zlib/struct), no Pillow needed.
Usage: python scripts/make-icons.py
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SS = 4  # supersampling per axis


def rrect_cov(x, y, w, h, r):
    """1.0 inside rounded rect, else 0.0 (point sample, x/y in px)."""
    if x < 0 or y < 0 or x > w or y > h:
        return 0.0
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    return 1.0 if (x - cx) ** 2 + (y - cy) ** 2 <= r * r else 0.0


def render(size):
    top = (99, 102, 241)      # indigo
    bottom = (20, 184, 166)   # teal
    px = bytearray()
    for j in range(size):
        px.append(0)  # PNG filter type 0
        for i in range(size):
            acc_a = acc_r = acc_g = acc_b = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    x = i + (sx + 0.5) / SS
                    y = j + (sy + 0.5) / SS
                    u, v = x / size, y / size
                    base = rrect_cov(u, v, 1, 1, 0.22)
                    if base == 0.0:
                        continue
                    # gradient diagonal
                    t = min(max((u + v) / 2, 0), 1)
                    col = tuple(top[k] + (bottom[k] - top[k]) * t for k in range(3))
                    # white "sidebar" glyph: rail on the left, panel on the right
                    rail = rrect_cov(u - 0.20, v - 0.24, 0.14, 0.52, 0.04)
                    panel = rrect_cov(u - 0.42, v - 0.24, 0.38, 0.52, 0.06)
                    g = max(rail, panel)
                    col = tuple(col[k] * (1 - g) + 255 * g for k in range(3))
                    acc_a += 1
                    acc_r += col[0]
                    acc_g += col[1]
                    acc_b += col[2]
            n = SS * SS
            if acc_a == 0:
                px += bytes((0, 0, 0, 0))
            else:
                px += bytes((int(acc_r / acc_a), int(acc_g / acc_a), int(acc_b / acc_a), int(255 * acc_a / n)))
    return bytes(px)


def png(size):
    raw = render(size)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def main():
    pngs = {s: png(s) for s in (16, 32, 48, 128, 256)}
    for s in (16, 32, 48, 128):
        write(os.path.join(ROOT, "extensions", "sidebar", "icons", f"icon{s}.png"), pngs[s])
    write(os.path.join(ROOT, "assets", "icon.png"), pngs[256])

    sizes = (16, 32, 48, 256)
    header = struct.pack("<HHH", 0, 1, len(sizes))
    entries = b""
    blobs = b""
    offset = 6 + 16 * len(sizes)
    for s in sizes:
        data = pngs[s]
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset + len(blobs))
        blobs += data
    write(os.path.join(ROOT, "assets", "icon.ico"), header + entries + blobs)
    print("icons written")


if __name__ == "__main__":
    main()
