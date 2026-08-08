const fs = require('fs');
const path = require('path');

const demoUsersApi = require('./demo');
const twikooVercel = require('twikoo-vercel');

const FRONTEND_FILES = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['app.js', 'application/javascript; charset=utf-8'],
]);

function getRequestPath(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url, `https://${host}`).pathname;
}

function serveUserCenterFile(req, res, pathname) {
  const requestedFile = pathname === '/user-center' || pathname === '/user-center/' || pathname === '/admin' || pathname === '/admin/'
    ? 'index.html'
    : pathname.replace(/^\/(user-center|admin)\/?/, '');

  if (!FRONTEND_FILES.has(requestedFile)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  const filePath = path.join(process.cwd(), 'public', 'user-center', requestedFile);
  const content = fs.readFileSync(filePath);

  res.statusCode = 200;
  res.setHeader('content-type', FRONTEND_FILES.get(requestedFile));
  res.setHeader('cache-control', requestedFile === 'index.html' ? 'no-store' : 'public, max-age=300');
  res.end(content);
}

module.exports = async function twikooWithDemo(req, res) {
  const pathname = getRequestPath(req);

  if (pathname === '/api/demo') {
    return demoUsersApi(req, res);
  }

  if (pathname === '/user-center' || pathname.startsWith('/user-center/') || pathname === '/admin' || pathname.startsWith('/admin/')) {
    return serveUserCenterFile(req, res, pathname);
  }

  return twikooVercel(req, res);
};
