<#
.SYNOPSIS
    Regenerates the Android launcher icons from the canonical PWA icons.

.DESCRIPTION
    The PWA icons in `public/icons` are the single source of truth for the
    Tatorprofit mark (produced by `npm run icons`). This script resizes them into
    the Android density buckets so the APK ships no hand-drawn duplicate artwork:

      <surface>/res/mipmap-<density>/ic_launcher.png             legacy icon (API < 26)
      <surface>/res/mipmap-<density>/ic_launcher_round.png       legacy round icon
      <surface>/res/mipmap-<density>/ic_launcher_foreground.png  adaptive foreground (API 26+)

    One project ships three surfaces, and each one wears the artwork of the PWA
    manifest it wraps — the same files that manifest serves, which is what keeps
    the launcher icon from drifting away from the icon the browser installs:

      anggota  icon-512.png           + maskable-512.png
      admin    admin-512.png          + admin-maskable-512.png
      pemilik  owner-512.png          + owner-maskable-512.png

    The adaptive foreground is a transparent canvas with the mark centred at 62%
    of its size, which keeps it inside the 66dp safe zone of the 108dp layer.

    `generate-icons.py` is the Linux/CI twin of this script: same rules, so a
    build on a server reproduces the same icon set without PowerShell.

    Run from the repository root:
        powershell -ExecutionPolicy Bypass -File android/tools/generate-icons.ps1

.NOTES
    Uses System.Drawing from the Windows PowerShell host: no npm package and no
    native build dependency is involved.
#>
[CmdletBinding()]
param(
    [string] $SourceDirectory = (Join-Path $PSScriptRoot '..\..\public\icons'),
    [string] $ResDirectory = (Join-Path $PSScriptRoot '..\app\src')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

# Density bucket -> legacy icon size in pixels (mdpi is 1x).
$densities = [ordered]@{
    'mdpi'    = 48
    'hdpi'    = 72
    'xhdpi'   = 96
    'xxhdpi'  = 144
    'xxxhdpi' = 192
}

# An adaptive icon layer is 108dp, i.e. 2.25x the legacy icon size.
$adaptiveLayerRatio = 2.25

# Share of the adaptive layer the mark occupies (safe zone is ~61%).
$adaptiveMarkRatio = 0.62

function New-IconDirectory {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function New-ResizedPng {
    param(
        [Parameter(Mandatory)][string] $SourcePath,
        [Parameter(Mandatory)][int] $Size,
        [Parameter(Mandatory)][string] $DestinationPath
    )

    $source = [System.Drawing.Image]::FromFile($SourcePath)
    try {
        $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.DrawImage($source, 0, 0, $Size, $Size)
            } finally {
                $graphics.Dispose()
            }

            New-IconDirectory -Path (Split-Path -Parent $DestinationPath)
            $bitmap.Save($DestinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bitmap.Dispose()
        }
    } finally {
        $source.Dispose()
    }
}

function New-AdaptiveForegroundPng {
    param(
        [Parameter(Mandatory)][string] $SourcePath,
        [Parameter(Mandatory)][int] $LayerSize,
        [Parameter(Mandatory)][string] $DestinationPath
    )

    $markSize = [int][Math]::Round($LayerSize * $adaptiveMarkRatio)
    $offset = [int](($LayerSize - $markSize) / 2)

    $source = [System.Drawing.Image]::FromFile($SourcePath)
    try {
        $bitmap = New-Object System.Drawing.Bitmap $LayerSize, $LayerSize
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.DrawImage($source, $offset, $offset, $markSize, $markSize)
            } finally {
                $graphics.Dispose()
            }

            New-IconDirectory -Path (Split-Path -Parent $DestinationPath)
            $bitmap.Save($DestinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bitmap.Dispose()
        }
    } finally {
        $source.Dispose()
    }
}

# Surface -> its two source artworks in public/icons. Each surface wears the
# artwork of the PWA manifest it wraps, so the launcher icon cannot drift from the
# icon the browser installs.
$surfaces = [ordered]@{
    'anggota' = @{ Square = 'icon-512.png';  Maskable = 'maskable-512.png' }
    'admin'   = @{ Square = 'admin-512.png'; Maskable = 'admin-maskable-512.png' }
    'owner'   = @{ Square = 'owner-512.png'; Maskable = 'owner-maskable-512.png' }
}

foreach ($surface in $surfaces.Keys) {
    $squareSource = Join-Path $SourceDirectory $surfaces[$surface].Square
    $maskableSource = Join-Path $SourceDirectory $surfaces[$surface].Maskable

    foreach ($candidate in @($squareSource, $maskableSource)) {
        if (-not (Test-Path -LiteralPath $candidate)) {
            throw "Missing source icon '$candidate'. Run 'npm run icons' first."
        }
    }

    foreach ($density in $densities.Keys) {
        $size = $densities[$density]
        $folder = Join-Path $ResDirectory "$surface/res/mipmap-$density"

        New-ResizedPng -SourcePath $squareSource -Size $size `
            -DestinationPath (Join-Path $folder 'ic_launcher.png')

        # The maskable artwork is full bleed, which is exactly what a round mask wants.
        New-ResizedPng -SourcePath $maskableSource -Size $size `
            -DestinationPath (Join-Path $folder 'ic_launcher_round.png')

        $layerSize = [int][Math]::Round($size * $adaptiveLayerRatio)
        New-AdaptiveForegroundPng -SourcePath $squareSource -LayerSize $layerSize `
            -DestinationPath (Join-Path $folder 'ic_launcher_foreground.png')

        Write-Host "+ $surface/mipmap-$density/ic_launcher.png ${size}x${size}"
        Write-Host "+ $surface/mipmap-$density/ic_launcher_round.png ${size}x${size}"
        Write-Host "+ $surface/mipmap-$density/ic_launcher_foreground.png ${layerSize}x${layerSize}"
    }
}

Write-Host "Ikon Android siap di $ResDirectory/<permukaan>/res"
