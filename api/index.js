const demoUsersApi = require('./demo');
const twikooVercel = require('twikoo-vercel');

function getRequestPath(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url, `https://${host}`).pathname;
}

function getRequestUrl(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url, `https://${host}`);
}

function frontendOrigin(req) {
  const configured = process.env.DEMO_FRONTEND_ORIGIN || process.env.FRONTEND_ORIGIN || process.env.BLOG_ORIGIN;
  if (configured) return configured.replace(/\/$/, '');

  const source = req.headers.origin || req.headers.referer || '';
  try {
    const origin = new URL(source).origin;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  } catch (error) {
    // Ignore malformed origin/referer headers and fall back to production.
  }
  return 'https://blog.zeora.top';
}

function frontendProfileUrl(req, handle) {
  const url = new URL('/user-center/', frontendOrigin(req));
  url.searchParams.set('user', handle);
  return url.toString();
}

function profileRedirectHandle(pathname) {
  const backendUser = pathname.match(/^\/user\/([^/]+)\/?$/);
  if (backendUser) return decodeURIComponent(backendUser[1]).replace(/^@/, '').trim();

  const frontendNested = pathname.match(/^\/user-center\/([^/]+)\/?$/);
  if (frontendNested) return decodeURIComponent(frontendNested[1]).replace(/^@/, '').trim();
  return '';
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.setHeader('cache-control', 'no-store');
  res.end();
}

function isFrontendPagePath(pathname) {
  return pathname === '/user-center' ||
    pathname.startsWith('/user-center/') ||
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

function sendApiOnlyNotice(res) {
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({
    ok: false,
    message: 'Twikoo 后端仅提供 API；登录、注册和用户中心已经移到博客前端弹窗。',
  }));
}

module.exports = async function twikooWithDemo(req, res) {
  const url = getRequestUrl(req);
  const pathname = url.pathname;

  if (pathname === '/api/demo' || pathname.startsWith('/api/demo/')) {
    return demoUsersApi(req, res);
  }

  const handle = profileRedirectHandle(pathname);
  if (handle) {
    return redirect(res, frontendProfileUrl(req, handle));
  }

  if (isFrontendPagePath(pathname)) {
    return sendApiOnlyNotice(res);
  }

  return twikooVercel(req, res);
};
