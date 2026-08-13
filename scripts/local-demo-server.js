const http = require('http');

const demoApi = require('../api/demo');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4317);

function sendApiOnlyNotice(res) {
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: false,
    message: 'Twikoo 后端仅提供 /api/demo；登录、注册和用户中心只保留在博客前端。',
  }));
}

function profileRedirectHandle(pathname) {
  const backendUser = pathname.match(/^\/user\/([^/]+)\/?$/);
  if (backendUser) return decodeURIComponent(backendUser[1]).replace(/^@/, '').trim();
  const frontendNested = pathname.match(/^\/user-center\/([^/]+)\/?$/);
  if (frontendNested) return decodeURIComponent(frontendNested[1]).replace(/^@/, '').trim();
  return '';
}

function frontendOrigin(req) {
  const origin = process.env.DEMO_FRONTEND_ORIGIN || process.env.FRONTEND_ORIGIN || req.headers.origin || 'http://localhost:4000';
  return origin.replace(/\/$/, '');
}

function redirectToFrontend(req, res, path = '/user-center/', handle = '') {
  const target = new URL(path, frontendOrigin(req));
  if (handle) target.searchParams.set('user', handle);
  res.statusCode = 302;
  res.setHeader('location', target.toString());
  res.end();
}

function redirectToFrontendProfile(req, res, handle) {
  redirectToFrontend(req, res, '/user-center/', handle);
}

function isFrontendPagePath(pathname) {
  return pathname === '/user-center' ||
    pathname === '/user-center/' ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/oauth' ||
    pathname.startsWith('/oauth/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/notifications' ||
    pathname.startsWith('/notifications/');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

  const handle = profileRedirectHandle(url.pathname);
  if (handle) {
    redirectToFrontendProfile(req, res, handle);
    return;
  }

  if (isFrontendPagePath(url.pathname)) {
    redirectToFrontend(req, res);
    return;
  }

  if (url.pathname === '/') {
    sendApiOnlyNotice(res);
    return;
  }

  if (url.pathname === '/api/demo') {
    demoApi(req, res);
    return;
  }

  sendApiOnlyNotice(res);
});

server.listen(port, host, () => {
  console.log(`Twikoo demo API: http://${host}:${port}/api/demo`);
});
