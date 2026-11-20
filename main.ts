// news-image-20261120: writes the day's one-page board to /output/entry.png.
//
// The board is authored as HTML in page/ and rasterised to assets/entry.png by tools/render.mjs,
// so this program's job is to put those exact bytes where the gate looks for them. It reads the
// asset, proves it is a whole PNG of the size the gate takes, and writes it once. Two runs of
// this program therefore write identical files, which is what the harness compares.
//
//   node main.ts                            # in the grader: writes /output/entry.png
//   MAKEFUN_OUTPUT_DIR=out node main.ts      # anywhere else: writes out/entry.png
//
// Node 22, standard library only. No network, no child processes.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SLUG = 'news-image-20261120';
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'assets', 'entry.png');
const MAX_BYTES = 1048576;
const MAX_SIDE = 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(reason) {
  console.error(`${SLUG}: ${reason}`);
  process.exit(1);
}

if (!existsSync(SOURCE)) {
  fail(`no image at ${SOURCE} - build it with "node tools/render.mjs"`);
}

const bytes = statSync(SOURCE).size;
if (bytes === 0 || bytes > MAX_BYTES) {
  fail(`${SOURCE} is ${bytes} bytes; the gate takes 1 to ${MAX_BYTES}`);
}

const image = readFileSync(SOURCE);
if (image.length < 57 || !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
  fail(`${SOURCE} is not a PNG`);
}
if (image.readUInt32BE(16) > MAX_SIDE || image.readUInt32BE(20) > MAX_SIDE) {
  fail(`${SOURCE} is ${image.readUInt32BE(16)}x${image.readUInt32BE(20)}; the gate takes at most ${MAX_SIDE} on a side`);
}
if (image.subarray(image.length - 8, image.length - 4).toString('latin1') !== 'IEND') {
  fail(`${SOURCE} does not end with an IEND chunk; the image is incomplete`);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const target = join(outDir, 'entry.png');
mkdirSync(outDir, { recursive: true });
writeFileSync(target, image);

console.log(`${SLUG}: wrote ${target} (${image.length} bytes) from assets/entry.png`);
