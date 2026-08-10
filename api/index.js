const fs = require('fs');
const path = require('path');

const demoUsersApi = require('./demo');
const twikooVercel = require('twikoo-vercel');

const FRONTEND_FILES = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['style.css', 'text/css; charset=utf-8'],
  ['app.js', 'application/javascript; charset=utf-8'],
]);

function getRequestPath(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url, `https://${host}`).pathname;
}

function getRequestUrl(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url, `https://${host}`);
}

function serveFrontendFile(req, res, pathname) {
  const url = getRequestUrl(req);
  const isOauth = pathname === '/oauth' || pathname.startsWith('/oauth/') || url.searchParams.get('comment_auth') === '1';
  const rootDir = isOauth ? 'oauth' : 'user-center';
  const isEntry =
    pathname === '/oauth' ||
    pathname === '/oauth/' ||
    pathname === '/user-center' ||
    pathname === '/user-center/' ||
    pathname === '/admin' ||
    pathname === '/admin/' ||
    pathname === '/user' ||
    pathname === '/user/' ||
    /^\/user\/[^/]+\/?$/.test(pathname);
  const requestedFile = isEntry
    ? 'index.html'
    : pathname.replace(/^\/(user-center|admin|oauth)\/?/, '');

  if (!FRONTEND_FILES.has(requestedFile)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  const filePath = path.join(process.cwd(), 'public', rootDir, requestedFile);
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

  if (
    pathname === '/user-center' ||
    pathname.startsWith('/user-center/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/oauth' ||
    pathname.startsWith('/oauth/') ||
    pathname === '/user' ||
    pathname.startsWith('/user/')
  ) {
    return serveFrontendFile(req, res, pathname);
  }

  return twikooVercel(req, res);
};
