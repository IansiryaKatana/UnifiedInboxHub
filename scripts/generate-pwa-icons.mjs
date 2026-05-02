/**
 * Generates PNG icons for PWA, favicon, and Apple touch (brand + mail glyph).
 * Run: node scripts/generate-pwa-icons.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0f172a"/>
  <rect x="96" y="160" width="320" height="220" rx="24" fill="#3b82f6" opacity="0.95"/>
  <path fill="#f8fafc" d="M96 192l160 120 160-120v-32H96v32zm0 40v148h320V232L256 328 96 232z"/>
</svg>`;

/** @type {Array<[string, number]>} */
const outputs = [
  ["pwa-192", 192],
  ["pwa-512", 512],
  ["favicon-16", 16],
  ["favicon-32", 32],
  ["apple-touch-icon", 180],
];

for (const [name, size] of outputs) {
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  writeFileSync(join(root, "public", `${name}.png`), buf);
}

const ogBuf = await sharp(Buffer.from(svg))
  .resize(1200, 630, { fit: "cover", position: "centre" })
  .png()
  .toBuffer();
writeFileSync(join(root, "public", "og-image.png"), ogBuf);

console.log(
  "Wrote public/pwa-*.png, favicon-*.png, apple-touch-icon.png, og-image.png",
);
