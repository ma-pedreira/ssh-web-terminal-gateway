#!/usr/bin/env python3
"""Generates the icons for the installable application.

No dependencies: the PNG is written by hand with zlib, so the project can be
regenerated on any machine without installing image tooling.

Usage:  python3 scripts/generate-icons.py
"""

import struct
import zlib
from pathlib import Path

BACKGROUND = (0x04, 0x06, 0x0A)
CYAN = (0x22, 0xD3, 0xEE)
TARGET = Path(__file__).resolve().parent.parent / "public"

# The terminal prompt glyph: a chevron and an underscore.
CHEVRON = [((0.28, 0.30), (0.50, 0.50)), ((0.50, 0.50), (0.28, 0.70))]
UNDERSCORE = [((0.56, 0.70), (0.76, 0.70))]
STROKE = 0.075


def distance_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    if length == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def draw(size, scale=1.0, corner_radius=0.0):
    """Returns the RGBA pixels of the icon."""
    centre = 0.5
    segments = [
        (
            (centre + (a[0] - centre) * scale, centre + (a[1] - centre) * scale),
            (centre + (b[0] - centre) * scale, centre + (b[1] - centre) * scale),
        )
        for a, b in CHEVRON + UNDERSCORE
    ]
    stroke = STROKE * scale / 2

    rows = []
    for y in range(size):
        row = bytearray()
        py = (y + 0.5) / size
        for x in range(size):
            px = (x + 0.5) / size

            if corner_radius > 0:
                # Rounded corners: transparent outside the rounded rectangle.
                qx = abs(px - 0.5) - (0.5 - corner_radius)
                qy = abs(py - 0.5) - (0.5 - corner_radius)
                if qx > 0 and qy > 0 and (qx * qx + qy * qy) ** 0.5 > corner_radius:
                    row += bytes((0, 0, 0, 0))
                    continue

            nearest = min(
                distance_to_segment(px, py, a[0], a[1], b[0], b[1]) for a, b in segments
            )
            # One-pixel antialiased edge.
            edge = 1.0 / size
            if nearest <= stroke - edge:
                color = CYAN
            elif nearest <= stroke + edge:
                blend = (stroke + edge - nearest) / (2 * edge)
                color = tuple(
                    round(BACKGROUND[i] + (CYAN[i] - BACKGROUND[i]) * blend) for i in range(3)
                )
            else:
                color = BACKGROUND

            row += bytes((color[0], color[1], color[2], 255))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    body = zlib.compress(b"".join(b"\x00" + r for r in rows), 9)

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", body)
        + chunk(b"IEND", b"")
    )
    return path.stat().st_size


TARGET.mkdir(parents=True, exist_ok=True)

for name, size, scale, radius in [
    ("icon-192.png", 192, 1.0, 0.22),
    ("icon-512.png", 512, 1.0, 0.22),
    # Maskable: full bleed with the content inside the safe zone, because
    # Android crops the icon to the system shape.
    ("icon-maskable-512.png", 512, 0.72, 0.0),
    # iOS applies its own mask and does not support transparency.
    ("apple-touch-icon.png", 180, 1.0, 0.0),
]:
    path = TARGET / name
    written = write_png(path, size, draw(size, scale, radius))
    print(f"  {name:26} {size}x{size}  {written:6} bytes")
