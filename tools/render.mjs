// Rebuilds assets/entry.png from page/index.html with headless Chrome.
//
//   node tools/render.mjs                       -> assets/entry.png
//   RENDER_SCALE=0.5 node tools/render.mjs /tmp/try.png
//   PNG_OPT=64 node tools/render.mjs            -> also try a 64-colour copy, keep it if smaller
//
// The page is authored at 1600 x 1600 CSS px. The gate takes at most 1024 x 1024 px and 1 MiB, so
// the default device scale factor is 0.64: 1600 * 0.64 = 1024 device px, rasterised at that size
// instead of being resampled down from a larger render, which keeps the small type sharp.
//
// Two things this machine taught the renderer:
//   - Chrome 154 here traps (SIGTRAP, exit 133) in every mode, headless or windowed, when it runs
//     as root: it prints "DevTools listening" and then dies, even on about:blank. As an ordinary
//     user it renders normally. So when this script runs as root it runs Chrome as `nobody`.
//   - `nobody` cannot read a repository under /root, so the page is served over a loopback HTTP
//     server on 127.0.0.1 rather than opened as file://. Same bytes, same layout.
//
// The build fails, rather than writing a bad asset, when the page overflows, when two blocks of
// type collide or leave the trim, when the masthead's story count and the page's disagree, when
// the type hierarchy is flat, or when the PNG leaves the gate's limits or is not a whole PNG
// (every chunk walked and its CRC checked).

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'page', 'index.html');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'assets', 'entry.png'));
const SCALE = process.env.RENDER_SCALE ?? '0.64';
const OPT = process.env.PNG_OPT ?? '';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const PORT = Number(process.env.RENDER_PORT ?? 8791);
const SHOT = '/tmp/news-image-20-shot.png';
// A fresh profile per run: Chrome refuses to start when the directory belongs to another user,
// and a reused one keeps locks from a crashed run.
const PROFILE = process.env.CHROME_PROFILE ?? mkdtempSync(join(tmpdir(), 'news-image-chrome-'));
const CSS_W = 1600;
const CSS_H = 1600;
const MAX_BYTES = 1048576;
const MAX_PX = 1024;

const serve = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('no');
    return;
  }
  try {
    const body = readFileSync(file);
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' }[extname(file)] ?? 'text/plain';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', connection: 'close' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// Chrome is started as `nobody` when this script runs as root (see the note at the top).
const asUser = process.getuid?.() === 0 ? ['runuser', '-u', 'nobody', '--', 'env', '-u', 'TMPDIR'] : [];
if (asUser.length) {
  // The profile has to belong to the user Chrome runs as, or Chrome cannot write its own state.
  execFileSync('chown', ['-R', 'nobody', PROFILE], { stdio: 'ignore' });
}

const chromeArgs = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  // Without this the GPU process dies on this kernel ("GPU process isn't usable. Goodbye.") and
  // takes the browser with it; software rasterisation through SwiftShader-less GL is enough here.
  '--use-gl=disabled',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--user-data-dir=' + PROFILE,
  '--force-device-scale-factor=' + SCALE,
  `--window-size=${CSS_W},${CSS_H}`,
  '--virtual-time-budget=4000',
];

// Chrome's own children inherit its stdout, so a pipe never reaches EOF and a synchronous read
// waits for ever; stdout goes to a file instead. The call is asynchronous on purpose: the page is
// served by this same process, so blocking the event loop here would deadlock the render.
function chromeToFile(extra, file) {
  const fd = openSync(file, 'w');
  return new Promise((done, fail) => {
    const child = spawn(asUser[0] ?? CHROME, [...asUser.slice(1), CHROME, ...chromeArgs, ...extra], {
      stdio: ['ignore', fd, 'pipe'],
    });
    let noise = '';
    child.stderr.on('data', (chunk) => { noise += chunk; });
    child.on('error', fail);
    child.on('close', (code) => {
      closeSync(fd);
      if (code !== 0) {
        const tail = noise.split('\n').filter((line) => line && !/dbus|inotify|udev|pcilib/.test(line)).slice(-3).join(' | ');
        fail(new Error(`chrome exited ${code}${tail ? `: ${tail}` : ''}`));
        return;
      }
      done(readFileSync(file, 'utf8'));
    });
  });
}

const DOM_FILE = '/tmp/news-image-20-dom.html';

