const demoUsersApi = require('./demo');
const twikooVercel = require('twikoo-vercel');

function getRequestUrl(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url, `https://${host}`);
}

// 前端页面路径（登录/用户中心/管理后台等）均由博客前端承载，
// 后端不再提供页面或重定向，统一返回 404 JSON 提示。
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
    message: 'Twikoo 后端仅提供 API；登录、注册和用户中心均在博客前端实现。',
  }));
}

module.exports = async function twikooWithDemo(req, res) {
  const pathname = getRequestUrl(req).pathname;

  // 魔改业务 API：用户/积分商城/AI 评论/通知/管理
  if (pathname === '/api/demo' || pathname.startsWith('/api/demo/')) {
    return demoUsersApi(req, res);
  }

  // AI 评论兼容入口
  if (pathname === '/api/ai-comment') {
    req.url = '/api/demo?action=aiComment';
    return demoUsersApi(req, res);
  }

  // 前端页面路径不再由后端提供
  if (isFrontendPagePath(pathname)) {
    return sendApiOnlyNotice(res);
  }

  // 其余全部交给官方 twikoo-vercel 处理评论 API
  return twikooVercel(req, res);
};
