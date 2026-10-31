"""Decode the QR matrices written by test-qr.mjs with OpenCV and compare with the source text."""
import json
import sys
import cv2
import numpy as np

cases = json.load(open("logs/qr-cases.json", encoding="utf-8"))
det = cv2.QRCodeDetector()
aruco = cv2.QRCodeDetectorAruco()  # a second, independent decoder: the first one cannot localise some valid codes
bad = 0
for c in cases:
    n = c["size"]
    scale, quiet = 8, 4
    img = np.full(((n + 2 * quiet) * scale,) * 2, 255, np.uint8)
    for y, row in enumerate(c["rows"]):
        for x, ch in enumerate(row):
            if ch == "1":
                img[(y + quiet) * scale:(y + quiet + 1) * scale, (x + quiet) * scale:(x + quiet + 1) * scale] = 0
    text, _, _ = det.detectAndDecode(img)
    if text != c["text"]:
        text, _, _ = aruco.detectAndDecode(img)
    ok = text == c["text"]
    bad += not ok
    print(("PASS" if ok else "FAIL"), f"v{c['version']} mask{c['mask']} {len(c['text'].encode())}B", "" if ok else repr(text[:40]))
sys.exit(1 if bad else 0)
