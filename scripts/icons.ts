// Renders the Tandem logo (the two overlapping circles from the top-left of the app) into
// favicon / PWA icons. No image tools needed: circles are rasterised here with 4×4 supersampling
// and encoded as PNG with node:zlib. Run: bun scripts/icons.ts
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

type RGBA = [number, number, number, number];
const LIME: RGBA = [0xc6, 0xf4, 0x32, 1];
const VIOLET: RGBA = [0xa9, 0x9b, 0xff, 0.85];
const INK: RGBA = [0x0e, 0x0f, 0x13, 1];

/** Logo geometry in its own 34×22 coordinate space. */
const CIRCLES = [
  { cx: 11, cy: 11, r: 10, color: LIME },
  { cx: 23, cy: 11, r: 10, color: VIOLET },
];

/** Source-over compositing of straight-alpha colours. */
function over(dst: RGBA, src: RGBA, coverage: number): RGBA {
  const a = src[3] * coverage;
  const outA = a + dst[3] * (1 - a);
  if (outA === 0) return [0, 0, 0, 0];
  const ch = (i: 0 | 1 | 2) => (src[i] * a + dst[i] * dst[3] * (1 - a)) / outA;
  return [ch(0), ch(1), ch(2), outA];
}

/**
 * Draw the logo on a `size`×`size` canvas.
 * @param logoWidth fraction of the canvas width the 34-unit-wide logo occupies
 * @param bg background colour, or null for transparent
 * @param radius corner radius of the background as a fraction of size (0 = square)
 */
function render(size: number, logoWidth: number, bg: RGBA | null, radius = 0): Uint8Array {
  const S = 4; // supersamples per axis
  const scale = (size * logoWidth) / 34;
  const ox = (size - 34 * scale) / 2;
  const oy = (size - 22 * scale) / 2;
  const out = new Uint8Array(size * size * 4);
  const rr = radius * size;
  const insideBg = (x: number, y: number) => {
    if (!rr) return true;
    const cx = Math.min(Math.max(x, rr), size - rr);
    const cy = Math.min(Math.max(y, rr), size - rr);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr;
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc: RGBA = [0, 0, 0, 0];
      // Average the composited colour over the subsamples (premultiplied for correctness).
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = px + (sx + 0.5) / S;
          const y = py + (sy + 0.5) / S;
          acc = bg && insideBg(x, y) ? [...bg] : [0, 0, 0, 0];
          for (const c of CIRCLES) {
            const dx = (x - ox) / scale - c.cx;
            const dy = (y - oy) / scale - c.cy;
            if (dx * dx + dy * dy <= c.r * c.r) acc = over(acc, c.color, 1);
          }
          r += acc[0] * acc[3]; g += acc[1] * acc[3]; b += acc[2] * acc[3]; a += acc[3];
        }
      }
      const n = S * S;
      const i = (py * size + px) * 4;
      const alpha = a / n;
      out[i] = alpha ? Math.round(r / a) : 0;
      out[i + 1] = alpha ? Math.round(g / a) : 0;
      out[i + 2] = alpha ? Math.round(b / a) : 0;
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

function png(size: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(Bun.hash.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO container holding PNG-encoded images (supported by every current browser). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    header[e] = img.size >= 256 ? 0 : img.size;
    header[e + 1] = img.size >= 256 ? 0 : img.size;
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(img.data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

const dir = "public/icons";
mkdirSync(dir, { recursive: true });
const write = (name: string, data: Buffer | string) => {
  writeFileSync(`${dir}/${name}`, data);
  console.log(`  ${dir}/${name}`);
};

// Favicon: transparent, logo as wide as possible.
write(
  "icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -6 34 34"><circle cx="11" cy="11" r="10" fill="#C6F432"/><circle cx="23" cy="11" r="10" fill="#A99BFF" fill-opacity=".85"/></svg>\n`,
);
const fav = (s: number) => png(s, render(s, 0.98, null));
write("favicon.ico", ico([16, 32, 48].map((s) => ({ size: s, data: fav(s) }))));
// App icons: logo on the app's dark background.
write("icon-192.png", png(192, render(192, 0.7, INK)));
write("icon-512.png", png(512, render(512, 0.7, INK)));
// Maskable: logo kept inside the central 80% safe zone.
write("icon-maskable-512.png", png(512, render(512, 0.56, INK)));
// iOS home screen (iOS rounds the corners itself and ignores transparency).
write("apple-touch-icon.png", png(180, render(180, 0.7, INK)));
