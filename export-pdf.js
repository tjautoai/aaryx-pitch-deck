const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const rootDir = __dirname;
const outDir = path.join('/home/leiat/AARYX/assets/pitch-deck');
const qaDir = path.join(outDir, 'qa');
const outPdf = path.join(outDir, 'AARYX_Trackt_Pitch_Deck_v3.pdf');
const port = 4176;
const viewport = { width: 1600, height: 900 };
const pageSize = { width: '13.333in', height: '7.5in' };

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.json': 'application/json; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  }[ext] || 'application/octet-stream';
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const relative = reqPath === '/' ? '/index.html' : reqPath;
      const filePath = path.join(rootDir, relative.replace(/^\//, ''));
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function buildPdfHtml(images) {
  const pages = images.map((src, idx) => `
    <section class="page">
      <img src="${src}" alt="Slide ${idx + 1}" />
    </section>
  `).join('');

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>
      @page {
        size: ${pageSize.width} ${pageSize.height};
        margin: 0;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background: #05070d;
      }
      body { font-size: 0; }
      .page {
        width: 100vw;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        page-break-after: always;
        break-after: page;
        overflow: hidden;
        background: #05070d;
      }
      .page:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    </style>
  </head>
  <body>${pages}</body>
  </html>`;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const deckPage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await deckPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });

    await deckPage.addStyleTag({ content: `
      html, body {
        width: ${viewport.width}px !important;
        min-width: ${viewport.width}px !important;
        background: #05070d !important;
        overflow: hidden !important;
      }
      .deck-topbar,
      .dotnav,
      .deck-actions {
        display: none !important;
      }
      .deck {
        height: ${viewport.height}px !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        scroll-snap-type: none !important;
        scroll-behavior: auto !important;
      }
      .slide {
        height: ${viewport.height}px !important;
        min-height: ${viewport.height}px !important;
        max-height: ${viewport.height}px !important;
        padding: 0 !important;
        overflow: hidden !important;
        content-visibility: visible !important;
        contain: none !important;
      }
      .slide::before {
        inset: 32px !important;
      }
      .slide-inner {
        min-height: auto !important;
        height: auto !important;
        margin: 32px auto !important;
        transform-origin: center center !important;
        will-change: transform !important;
      }
    `});

    const slideIds = await deckPage.evaluate(() => Array.from(document.querySelectorAll('.slide')).map(slide => slide.id));
    const imageDataUris = [];

    for (let i = 0; i < slideIds.length; i++) {
      const id = slideIds[i];
      await deckPage.evaluate(({ id, vh }) => {
        const deck = document.getElementById('deck');
        const slide = document.getElementById(id);
        const inner = slide ? slide.querySelector('.slide-inner') : null;
        if (!deck || !slide || !inner) return;

        inner.style.transform = 'scale(1)';

        const deckRect = deck.getBoundingClientRect();
        const slideTop = slide.offsetTop;
        deck.scrollTop = slideTop;

        const safeHeight = vh - 64;
        const safeWidth = Math.min(1220, window.innerWidth - 64);
        const innerRect = inner.getBoundingClientRect();
        const scale = Math.min(1, safeHeight / innerRect.height, safeWidth / innerRect.width);
        inner.style.transform = `scale(${scale})`;
      }, { id, vh: viewport.height });

      await deckPage.waitForTimeout(250);

      const deck = deckPage.locator('#deck');
      const pngBuffer = await deck.screenshot({
        animations: 'disabled',
        caret: 'hide',
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
        type: 'png'
      });

      const debugPath = path.join(qaDir, `pdf-slide-${String(i + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(debugPath, pngBuffer);
      imageDataUris.push(`data:image/png;base64,${pngBuffer.toString('base64')}`);
    }

    const pdfPage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await pdfPage.setContent(buildPdfHtml(imageDataUris), { waitUntil: 'load' });
    await pdfPage.emulateMedia({ media: 'print' });
    await pdfPage.pdf({
      path: outPdf,
      width: pageSize.width,
      height: pageSize.height,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    const bytes = fs.readFileSync(outPdf);
    const pageCount = (bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    console.log(JSON.stringify({ outPdf, qaDir, pageCount, size: bytes.length, sourceSlides: slideIds.length }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
