import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="108" fill="#234d3c"/><circle cx="256" cy="238" r="140" fill="none" stroke="#cbb880" stroke-width="5"/><path d="M256 88v30M256 358v30M106 238h30M376 238h30" stroke="#cbb880" stroke-width="6"/><path d="m301 166-31 94-91 46 33-94z" fill="#f5f2e9"/><path d="m301 166-31 94-14-22z" fill="#bd9450"/><circle cx="256" cy="238" r="12" fill="#234d3c"/><path d="M172 377q42-10 84 14 42-24 84-14v32q-44-10-84 14-40-24-84-14z" fill="none" stroke="#f5f2e9" stroke-width="7" stroke-linejoin="round"/></svg>`;
await mkdir('public/icons', { recursive: true });
for (const [name, size] of [
  ['icon-192', 192],
  ['icon-512', 512],
  ['maskable-512', 512],
  ['apple-touch-icon', 180],
])
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(`public/icons/${name}.png`);
