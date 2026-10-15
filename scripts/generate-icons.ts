/**
 * Generates the installable-app (PWA) icon set as real PNG files.
 *
 * Run with: `npm run icons`
 *
 * The artwork is the Tatorprofit mark: a rounded square with the dark "T" glyph,
 * kept in sync with the palette in `src/app/globals.css` — neon for the member and
 * admin app, gold for the owner console. Everything is
 * rendered at 4x and box-filtered down, so the edges stay smooth without any
 * image library or binary asset checked into the repository.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

type Rgb = [number, number, number];

/** Brand palette, mirrored from `src/app/globals.css`. */
const NEON_LIGHT: Rgb = [0x2b, 0xff, 0x9c];
const NEON_DARK: Rgb = [0x17, 0xc4, 0x76];
const INK: Rgb = [0x04, 0x07, 0x0a];
/** Gold palette for the owner console: the installed owner app must be
 * distinguishable from the member/admin app on a home screen.
 */
const GOLD_LIGHT: Rgb = [0xf6, 0xc4, 0x53];
const GOLD_DARK: Rgb = [0xc9, 0x9a, 0x2e];

const NEON: Palette = { light: NEON_LIGHT, dark: NEON_DARK };
const GOLD: Palette = { light: GOLD_LIGHT, dark: GOLD_DARK };

const OUTPUT_DIR = join(process.cwd(), "public", "icons");

/** Supersampling factor: render large, then average each block down. */
const SUPERSAMPLE = 4;

interface Palette {
  light: Rgb;
  dark: Rgb;
}

interface IconSpec {
  fileName: string;
  size: number;
  /** Corner radius as a fraction of the icon size (0 = full bleed square). */
  cornerRadius: number;
  /** Size of the "T" glyph as a fraction of the icon size. */
  glyphScale: number;
  /** Maskable icons must paint every pixel; rounded corners would be cropped. */
  fullBleed: boolean;
  /** Brand gradient behind the glyph. */
  palette: Palette;
}

const ICONS: IconSpec[] = [
  { fileName: "favicon-32.png", size: 32, cornerRadius: 0.24, glyphScale: 0.62, fullBleed: false, palette: NEON },
  { fileName: "icon-192.png", size: 192, cornerRadius: 0.22, glyphScale: 0.54, fullBleed: false, palette: NEON },
  { fileName: "icon-512.png", size: 512, cornerRadius: 0.22, glyphScale: 0.54, fullBleed: false, palette: NEON },
  // 42% of the canvas keeps the glyph inside the maskable safe zone.
  { fileName: "maskable-512.png", size: 512, cornerRadius: 0, glyphScale: 0.42, fullBleed: true, palette: NEON },
  { fileName: "apple-touch-icon.png", size: 180, cornerRadius: 0, glyphScale: 0.54, fullBleed: true, palette: NEON },
  // Owner console: same mark, gold, so the installed owner app is told apart
  // from the member/admin app at a glance on the home screen.
  { fileName: "owner-192.png", size: 192, cornerRadius: 0.22, glyphScale: 0.54, fullBleed: false, palette: GOLD },
  { fileName: "owner-512.png", size: 512, cornerRadius: 0.22, glyphScale: 0.54, fullBleed: false, palette: GOLD },
  { fileName: "owner-maskable-512.png", size: 512, cornerRadius: 0, glyphScale: 0.42, fullBleed: true, palette: GOLD },
  { fileName: "owner-apple-touch-icon.png", size: 180, cornerRadius: 0, glyphScale: 0.54, fullBleed: true, palette: GOLD },
];

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

/** Point-in-rounded-square test in normalised (0..1) coordinates. */
function insideRoundedSquare(u: number, v: number, radius: number): boolean {
  if (radius <= 0) return true;
  if (u >= radius && u <= 1 - radius) return true;
  if (v >= radius && v <= 1 - radius) return true;

  const cx = Math.min(Math.max(u, radius), 1 - radius);
  const cy = Math.min(Math.max(v, radius), 1 - radius);
  const dx = u - cx;
  const dy = v - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** The "T" mark, in normalised coordinates inside a square glyph box. */
function insideGlyph(u: number, v: number, scale: number): boolean {
  const left = 0.5 - scale / 2;
  const top = 0.5 - scale / 2;
  const x = (u - left) / scale;
  const y = (v - top) / scale;
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;

  const onBar = y >= 0.06 && y <= 0.26 && x >= 0.02 && x <= 0.98;
  const onStem = x >= 0.375 && x <= 0.625 && y >= 0.06 && y <= 0.94;
  return onBar || onStem;
}

function renderIcon(spec: IconSpec): Buffer {
  const { size, cornerRadius, glyphScale, fullBleed, palette } = spec;
  const hi = size * SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const u = (x * SUPERSAMPLE + sx + 0.5) / hi;
          const v = (y * SUPERSAMPLE + sy + 0.5) / hi;

          if (!fullBleed && !insideRoundedSquare(u, v, cornerRadius)) continue;

          covered += 1;
          const color = insideGlyph(u, v, glyphScale)
            ? INK
            : mix(palette.light, palette.dark, (u + v) / 2);
          r += color[0];
          g += color[1];
          b += color[2];
        }
      }

      if (covered === 0) continue;

      const index = (y * size + x) * 4;
      pixels[index] = Math.round(r / covered);
      pixels[index + 1] = Math.round(g / covered);
      pixels[index + 2] = Math.round(b / covered);
      pixels[index + 3] = Math.round((covered / samples) * 255);
    }
  }

  return encodePng(size, pixels);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  // The table always has 256 entries, so the lookup can never be undefined.
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const payload = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload), 0);

  return Buffer.concat([length, payload, crc]);
}

/** Minimal truecolour-with-alpha PNG encoder (8 bit, no interlace). */
function encodePng(size: number, rgba: Uint8Array): Buffer {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: None
    Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const spec of ICONS) {
    const bytes = renderIcon(spec);
    writeFileSync(join(OUTPUT_DIR, spec.fileName), bytes);
    console.log(`+ icons/${spec.fileName} (${spec.size}x${spec.size}, ${bytes.byteLength} byte)`);
  }

  console.log(`Ikon siap di ${OUTPUT_DIR}`);
}

main();
