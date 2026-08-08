const fs = require('fs');
const http = require('http');
const path = require('path');

const demoApi = require('../api/demo');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4317);
const publicDir = path.join(__dirname, '..', 'public', 'user-center');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

function sendFile(res, fileName) {
  const filePath = path.join(publicDir, fileName);
  const ext = path.extname(fileName);

  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  res.statusCode = 200;
  res.setHeader('content-type', mimeTypes[ext] || 'application/octet-stream');
  res.end(fs.readFileSync(filePath));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

  if (url.pathname === '/') {
    res.statusCode = 302;
    res.setHeader('location', '/user-center');
    res.end();
    return;
  }

  if (url.pathname === '/api/demo') {
    demoApi(req, res);
    return;
  }

  if (url.pathname === '/user-center' || url.pathname === '/user-center/' || url.pathname === '/admin' || url.pathname === '/admin/') {
    sendFile(res, 'index.html');
    return;
  }

  if (url.pathname.startsWith('/user-center/') || url.pathname.startsWith('/admin/')) {
    sendFile(res, url.pathname.replace(/^\/(user-center|admin)\//, ''));
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

server.listen(port, host, () => {
  console.log(`Twikoo user center demo: http://${host}:${port}/user-center`);
});
