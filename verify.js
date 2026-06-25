const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

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

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const relative = reqPath === '/' ? '/index.html' : reqPath;
      const filePath = path.join(__dirname, relative.replace(/^\//, ''));
      if (!filePath.startsWith(__dirname)) {
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

(async () => {
  const port = 4173;
  const baseUrl = `http://127.0.0.1:${port}/index.html`;
  const outDir = path.join(__dirname, 'qa');
  fs.mkdirSync(outDir, { recursive: true });

  const server = await startServer(port);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

  const consoleMessages = [];
  const pageErrors = [];
  page.on('console', msg => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => pageErrors.push(err.message));

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const slidesToCapture = ['slide-1', 'slide-2', 'slide-4', 'slide-7', 'slide-8', 'slide-10', 'slide-12'];
    const captured = [];

    for (const id of slidesToCapture) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(450);
      const file = path.join(outDir, `${id}.png`);
      await page.screenshot({ path: file, fullPage: false });
      captured.push(file);
    }

    const summary = await page.evaluate(() => ({
      title: document.title,
      slides: Array.from(document.querySelectorAll('.slide')).map((slide) => ({
        id: slide.id,
        title: slide.dataset.title || null,
      })),
      ctaTargets: Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')),
    }));

    const expectedSlides = [
      'Cover',
      'The Problem',
      'The Cost',
      'The Solution',
      'How It Works',
      'What Trackt Detects',
      'The Accountability Mirror',
      'The Dashboard',
      "Who It's For",
      'Pricing',
      'Roadmap',
      'The Ask',
    ];

    const failures = [];
    if (summary.slides.length !== 12) {
      failures.push(`Expected 12 slides, found ${summary.slides.length}`);
    }

    const actualTitles = summary.slides.map((slide) => slide.title);
    for (const title of expectedSlides) {
      if (!actualTitles.includes(title)) {
        failures.push(`Missing slide title: ${title}`);
      }
    }

    if (pageErrors.length) {
      failures.push(`Page errors detected: ${pageErrors.join(' | ')}`);
    }

    const errorConsoleMessages = consoleMessages.filter((message) => /^(error|warning):/i.test(message));
    if (errorConsoleMessages.length) {
      failures.push(`Console issues detected: ${errorConsoleMessages.join(' | ')}`);
    }

    const result = {
      summary,
      pageErrors,
      consoleMessages,
      captured,
      failures,
      passed: failures.length === 0,
    };

    console.log(JSON.stringify(result, null, 2));

    if (failures.length) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