// ---------------------------------------------------------------- PNG integrity

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Walks every chunk: signature, lengths inside the file, CRCs that match, IHDR first, IDAT present,
// IEND last with no data and nothing after it.
function inspectPng(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 57 || !buf.subarray(0, 8).equals(sig)) throw new Error(`${OUT} does not begin with the PNG signature`);
  let at = 8;
  let width = 0;
  let height = 0;
  let sawIdat = false;
  let sawIend = false;
  let chunks = 0;
  while (at < buf.length) {
    if (at + 8 > buf.length) throw new Error(`truncated chunk header at ${at}`);
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    if (at + 12 + length > buf.length) throw new Error(`chunk ${type} runs past the end of the file`);
    const body = buf.subarray(at + 8, at + 8 + length);
    const want = buf.readUInt32BE(at + 8 + length);
    if (crc32(buf.subarray(at + 4, at + 8 + length)) !== want) throw new Error(`chunk ${type} has a bad CRC`);
    if (chunks === 0) {
      if (type !== 'IHDR' || length !== 13) throw new Error('the first chunk is not a 13-byte IHDR');
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') {
      if (length !== 0) throw new Error('IEND carries data');
      if (at + 12 !== buf.length) throw new Error('bytes follow IEND');
      sawIend = true;
    }
    chunks += 1;
    at += 12 + length;
  }
  if (!sawIend) throw new Error('no IEND chunk: the image is incomplete');
  if (!sawIdat) throw new Error('no IDAT chunk: the image has no pixels');
  return { width, height, chunks };
}

// ---------------------------------------------------------------- page checks

function checkPage(metrics, audit) {
  if (!metrics) throw new Error('the page reported no METRICS - did page/news.js throw?');
  if (!audit) throw new Error('the page reported no AUDIT');
  if (audit.count > 0) throw new Error(`the layout audit found ${audit.count} problems: ${audit.issues.join('; ')}`);
  if (audit.stated !== audit.shown) throw new Error(`the masthead says ${audit.stated} stories, the page lays out ${audit.shown}`);
  const { lead, second, cell } = audit.sizes;
  if (!(lead > second * 1.6 && second > cell)) {
    throw new Error(`the type hierarchy is flat: lead ${lead}px, second ${second}px, grid ${cell}px`);
  }
  if (metrics.overflow > 2) throw new Error(`the page overflows its ${CSS_H} px height by ${metrics.overflow} px`);
}

// ---------------------------------------------------------------- build

await new Promise((done, fail) => {
  serve.once('error', fail);
  serve.listen(PORT, '127.0.0.1', done);
});
const url = `http://127.0.0.1:${PORT}/page/index.html`;

try {
  const dom = await chromeToFile(['--dump-dom', url], DOM_FILE);
  const metrics = JSON.parse((dom.match(/METRICS:(\{[^<]*\})/) ?? [])[1] ?? 'null');
  const audit = JSON.parse((dom.match(/AUDIT:(\{[^<]*\})/) ?? [])[1] ?? 'null');
  checkPage(metrics, audit);

  await chromeToFile([`--screenshot=${SHOT}`, url], DOM_FILE);
  // As `nobody`, Chrome writes the file into /tmp; move those bytes into the repository.
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, readFileSync(SHOT));

  let buf = readFileSync(OUT);
  let bytes = buf.length;
  let size = inspectPng(buf);
  if (size.width !== MAX_PX || size.height !== MAX_PX) throw new Error(`the image is ${size.width}x${size.height}, not ${MAX_PX}x${MAX_PX}`);
  if (bytes > MAX_BYTES) throw new Error(`the image is ${bytes} bytes, the gate takes at most ${MAX_BYTES}`);

  if (OPT) {
    const alt = `${OUT}.opt.png`;
    execFileSync('convert', [OUT, '-colors', OPT, '-depth', '8', `png8:${alt}`]);
    const altBuf = readFileSync(alt);
    const altSize = inspectPng(altBuf);
    if (altSize.width !== size.width || altSize.height !== size.height) throw new Error('the quantised copy changed dimensions');
    if (altBuf.length < bytes) {
      writeFileSync(OUT, altBuf);
      buf = altBuf;
      bytes = altBuf.length;
      size = altSize;
    }
  }

  writeFileSync(join(ROOT, 'tools', 'render.log'), JSON.stringify({
    image: { width: size.width, height: size.height, bytes, chunks: size.chunks },
    scale: SCALE,
    chrome: asUser.length ? 'as nobody' : 'as the current user',
    opt: OPT || null,
    page: metrics,
    audit,
  }) + '\n');

  console.log(`RENDERED ${size.width}x${size.height} ${bytes} bytes in ${size.chunks} chunks -> ${OUT}`);
  console.log(`STORIES stated ${audit.stated} shown ${audit.shown} | type lead ${audit.sizes.lead}px second ${audit.sizes.second}px grid ${audit.sizes.cell}px`);
  console.log(`PAGE ${JSON.stringify(metrics.parts)} overflow ${metrics.overflow}`);
} finally {
  serve.closeAllConnections?.();
  serve.close();
  if (!process.env.CHROME_PROFILE) rmSync(PROFILE, { recursive: true, force: true });
}
