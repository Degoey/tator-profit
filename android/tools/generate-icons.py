#!/usr/bin/env python3
"""Regenerate the Android launcher icons from the canonical PWA icons.

This is the Linux/CI twin of `generate-icons.ps1` and produces byte-for-byte the
same *rules*, not the same bytes: same densities, same sizes, same 62% mark on
the adaptive layer. Use whichever one runs on the machine at hand; never edit the
PNGs in `app/src/main/res/mipmap-*` by hand.

Source of truth is `public/icons`. The wrapper is the **admin** surface, so it
wears the admin artwork (`admin-512.png` / `admin-maskable-512.png`) — the same
files `/admin/manifest.webmanifest` points at, which keeps the launcher icon and
the browser-installed icon from drifting apart.

    python3 android/tools/generate-icons.py

Writes, per density bucket (mdpi … xxxhdpi):
    mipmap-<density>/ic_launcher.png             legacy icon, API < 26
    mipmap-<density>/ic_launcher_round.png       legacy round icon
    mipmap-<density>/ic_launcher_foreground.png  adaptive foreground, API 26+
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

AKAR = Path(__file__).resolve().parents[2]
SUMBER = AKAR / "public" / "icons"
RES = AKAR / "android" / "app" / "src" / "main" / "res"

# Density bucket -> legacy icon size in pixels (mdpi is 1x).
DENSITAS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

# An adaptive icon layer is 108dp, i.e. 2.25x the legacy icon size.
RASIO_LAPISAN = 2.25

# Share of the adaptive layer the mark occupies (safe zone is ~61%).
RASIO_MARK = 0.62

BERKAS_KOTAK = "admin-512.png"
BERKAS_MASKABLE = "admin-maskable-512.png"


def sisipkan_tengah(kanvas: int, logo: Image.Image, pangsa: float) -> Image.Image:
    """Transparent canvas with the mark centred at `pangsa` of the layer size."""
    ukuran = round(kanvas * pangsa)
    kecil = logo.resize((ukuran, ukuran), Image.LANCZOS)
    keluaran = Image.new("RGBA", (kanvas, kanvas), (0, 0, 0, 0))
    geser = (kanvas - ukuran) // 2
    keluaran.paste(kecil, (geser, geser), kecil)
    return keluaran


def main() -> int:
    kotak_berkas = SUMBER / BERKAS_KOTAK
    maskable_berkas = SUMBER / BERKAS_MASKABLE
    for calon in (kotak_berkas, maskable_berkas):
        if not calon.exists():
            print(f"Ikon sumber tidak ada: {calon}. Jalankan 'npm run icons' dulu.", file=sys.stderr)
            return 1

    kotak = Image.open(kotak_berkas).convert("RGBA")
    maskable = Image.open(maskable_berkas).convert("RGBA")

    for densitas, sisi in DENSITAS.items():
        folder = RES / f"mipmap-{densitas}"
        folder.mkdir(parents=True, exist_ok=True)

        kotak.resize((sisi, sisi), Image.LANCZOS).save(folder / "ic_launcher.png")
        # The maskable artwork is full bleed, which is exactly what a round mask wants.
        maskable.resize((sisi, sisi), Image.LANCZOS).save(folder / "ic_launcher_round.png")

        lapisan = round(sisi * RASIO_LAPISAN)
        sisipkan_tengah(lapisan, kotak, RASIO_MARK).save(folder / "ic_launcher_foreground.png")

        print(f"+ mipmap-{densitas}/ic_launcher.png {sisi}x{sisi}")
        print(f"+ mipmap-{densitas}/ic_launcher_round.png {sisi}x{sisi}")
        print(f"+ mipmap-{densitas}/ic_launcher_foreground.png {lapisan}x{lapisan}")

    print(f"Ikon Android siap di {RES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
