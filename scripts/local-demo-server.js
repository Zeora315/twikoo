const http = require('http');

const demoApi = require('../api/demo');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4317);

function sendApiOnlyNotice(res) {
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: false,
    message: 'Twikoo 后端仅提供 API；登录、注册和用户中心均在博客前端实现。',
  }));
}

// 前端页面路径（登录/用户中心/管理后台等）均由博客前端承载，后端不再提供页面
function isFrontendPagePath(pathname) {
  return pathname === '/user-center' ||
    pathname === '/user-center/' ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/notifications' ||
    pathname.startsWith('/notifications/') ||
    pathname === '/oauth' ||
    pathname.startsWith('/oauth/') ||
    pathname === '/user' ||
    pathname.startsWith('/user/');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

  if (url.pathname === '/') {
    sendApiOnlyNotice(res);
    return;
  }

  if (url.pathname === '/api/ai-comment') {
    req.url = '/api/demo?action=aiComment';
    demoApi(req, res);
    return;
  }

  if (url.pathname === '/api/demo') {
    demoApi(req, res);
    return;
  }

  if (isFrontendPagePath(url.pathname)) {
    sendApiOnlyNotice(res);
    return;
  }

  sendApiOnlyNotice(res);
});

server.listen(port, host, () => {
  console.log(`Twikoo demo API: http://${host}:${port}/api/demo`);
});
