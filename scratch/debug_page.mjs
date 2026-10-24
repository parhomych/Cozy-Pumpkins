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

  if (urlPath === '/' || urlPath === '/test_witch_interaction.html') {
    filePath = path.join(process.cwd(), 'scratch/test_witch_interaction.html');
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

server.listen(8773, () => {
  console.log('Server running on 8773');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const args = [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--dump-dom',
    'http://localhost:8773/test_witch_interaction.html'
  ];

  setTimeout(() => {
    execFile(chromePath, args, { timeout: 10000 }, (err, stdout, stderr) => {
      server.close();
      if (err) console.error(err);
      console.log('STDOUT dump-dom length:', stdout?.length);
      fs.writeFileSync('scratch/dumped.html', stdout || '');
      console.log('Saved dumped.html');
    });
  }, 2200);
});
