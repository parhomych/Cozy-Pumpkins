import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  let filePath;

  if (urlPath === '/' || urlPath === '/test_witch_rig.html') {
    filePath = path.join(process.cwd(), 'scratch/test_witch_rig.html');
  } else if (urlPath.startsWith('/assets/')) {
    filePath = path.join(process.cwd(), 'public', urlPath);
  } else if (urlPath.startsWith('/vendor/')) {
    filePath = path.join(process.cwd(), 'public', urlPath);
  } else if (urlPath.startsWith('/public/')) {
    filePath = path.join(process.cwd(), urlPath);
  } else {
    filePath = path.join(process.cwd(), urlPath);
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + req.url);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(8770, () => {
  console.log('Rig server running on http://localhost:8770');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const screenshotPath = path.resolve('scratch/witch_poses.png');

  const args = [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--disable-background-networking',
    `--screenshot=${screenshotPath}`,
    '--window-size=1300,550',
    'http://localhost:8770/test_witch_rig.html'
  ];

  setTimeout(() => {
    execFile(chromePath, args, { timeout: 10000 }, (err) => {
      server.close();
      if (err) {
        console.error('Chrome error:', err);
      } else {
        console.log('Saved witch_poses.png, size:', fs.statSync(screenshotPath).size);
      }
    });
  }, 1000);
});
