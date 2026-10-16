#!/usr/bin/env python3
"""Regenerate the Android launcher icons from the canonical PWA icons.

This is the Linux/CI twin of `generate-icons.ps1` and applies the same *rules*,
not the same bytes: same densities, same sizes, same 62% mark on the adaptive
layer. Use whichever one runs on the machine at hand; never edit the PNGs under
`app/src/<surface>/res/mipmap-*` by hand.

Source of truth is `public/icons`, and each surface wears the artwork of the PWA
manifest it wraps, so the launcher icon can never drift from the icon the browser
installs:

    anggota  icon-512.png           + maskable-512.png
    admin    admin-512.png          + admin-maskable-512.png
    pemilik  owner-512.png          + owner-maskable-512.png

    python3 android/tools/generate-icons.py

Writes, per surface and density bucket (mdpi … xxxhdpi), into
`app/src/<surface>/res/`:
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
SRC = AKAR / "android" / "app" / "src"

# Density bucket -> legacy icon size in pixels (mdpi is 1x).
DENSITAS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

# An adaptive icon layer is 108dp, i.e. 2.25x the legacy icon size.
RASIO_LAPISAN = 2.25

# Share of the adaptive layer the mark occupies (safe zone is ~61%).
RASIO_MARK = 0.62

# Surface -> (square artwork, maskable artwork) inside public/icons.
PERMUKAAN = {
    "anggota": ("icon-512.png", "maskable-512.png"),
    "admin": ("admin-512.png", "admin-maskable-512.png"),
    "owner": ("owner-512.png", "owner-maskable-512.png"),
}


def sisipkan_tengah(kanvas: int, logo: Image.Image, pangsa: float) -> Image.Image:
    """Transparent canvas with the mark centred at `pangsa` of the layer size."""
    ukuran = round(kanvas * pangsa)
    kecil = logo.resize((ukuran, ukuran), Image.LANCZOS)
    keluaran = Image.new("RGBA", (kanvas, kanvas), (0, 0, 0, 0))
    geser = (kanvas - ukuran) // 2
    keluaran.paste(kecil, (geser, geser), kecil)
    return keluaran


def tulis_ikon(permukaan: str, kotak_berkas: Path, maskable_berkas: Path) -> None:
    res = SRC / permukaan / "res"
    kotak = Image.open(kotak_berkas).convert("RGBA")
    maskable = Image.open(maskable_berkas).convert("RGBA")

    for densitas, sisi in DENSITAS.items():
        folder = res / f"mipmap-{densitas}"
        folder.mkdir(parents=True, exist_ok=True)

        kotak.resize((sisi, sisi), Image.LANCZOS).save(folder / "ic_launcher.png")
        # The maskable artwork is full bleed, which is exactly what a round mask wants.
        maskable.resize((sisi, sisi), Image.LANCZOS).save(folder / "ic_launcher_round.png")

        lapisan = round(sisi * RASIO_LAPISAN)
        sisipkan_tengah(lapisan, kotak, RASIO_MARK).save(folder / "ic_launcher_foreground.png")

    print(f"+ {permukaan}: {len(DENSITAS)} densitas dari {kotak_berkas.name}")


def main() -> int:
    for permukaan, (kotak_nama, maskable_nama) in PERMUKAAN.items():
        kotak_berkas = SUMBER / kotak_nama
        maskable_berkas = SUMBER / maskable_nama
        for calon in (kotak_berkas, maskable_berkas):
            if not calon.exists():
                print(
                    f"Ikon sumber tidak ada: {calon}. Jalankan 'npm run icons' dulu.",
                    file=sys.stderr,
                )
                return 1
        tulis_ikon(permukaan, kotak_berkas, maskable_berkas)

    print(f"Ikon Android siap di {SRC}/<permukaan>/res")
    return 0


if __name__ == "__main__":
    sys.exit(main())
