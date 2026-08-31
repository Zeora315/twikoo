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

// 需要应用"评论层"（两层扁平 + AI 标记 + 级联删除）的事件
const COMMENT_LAYER_EVENTS = new Set([
  'COMMENT_GET',
  'COMMENT_SUBMIT',
  'COMMENT_DELETE_FOR_ADMIN',
  'COMMENT_DELETE_FOR_USER',
]);

// 本地/非 Vercel 环境兜底 Express 风格响应方法（Vercel 运行时自带）
function attachExpressLikeMethods(res) {
  if (typeof res.status !== 'function') {
    res.status = function (code) {
      res.statusCode = code;
      return res;
    };
  }
  if (typeof res.send !== 'function') {
    res.send = function (data) {
      if (typeof data === 'object' && data !== null) return res.json(data);
      return res.end(String(data));
    };
  }
  if (typeof res.json !== 'function') {
    res.json = function (data) {
      if (!res.getHeader('content-type')) {
        res.setHeader('content-type', 'application/json; charset=utf-8');
      }
      return res.end(JSON.stringify(data));
    };
  }
  return res;
}

async function twikooVercelWithCommentLayer(req, res) {
  attachExpressLikeMethods(res);

  const event = (req.body || {}).event;
  if (!COMMENT_LAYER_EVENTS.has(event)) {
    return twikooVercel(req, res);
  }

  // 捕获 twikooVercel 写入的响应体，稍后做评论层转换再真正发送
  let captured = '';
  const originalEnd = res.end.bind(res);
  res.end = function (chunk) {
    if (chunk !== undefined && chunk !== null) captured += chunk.toString();
    return this;
  };

  try {
    await twikooVercel(req, res);
  } catch (error) {
    res.end = originalEnd;
    throw error;
  }
  res.end = originalEnd;

  if (captured) {
    let payload = null;
    try {
      payload = JSON.parse(captured);
    } catch (error) {
      // 非 JSON 响应原样返回
    }
    if (payload && typeof payload === 'object') {
      payload = await demoUsersApi.applyCommentLayer(event, req.body || {}, payload) || payload;
      captured = JSON.stringify(payload);
    }
  }

  res.removeHeader('content-length');
  return originalEnd(captured);
}

module.exports = async function twikooWithDemo(req, res) {
  const url = getRequestUrl(req);
  const pathname = url.pathname;

  // 魔改业务 API：用户/积分商城/AI 评论/通知/管理
  if (pathname === '/api/demo' || pathname.startsWith('/api/demo/')) {
    return demoUsersApi(req, res);
  }

  // Vercel 已把所有路径重写到 api/index。带 action 的请求都属于
  // 用户中心/AI 扩展 API，必须先交给 demo 层，避免被 twikoo-vercel 当成普通评论事件。
  if (url.searchParams.get('action')) {
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

  // 评论 API：先经过评论层包装，再交给官方 twikoo-vercel
  return twikooVercelWithCommentLayer(req, res);
};
