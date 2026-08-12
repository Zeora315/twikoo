const SESSION_TOKEN_KEY = 'twikooUserCenterSessionToken';
const SESSION_USER_KEY = 'twikooUserCenterSessionUser';
const LEGACY_SESSION_TOKEN_KEY = 'twikooDemoSessionToken';
const LEGACY_SESSION_USER_KEY = 'twikooDemoSessionUser';
const params = new URLSearchParams(window.location.search);

function readPublicProfileHandle() {
  const match = window.location.pathname.match(/^\/user\/([^/]+)\/?$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).replace(/^@/, '').trim();
  } catch (error) {
    return match[1].replace(/^@/, '').trim();
  }
}

function readAppRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/admin';
  if (path === '/admin' || path === '/user-center') return 'home';
  if (path === '/settings/profile') return 'profile';
  if (path === '/settings/password') return 'password';
  if (path === '/settings/notifications') return 'notification-settings';
  if (path === '/notifications') return 'notifications';
  if (path === '/admin/users') return 'admin-users';
  return 'home';
}

function normalizeOrigin(value) {
  try {
    return value ? new URL(value).origin : '';
  } catch (error) {
    return '';
  }
}

function storedSessionToken() {
  return localStorage.getItem(SESSION_TOKEN_KEY) ||
    sessionStorage.getItem(SESSION_TOKEN_KEY) ||
    localStorage.getItem(LEGACY_SESSION_TOKEN_KEY) ||
    '';
}

const state = {
  currentUser: null,
  credentials: null,
  sessionToken: storedSessionToken(),
  rememberSession: !sessionStorage.getItem(SESSION_TOKEN_KEY),
  users: [],
  authMode: 'login',
  authEmail: '',
  adminProtected: false,
  adminToken: localStorage.getItem('twikooUserCenterAdminToken') || localStorage.getItem('twikooDemoAdminToken') || '',
  captcha: { enabled: false, provider: '' },
  commentAuth: params.get('comment_auth') === '1',
  parentOrigin: normalizeOrigin(params.get('origin')) || normalizeOrigin(document.referrer),
  parentAuthorized: false,
  commentAuthCompleted: false,
  commentAuthorizePromptShown: false,
  siteName: params.get('site') || '',
  publicProfileHandle: readPublicProfileHandle(),
  route: readAppRoute(),
  notificationSummary: { unread: 0, notifications: [] },
  filter: { query: '', role: 'all', status: 'all' },
};

let geetestLoaderPromise = null;
const captchaLoaderPromises = new Map();

const els = {
  authView: document.querySelector('#authView'),
  centerView: document.querySelector('#centerView'),
  publicProfileView: document.querySelector('#publicProfileView'),
  authSwitchText: document.querySelector('#authSwitchText'),
  authSwitchBtn: document.querySelector('#authSwitchBtn'),
  authEmailForm: document.querySelector('#authEmailForm'),
  authCodeForm: document.querySelector('#authCodeForm'),
  authPasswordForm: document.querySelector('#authPasswordForm'),
  authRegisterForm: document.querySelector('#authRegisterForm'),
  authResetForm: document.querySelector('#authResetForm'),
  authEmailInput: document.querySelector('#authEmailInput'),
  rememberMeInput: document.querySelector('#rememberMeInput'),
  authModeHint: document.querySelector('#authModeHint'),
  captchaStatus: document.querySelector('#captchaStatus'),
  authTabs: document.querySelectorAll('[data-auth-tab]'),
  profileAvatar: document.querySelector('#profileAvatar'),
  profileName: document.querySelector('#profileName'),
  profileUid: document.querySelector('#profileUid'),
  profileJoined: document.querySelector('#profileJoined'),
  profileEmail: document.querySelector('#profileEmail'),
  publicProfileLink: document.querySelector('#publicProfileLink'),
  notificationLink: document.querySelector('#notificationLink'),
  notificationCount: document.querySelector('#notificationCount'),
  roleBadge: document.querySelector('#roleBadge'),
  actionGrid: document.querySelector('.action-grid'),
  routeTitle: document.querySelector('#routeTitle'),
  routeSubtitle: document.querySelector('#routeSubtitle'),
  routeView: document.querySelector('#routeView'),
  adminCard: document.querySelector('#adminCard'),
  logoutBtn: document.querySelector('#logoutBtn'),
  commentCenterReturn: document.querySelector('#commentCenterReturn'),
  modalRoot: document.querySelector('#modalRoot'),
  toast: document.querySelector('#toast'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeBadgeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "";
}

function applyRoleBadge(element, user) {
  if (!element) return;
  const badge = user?.badgeLabel || (user?.role === "admin" ? "博主" : "");
  const color = normalizeBadgeColor(user?.badgeColor);
  element.textContent = badge;
  element.classList.toggle("hidden", !badge);
  if (color) element.style.setProperty("--badge-color", color);
  else element.style.removeProperty("--badge-color");
}

function initials(user) {
  const source = user?.displayName || user?.username || '?';
  return source.trim().slice(0, 2).toUpperCase();
}

function avatarHtml(user, className = 'mini-avatar') {
  if (user?.avatarUrl) {
    return `<span class="${className}"><img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.displayName)} 的头像" /></span>`;
  }
  return `<span class="${className}" aria-hidden="true">${escapeHtml(initials(user))}</span>`;
}

function setAvatar(element, user) {
  if (user?.avatarUrl) {
    element.innerHTML = `<img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.displayName)} 的头像" />`;
  } else {
    element.textContent = initials(user);
  }
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('is-error', isError);
  els.toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('is-visible'), 3000);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem(SESSION_USER_KEY) ||
      sessionStorage.getItem(SESSION_USER_KEY) ||
      localStorage.getItem(LEGACY_SESSION_USER_KEY) ||
      'null';
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function persistSession(user, token) {
  const remember = els.rememberMeInput ? els.rememberMeInput.checked : state.rememberSession;
  state.rememberSession = remember;
  const target = remember ? localStorage : sessionStorage;
  clearStoredSession();
  if (token) target.setItem(SESSION_TOKEN_KEY, token);
  if (user) target.setItem(SESSION_USER_KEY, JSON.stringify(user));
}

function clearStoredSession() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_USER_KEY);
  localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
  localStorage.removeItem(LEGACY_SESSION_USER_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_USER_KEY);
}

function findEmailInValue(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match?.[0] || '';
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (/mail|email/i.test(key) && typeof value[key] === 'string') {
        const found = findEmailInValue(value[key]);
        if (found) return found;
      }
    }
    for (const nested of Object.values(value)) {
      const found = findEmailInValue(nested);
      if (found) return found;
    }
  }
  return '';
}

function detectTwikooEmail() {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || '';
      const raw = localStorage.getItem(key) || '';
      if (!/twikoo|comment|mail|email/i.test(`${key} ${raw}`)) continue;
      const direct = findEmailInValue(raw);
      if (direct) return direct;
      try {
        const parsed = JSON.parse(raw);
        const nested = findEmailInValue(parsed);
        if (nested) return nested;
      } catch (error) {
        // Ignore non-JSON localStorage entries.
      }
    }
  } catch (error) {
    return '';
  }
  return '';
}

function setAuthMode(mode) {
  state.authMode = mode;
  state.authEmail = '';
  els.authEmailForm.classList.remove('hidden');
  els.authCodeForm.classList.add('hidden');
  els.authPasswordForm.classList.add('hidden');
  els.authRegisterForm.classList.add('hidden');
  els.authResetForm.classList.add('hidden');
  els.authTabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.authTab === mode));
  if (els.authModeHint) {
    els.authModeHint.textContent = mode === 'register'
      ? '注册会先发送邮箱验证码，然后创建你的评论身份。'
      : mode === 'reset'
        ? '找回密码会向账号邮箱发送验证码，通过后即可设置新密码。'
        : '登录会使用邮箱和密码；勾选记住我后下次自动进入用户中心。';
  }
  requestAnimationFrame(() => els.authEmailInput.focus());
}

function makeUsernameFromEmail(email) {
  const localPart = email.split('@')[0] || 'user';
  return localPart.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 32).padEnd(3, '0');
}

function loadScriptOnce(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  if (captchaLoaderPromises.has(src)) return captchaLoaderPromises.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('人机验证脚本加载失败，请检查网络后重试。'));
    document.head.appendChild(script);
  });
  captchaLoaderPromises.set(src, promise);
  return promise;
}

function ensureCaptchaMount(provider) {
  let mount = document.querySelector('#ucCaptchaMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'ucCaptchaMount';
    mount.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(24,28,39,.38);backdrop-filter:blur(8px);';
    document.body.appendChild(mount);
  }
  mount.innerHTML = `
    <div style="display:grid;gap:14px;width:min(360px,calc(100vw - 32px));padding:18px;border-radius:16px;background:#fff;box-shadow:0 18px 48px rgba(0,0,0,.18);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <strong style="color:#202124;font-size:16px;">${escapeHtml(provider)} 人机验证</strong>
        <button type="button" data-uc-captcha-close style="width:32px;height:32px;border:0;border-radius:50%;background:#f4f6f8;color:#202124;cursor:pointer;">×</button>
      </div>
      <div id="ucCaptchaSlot" style="display:grid;place-items:center;min-height:78px;"></div>
    </div>
  `;
  return { mount, slot: mount.querySelector('#ucCaptchaSlot') };
}

function closeCaptchaMount() {
  document.querySelector('#ucCaptchaMount')?.remove();
}

async function runSiteTokenCaptcha(provider) {
  const siteKey = state.captcha?.siteKey;
  if (!siteKey) throw new Error(`${provider} Site Key 未配置，请检查 Twikoo 评论管理后台。`);
  const scripts = {
    Turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    hCaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit',
    reCAPTCHA: 'https://www.google.com/recaptcha/api.js?render=explicit',
  };
  await loadScriptOnce(scripts[provider]);

  return new Promise((resolve, reject) => {
    const { mount, slot } = ensureCaptchaMount(provider);
    const finish = (token) => {
      closeCaptchaMount();
      resolve(token);
    };
    const fail = () => {
      closeCaptchaMount();
      reject(new Error('人机验证失败，请重新验证。'));
    };
    mount.querySelector('[data-uc-captcha-close]')?.addEventListener('click', () => {
      closeCaptchaMount();
      reject(new Error('请先完成人机验证。'));
    }, { once: true });

    if (provider === 'Turnstile' && window.turnstile) {
      window.turnstile.render(slot, { sitekey: siteKey, callback: finish, 'error-callback': fail, 'expired-callback': fail });
      return;
    }
    if (provider === 'hCaptcha' && window.hcaptcha) {
      window.hcaptcha.render(slot, { sitekey: siteKey, callback: finish, 'error-callback': fail, 'expired-callback': fail });
      return;
    }
    if (provider === 'reCAPTCHA' && window.grecaptcha) {
      window.grecaptcha.render(slot, { sitekey: siteKey, callback: finish, 'error-callback': fail, 'expired-callback': fail });
      return;
    }
    fail();
  });
}

async function runGeetestCaptcha() {
  const captchaId = state.captcha.geetestCaptchaId;
  if (!captchaId) throw new Error('极验 Captcha ID 未配置，请检查 Twikoo 评论管理后台。');
  geetestLoaderPromise = geetestLoaderPromise || loadScriptOnce('https://static.geetest.com/v4/gt4.js');
  await geetestLoaderPromise;
  if (typeof window.initGeetest4 !== 'function') throw new Error('极验脚本未就绪，请刷新后重试。');

  return new Promise((resolve, reject) => {
    window.initGeetest4({
      captchaId,
      product: 'bind',
      language: 'zho',
    }, (captcha) => {
      captcha.onReady(() => captcha.showCaptcha());
      captcha.onSuccess(() => resolve(captcha.getValidate()));
      captcha.onError(() => reject(new Error('人机验证失败，请重新验证。')));
      captcha.onClose?.(() => reject(new Error('请先完成人机验证。')));
    });
  });
}

async function runCaptchaChallenge() {
  if (!state.captcha?.enabled) return null;
  if (state.captcha.provider === 'Geetest') return runGeetestCaptcha();
  if (['Turnstile', 'hCaptcha', 'reCAPTCHA'].includes(state.captcha.provider)) {
    return runSiteTokenCaptcha(state.captcha.provider);
  }
  throw new Error(`暂不支持 ${state.captcha.provider || '当前'} 人机验证前端。`);
}

async function requestCodeStep(submitter, purpose = 'login') {
  if (submitter) submitter.disabled = true;
  try {
    const captcha = await runCaptchaChallenge();
    await api('requestCode', { method: 'POST', body: { email: state.authEmail, purpose, captcha } });
    els.authEmailForm.classList.add('hidden');
    els.authPasswordForm.classList.add('hidden');
    els.authRegisterForm.classList.add('hidden');
    els.authResetForm.classList.add('hidden');
    if (purpose === 'reset') {
      els.authResetForm.classList.remove('hidden');
      els.authResetForm.code.focus();
    } else if (purpose === 'register') {
      els.authRegisterForm.classList.remove('hidden');
      els.authRegisterForm.username.value = makeUsernameFromEmail(state.authEmail);
      els.authRegisterForm.displayName.value = els.authRegisterForm.displayName.value || makeUsernameFromEmail(state.authEmail);
      els.authRegisterForm.code.focus();
    } else {
      els.authCodeForm.classList.remove('hidden');
      els.authCodeForm.code.focus();
    }
    showToast('验证码已发送，请检查邮箱。');
  } finally {
    if (submitter) submitter.disabled = false;
  }
}

async function showPasswordStep(submitter) {
  state.authEmail = els.authEmailInput.value.trim().toLowerCase();

  els.authEmailForm.classList.add('hidden');
  els.authCodeForm.classList.add('hidden');
  els.authResetForm.classList.add('hidden');
  if (state.authMode === 'login') {
    els.authPasswordForm.classList.remove('hidden');
    els.authRegisterForm.classList.add('hidden');
    els.authPasswordForm.password.focus();
  } else if (state.authMode === 'register') {
    await requestCodeStep(submitter, 'register');
  } else {
    await requestCodeStep(submitter, 'reset');
  }
}

async function api(action, options = {}) {
  const headers = {};
  const method = options.method || 'GET';
  const url = new URL('/api/demo', window.location.origin);
  url.searchParams.set('action', action);
  Object.entries(options.params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const fetchOptions = { method, headers };

  if (state.sessionToken) headers['x-session-token'] = state.sessionToken;
  if (state.adminToken) headers['x-admin-token'] = state.adminToken;
  if (state.sessionToken && method === 'GET') url.searchParams.set('sessionToken', state.sessionToken);
  if (options.body) {
    headers['content-type'] = 'application/json';
    fetchOptions.body = JSON.stringify({
      ...options.body,
      ...(state.sessionToken ? { sessionToken: state.sessionToken } : {}),
    });
  }

  const response = await fetch(url.toString(), fetchOptions);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || '请求失败。');
  }
  return payload;
}

function formatDate(value) {
  if (!value) return '未知';
  const date = new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function userMatchesHandle(user, handle) {
  const value = String(handle || '').replace(/^@/, '').toLowerCase();
  if (!user || !value) return false;
  return [user.username, user.uid, user.id]
    .filter(Boolean)
    .some((item) => String(item).toLowerCase() === value);
}

function hideAppViews() {
  els.authView.classList.add('hidden');
  els.centerView.classList.add('hidden');
  els.publicProfileView?.classList.add('hidden');
  document.querySelector('#commentAuthPanel')?.remove();
}

function renderPublicProfile(user) {
  if (!els.publicProfileView) return;

  hideAppViews();
  els.publicProfileView.classList.remove('hidden');
  const websiteUrl = user.websiteUrl || '';
  const contactEmail = user.contactEmail || '';
  els.publicProfileView.innerHTML = `
    <a class="public-back" href="/admin" aria-label="返回用户中心">用户中心</a>
    <article class="public-profile-card">
      ${avatarHtml(user, 'public-avatar')}
      <h1>${escapeHtml(user.displayName || user.username)}</h1>
      <p class="public-subtitle">${escapeHtml(user.bio || '这个人还没有填写个人简介')}</p>
      <div class="public-id-row" aria-label="用户身份">
        <span>@${escapeHtml(user.username)}</span>
        ${user.badgeLabel ? `<span>${escapeHtml(user.badgeLabel)}</span>` : ''}
      </div>
      <div class="public-actions">
        ${websiteUrl ? `<a class="public-primary" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener">立即访问个人网站</a>` : ''}
        ${contactEmail ? `<a class="public-secondary" href="mailto:${escapeHtml(contactEmail)}">联系我</a>` : ''}
      </div>
      ${state.currentUser && userMatchesHandle(state.currentUser, user.username)
        ? '<a class="public-primary" href="/settings/profile">编辑我的资料</a>'
        : ''}
    </article>
    <a class="public-report" href="/me?view=report-create">违法信息举报</a>
  `;
}

async function loadPublicProfile() {
  hideAppViews();
  try {
    const payload = await api('profile', { params: { handle: state.publicProfileHandle } });
    renderPublicProfile(payload.user);
  } catch (error) {
    els.publicProfileView.classList.remove('hidden');
    els.publicProfileView.innerHTML = `
      <a class="public-back" href="/admin" aria-label="返回用户中心">用户中心</a>
      <article class="public-profile-card">
        <div class="public-avatar" aria-hidden="true">?</div>
        <h1>用户不存在</h1>
        <p class="public-subtitle">${escapeHtml(error.message)}</p>
      </article>
    `;
  }
}

function publicProfilePath(user) {
  const handle = encodeURIComponent(user?.username || user?.uid || user?.id || '');
  return handle ? `/user/${handle}` : '/admin';
}

function setRouteChrome(user) {
  const profilePath = publicProfilePath(user);
  if (els.publicProfileLink) els.publicProfileLink.href = profilePath;
  const count = Number(state.notificationSummary.unread || 0);
  if (els.notificationCount) {
    els.notificationCount.textContent = String(count);
    els.notificationCount.classList.toggle('hidden', count <= 0);
  }
  document.querySelectorAll('[data-route]').forEach((node) => {
    const route = node.dataset.route || '';
    node.classList.toggle('is-active', route === window.location.pathname.replace(/\/+$/, '') || (state.route === 'home' && route === '/admin'));
  });
}

async function refreshNotificationSummary() {
  if (!state.sessionToken) return;
  try {
    const payload = await api('notifications');
    state.notificationSummary = {
      unread: payload.unread || 0,
      notifications: payload.notifications || [],
    };
    setRouteChrome(state.currentUser);
    if (state.route === 'home' && state.currentUser) renderHomePage(state.currentUser);
  } catch (error) {
    state.notificationSummary = { unread: 0, notifications: [] };
  }
}

function routeIntro(title, text) {
  if (els.routeTitle) els.routeTitle.textContent = title;
  if (els.routeSubtitle) els.routeSubtitle.textContent = text;
  document.title = `${title} - 用户中心`;
  return '';
}

function renderHomePage(user) {
  routeIntro('用户中心', '管理评论身份、公开资料和通知方式。');
  els.routeView.innerHTML = `
    <section class="home-grid" aria-label="账号概览">
      <div class="home-tile"><strong>${escapeHtml(user.badgeLabel || '普通用户')}</strong><span>身份标签</span></div>
      <div class="home-tile"><strong>${escapeHtml(String(state.notificationSummary.unread || 0))}</strong><span>未读消息</span></div>
      <div class="home-tile"><strong>${escapeHtml(formatDate(user.lastLoginAt || user.createdAt))}</strong><span>最近登录</span></div>
    </section>
    <section class="settings-form panel-form">
      <label class="field"><span>个人主页</span><input value="${escapeHtml(`${window.location.origin}${publicProfilePath(user)}`)}" readonly /></label>
      <div class="form-actions">
        <a class="primary-btn" href="/settings/profile">编辑资料</a>
        <a class="ghost-link" href="${escapeHtml(publicProfilePath(user))}">查看个人主页</a>
      </div>
    </section>
  `;
}

function renderProfileSettingsPage(user) {
  els.routeView.innerHTML = `
    ${routeIntro('编辑资料', '这些信息会展示在你的评论身份和个人主页上。')}
    <form id="editProfileForm" class="settings-form avatar-editor">
      <div id="editAvatarPreview" class="profile-avatar">${escapeHtml(initials(user))}</div>
      <div class="panel-form">
        <label class="field"><span>显示名称</span><input name="displayName" maxlength="64" value="${escapeHtml(user.displayName)}" /></label>
        <label class="field"><span>头像外链</span><input id="avatarUrlInput" name="avatarUrl" value="${escapeHtml(user.avatarUrl || '')}" placeholder="https://example.com/avatar.png" /></label>
        <label class="field"><span>个人简介</span><textarea name="bio" maxlength="120" rows="3" placeholder="介绍一下你自己">${escapeHtml(user.bio || '')}</textarea></label>
        <label class="field"><span>个人网站</span><input name="websiteUrl" value="${escapeHtml(user.websiteUrl || '')}" placeholder="https://example.com" /></label>
        <label class="field"><span>公开联系邮箱</span><input name="contactEmail" type="email" value="${escapeHtml(user.contactEmail || '')}" placeholder="name@example.com" /></label>
        <label class="field"><span>登录邮箱</span><input value="${escapeHtml(user.email)}" disabled /></label>
        <div class="form-actions">
          <button class="primary-btn" type="submit">保存资料</button>
          <a class="ghost-link" href="${escapeHtml(publicProfilePath(user))}">查看个人主页</a>
        </div>
      </div>
    </form>
  `;
  const preview = document.querySelector('#editAvatarPreview');
  const input = document.querySelector('#avatarUrlInput');
  setAvatar(preview, user);
  input.addEventListener('input', () => setAvatar(preview, { ...user, avatarUrl: input.value.trim() }));
}

function renderPasswordSettingsPage() {
  els.routeView.innerHTML = `
    ${routeIntro('修改密码', '更改后会继续保持当前登录状态。忘记密码可以从登录页用邮箱验证码重置。')}
    <form id="passwordForm" class="settings-form panel-form">
      <label class="field"><span>当前密码</span><input name="currentPassword" type="password" required autocomplete="current-password" /></label>
      <label class="field"><span>新密码</span><input name="newPassword" type="password" required minlength="8" autocomplete="new-password" /></label>
      <div class="form-actions">
        <button class="primary-btn" type="submit">保存新密码</button>
      </div>
    </form>
  `;
}

function renderNotificationSettingsPage(user) {
  const notifications = user.notifications || {};
  els.routeView.innerHTML = `
    ${routeIntro('通知设置', '选择站内铃铛、邮件和浏览器提醒的接收方式。')}
    <form id="noticeForm" class="settings-form panel-form">
      <div class="switch-list">
        <label class="switch-row">
          <span><strong>站内回复提醒</strong><small>有人回复评论时在消息中心显示</small></span>
          <input name="siteReplies" type="checkbox" ${notifications.siteReplies !== false ? 'checked' : ''} />
        </label>
        <label class="switch-row">
          <span><strong>邮件回复提醒</strong><small>有人回复评论时发送邮件</small></span>
          <input name="emailReplies" type="checkbox" ${notifications.emailReplies ? 'checked' : ''} />
        </label>
        <label class="switch-row">
          <span><strong>系统通知邮件</strong><small>账号状态或站点消息提醒</small></span>
          <input name="emailSystem" type="checkbox" ${notifications.emailSystem ? 'checked' : ''} />
        </label>
        <label class="switch-row">
          <span><strong>浏览器推送</strong><small>预留给前端 Web Push 集成</small></span>
          <input name="browserPush" type="checkbox" ${notifications.browserPush ? 'checked' : ''} />
        </label>
      </div>
      <div class="form-actions">
        <button class="primary-btn" type="submit">保存通知设置</button>
        <a class="ghost-link" href="/notifications">打开消息中心</a>
      </div>
    </form>
  `;
}

function notificationItemHtml(item) {
  const readClass = item.readAt ? 'is-read' : 'is-unread';
  return `
    <article class="notification-item ${readClass}" data-notification-id="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.body || '没有更多内容。')}</p>
        <small>${escapeHtml(item.actorName || '系统')} · ${escapeHtml(formatDate(item.createdAt))}</small>
      </div>
      ${item.link ? `<a href="${escapeHtml(item.link)}">查看</a>` : ''}
    </article>
  `;
}

async function renderNotificationsPage() {
  els.routeView.innerHTML = `
    ${routeIntro('消息中心', '评论回复和系统提醒都会在这里汇总。')}
    <section class="notification-list"><p class="empty-state">正在读取通知...</p></section>
  `;
  try {
    const payload = await api('notifications');
    state.notificationSummary = {
      unread: payload.unread || 0,
      notifications: payload.notifications || [],
    };
    setRouteChrome(state.currentUser);
    const list = els.routeView.querySelector('.notification-list');
    if (!state.notificationSummary.notifications.length) {
      list.innerHTML = '<p class="empty-state">暂时没有通知。有人回复你的评论后，这里会出现提醒。</p>';
      return;
    }
    list.innerHTML = `
      <div class="notification-actions">
        <button class="ghost-btn" type="button" data-mark-all-notifications>全部标为已读</button>
        <a class="ghost-link" href="/settings/notifications">通知设置</a>
      </div>
      ${state.notificationSummary.notifications.map(notificationItemHtml).join('')}
    `;
  } catch (error) {
    els.routeView.querySelector('.notification-list').innerHTML = `<p class="empty-state is-error">${escapeHtml(error.message)}</p>`;
  }
}

async function renderAdminUsersPage() {
  if (state.currentUser?.role !== 'admin') {
    els.routeView.innerHTML = `${routeIntro('管理员面板', '只有管理员可以查看注册用户。')}<p class="empty-state is-error">当前账号没有管理员权限。</p>`;
    return;
  }
  els.routeView.innerHTML = `
    ${routeIntro('管理员面板', '管理评论账号的身份、状态和资料。')}
    <div class="admin-toolbar">
      <input id="adminSearch" type="search" placeholder="搜索用户、邮箱、UID" />
      <select id="adminRoleFilter"><option value="all">全部身份</option><option value="admin">管理员</option><option value="user">普通用户</option></select>
      <select id="adminStatusFilter"><option value="all">全部状态</option><option value="active">可用</option><option value="blocked">停用</option></select>
      <button id="adminRefresh" class="ghost-btn" type="button">刷新列表</button>
    </div>
    <div id="adminSummary" class="admin-summary" aria-label="用户概览"></div>
    <div id="adminTableWrap">正在加载用户...</div>
  `;
  await loadAdminUsers();
  document.querySelector('#adminRefresh').addEventListener('click', loadAdminUsers);
  document.querySelector('#adminSearch').addEventListener('input', (event) => {
    state.filter.query = event.target.value.trim().toLowerCase();
    renderAdminTable();
  });
  document.querySelector('#adminRoleFilter').addEventListener('change', (event) => {
    state.filter.role = event.target.value;
    renderAdminTable();
  });
  document.querySelector('#adminStatusFilter').addEventListener('change', (event) => {
    state.filter.status = event.target.value;
    renderAdminTable();
  });
}

function renderCenterRoute() {
  if (!state.currentUser || !els.routeView) return;
  els.actionGrid.classList.toggle('hidden', state.commentAuth);
  els.routeView.classList.toggle('hidden', state.commentAuth);
  if (state.commentAuth) {
    els.routeView.innerHTML = '';
    return;
  }
  if (state.route === 'home') renderHomePage(state.currentUser);
  if (state.route === 'profile') renderProfileSettingsPage(state.currentUser);
  if (state.route === 'password') renderPasswordSettingsPage();
  if (state.route === 'notification-settings') renderNotificationSettingsPage(state.currentUser);
  if (state.route === 'notifications') renderNotificationsPage();
  if (state.route === 'admin-users') renderAdminUsersPage();
}

function updateShell() {
  const user = state.currentUser;
  els.publicProfileView?.classList.add('hidden');
  if (!user) {
    els.authView.classList.remove('hidden');
    els.centerView.classList.add('hidden');
    document.querySelector('#commentAuthPanel')?.remove();
    closeModal();
    return;
  }

  els.authView.classList.add('hidden');
  els.centerView.classList.remove('hidden');
  els.commentCenterReturn?.classList.toggle('hidden', !state.commentAuth);
  setAvatar(els.profileAvatar, user);
  els.profileName.textContent = user.displayName || user.username;
  els.profileUid.textContent = `@${user.username || user.uid || user.id.slice(0, 5)}`;
  els.profileJoined.textContent = `加入于 ${formatDate(user.createdAt)}`;
  els.profileEmail.textContent = user.email;
  const existingBio = document.querySelector('#profileBio');
  if (existingBio) existingBio.textContent = user.bio || '还没有填写个人简介';
  setRouteChrome(user);
  applyRoleBadge(els.roleBadge, user);
  els.adminCard.classList.toggle('hidden', user.role !== 'admin');
  renderCenterRoute();
  refreshNotificationSummary();
  if (state.commentAuth) {
    document.querySelector('#commentAuthPanel')?.remove();
    requestAnimationFrame(openCommentAuthorizeDialog);
  } else {
    document.querySelector('#commentAuthPanel')?.remove();
  }
}

function openCommentAuthorizeDialog() {
  if (!state.commentAuth || !state.currentUser || state.commentAuthorizePromptShown) return;
  state.commentAuthorizePromptShown = true;
  const user = state.currentUser;
  openModal('是否授权博客评论？', `
    <div class="comment-consent">
      <div class="consent-user">
        ${avatarHtml(user, 'consent-avatar')}
        <span>
          <strong>${escapeHtml(user.displayName || user.username)}</strong>
          <small>UID: ${escapeHtml(user.uid || user.id.slice(0, 5))}</small>
        </span>
      </div>
      <p>${escapeHtml(state.siteName || '当前博客')} 将使用你的昵称、头像和邮箱发表评论。</p>
      <div class="form-actions consent-actions">
        <button class="primary-btn authorize-login-btn" type="button" data-comment-authorize>允许</button>
        <button class="ghost-btn" type="button" data-close-modal>暂不</button>
      </div>
      <a class="center-return-link" href="/admin" target="_self">返回用户中心</a>
    </div>
  `);
}

function authorizeCommentArea() {
  if (!state.currentUser || !state.sessionToken) {
    showToast('请先登录后再授权。', true);
    return;
  }
  if (state.commentAuthCompleted) return;
  state.commentAuthCompleted = true;

  if (window.parent === window) {
    showToast('已登录，可回到评论区继续。');
    return;
  }

  state.parentAuthorized = false;
  const payload = {
    type: 'ZEORA_TWIKOO_COMMENT_AUTH',
    user: state.currentUser,
    sessionToken: state.sessionToken,
  };

  window.parent.postMessage(payload, state.parentOrigin || '*');
  if (state.parentOrigin) window.parent.postMessage({ ...payload, fallback: true }, '*');
  if (state.parentOrigin) {
    setTimeout(() => {
      if (!state.parentAuthorized) window.parent.postMessage({ ...payload, fallback: true }, '*');
    }, 450);
  }
  closeModal();
  showToast('已登录，正在返回评论区。');
}

async function refreshHealth() {
  const health = await api('health');
  state.adminProtected = health.adminProtected;
  state.captcha = health.captcha || { enabled: false, provider: '' };
  if (els.captchaStatus) {
    const label = state.captcha.provider ? `站点人机验证已启用：${state.captcha.provider}` : '站点人机验证已启用';
    els.captchaStatus.querySelector('span').textContent = label;
    els.captchaStatus.classList.toggle('hidden', !state.captcha.enabled);
  }
}

async function login(credentials, silent = false) {
  const result = await api('login', { method: 'POST', body: credentials });
  setAuthenticated(result, credentials);
  updateShell();
  if (!silent) showToast(state.commentAuth ? '已登录，请确认授权。' : '已进入用户中心。');
}

function setAuthenticated(result, credentials = null) {
  state.currentUser = result.user;
  state.sessionToken = result.sessionToken || state.sessionToken;
  state.credentials = credentials;
  persistSession(state.currentUser, state.sessionToken);
}

async function refreshCurrentUser() {
  if (state.credentials) {
    await login(state.credentials, true);
    return;
  }
  if (!state.sessionToken) return;
  const payload = await api('me');
  state.currentUser = payload.user;
  updateShell();
}

function openModal(title, body, options = {}) {
  els.modalRoot.innerHTML = `
    <div class="modal-card ${options.wide ? 'modal-card--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head">
        <h2 id="modalTitle">${escapeHtml(title)}</h2>
        <button class="modal-close" type="button" data-close-modal aria-label="关闭弹窗"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg></button>
      </div>
      ${body}
    </div>
  `;
  els.modalRoot.classList.remove('hidden');
}

function closeModal() {
  els.modalRoot.classList.add('hidden');
  els.modalRoot.innerHTML = '';
}

function openPanel(name) {
  if (!state.currentUser) return;
  const renderers = {
    edit: renderEditModal,
    password: renderPasswordModal,
    notice: renderNoticeModal,
    admin: renderAdminModal,
  };
  renderers[name]?.();
}

function renderEditModal() {
  const user = state.currentUser;
  openModal('编辑资料', `
    <form id="editProfileForm" class="avatar-editor">
      <div id="editAvatarPreview" class="profile-avatar">${escapeHtml(initials(user))}</div>
      <div class="panel-form">
        <label class="field">
          <span>显示名称</span>
          <input name="displayName" maxlength="64" value="${escapeHtml(user.displayName)}" />
        </label>
        <label class="field">
          <span>头像外链</span>
          <input id="avatarUrlInput" name="avatarUrl" value="${escapeHtml(user.avatarUrl || '')}" placeholder="https://example.com/avatar.png" />
        </label>
        <label class="field">
          <span>个人简介</span>
          <textarea name="bio" maxlength="120" rows="3" placeholder="介绍一下你自己">${escapeHtml(user.bio || '')}</textarea>
        </label>
        <label class="field">
          <span>个人网站</span>
          <input name="websiteUrl" value="${escapeHtml(user.websiteUrl || '')}" placeholder="https://example.com" />
        </label>
        <label class="field">
          <span>公开联系邮箱</span>
          <input name="contactEmail" type="email" value="${escapeHtml(user.contactEmail || '')}" placeholder="name@example.com" />
        </label>
        <label class="field">
          <span>登录邮箱</span>
          <input value="${escapeHtml(user.email)}" disabled />
        </label>
        <div class="form-actions">
          <button class="primary-btn" type="submit">保存资料</button>
          <button class="ghost-btn" type="button" data-close-modal>取消</button>
        </div>
      </div>
    </form>
  `);

  const preview = document.querySelector('#editAvatarPreview');
  const input = document.querySelector('#avatarUrlInput');
  setAvatar(preview, user);
  input.addEventListener('input', () => {
    setAvatar(preview, { ...user, avatarUrl: input.value.trim() });
  });
}

function renderPasswordModal() {
  openModal('修改密码', `
    <form id="passwordForm" class="panel-form">
      <label class="field">
        <span>当前密码</span>
        <input name="currentPassword" type="password" required autocomplete="current-password" />
      </label>
      <label class="field">
        <span>新密码</span>
        <input name="newPassword" type="password" required minlength="8" autocomplete="new-password" />
      </label>
      <div class="form-actions">
        <button class="primary-btn" type="submit">保存新密码</button>
        <button class="ghost-btn" type="button" data-close-modal>取消</button>
      </div>
    </form>
  `);
}

function renderNoticeModal() {
  const notifications = state.currentUser.notifications || {};
  openModal('通知设置', `
    <form id="noticeForm" class="panel-form">
      <div class="switch-list">
        <label class="switch-row">
          <span><strong>站内回复提醒</strong><small>有人回复评论时在消息中心显示</small></span>
          <input name="siteReplies" type="checkbox" ${notifications.siteReplies !== false ? 'checked' : ''} />
        </label>
        <label class="switch-row">
          <span><strong>邮件回复提醒</strong><small>有人回复评论时发送邮件</small></span>
          <input name="emailReplies" type="checkbox" ${notifications.emailReplies ? 'checked' : ''} />
        </label>
        <label class="switch-row">
          <span><strong>系统通知</strong><small>账号状态或站点消息提醒</small></span>
          <input name="emailSystem" type="checkbox" ${notifications.emailSystem ? 'checked' : ''} />
        </label>
        <label class="switch-row">
          <span><strong>浏览器推送</strong><small>预留给前端 Web Push 集成</small></span>
          <input name="browserPush" type="checkbox" ${notifications.browserPush ? 'checked' : ''} />
        </label>
      </div>
      <div class="form-actions">
        <button class="primary-btn" type="submit">保存通知设置</button>
        <button class="ghost-btn" type="button" data-close-modal>取消</button>
      </div>
    </form>
  `);
}

async function renderAdminModal() {
  openModal('管理员面板', `
    <div class="admin-toolbar">
      <input id="adminSearch" type="search" placeholder="搜索用户、邮箱、UID" />
      <select id="adminRoleFilter">
        <option value="all">全部身份</option>
        <option value="admin">管理员</option>
        <option value="user">普通用户</option>
      </select>
      <select id="adminStatusFilter">
        <option value="all">全部状态</option>
        <option value="active">可用</option>
        <option value="blocked">停用</option>
      </select>
      <button id="adminRefresh" class="ghost-btn" type="button">刷新列表</button>
    </div>
    <div id="adminSummary" class="admin-summary" aria-label="用户概览"></div>
    <div id="adminTableWrap">正在加载用户...</div>
  `, { wide: true });

  await loadAdminUsers();
  document.querySelector('#adminRefresh').addEventListener('click', loadAdminUsers);
  document.querySelector('#adminSearch').addEventListener('input', (event) => {
    state.filter.query = event.target.value.trim().toLowerCase();
    renderAdminTable();
  });
  document.querySelector('#adminRoleFilter').addEventListener('change', (event) => {
    state.filter.role = event.target.value;
    renderAdminTable();
  });
  document.querySelector('#adminStatusFilter').addEventListener('change', (event) => {
    state.filter.status = event.target.value;
    renderAdminTable();
  });
}

async function loadAdminUsers() {
  try {
    const payload = await api('listUsers', { method: 'POST', body: {} });
    state.users = payload.users;
    renderAdminTable();
  } catch (error) {
    const wrap = document.querySelector('#adminTableWrap');
    if (wrap) wrap.innerHTML = `<p class="admin-error">${escapeHtml(error.message)}</p>`;
    showToast(error.message, true);
  }
}

function filteredUsers() {
  return state.users.filter((user) => {
    const queryTarget = `${user.displayName} ${user.username} ${user.email} ${user.uid} ${user.badgeLabel || ''} ${user.bio || ''} ${user.websiteUrl || ''} ${user.contactEmail || ''}`.toLowerCase();
    const matchesQuery = !state.filter.query || queryTarget.includes(state.filter.query);
    const matchesRole = state.filter.role === 'all' || user.role === state.filter.role;
    const matchesStatus = state.filter.status === 'all' || user.status === state.filter.status;
    return matchesQuery && matchesRole && matchesStatus;
  });
}

function renderAdminTable() {
  const wrap = document.querySelector('#adminTableWrap');
  if (!wrap) return;
  const users = filteredUsers();
  renderAdminSummary(users);
  if (!users.length) {
    wrap.innerHTML = '<p>没有符合条件的用户。</p>';
    return;
  }
  wrap.innerHTML = `
    <div class="user-table-wrap">
      <table class="user-table">
        <thead>
          <tr>
            <th>用户</th>
            <th>UID / 邮箱</th>
            <th>身份标签</th>
            <th>注册 / 登录</th>
            <th>身份 / 状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${users.map((user) => `
            <tr data-user-id="${escapeHtml(user.id)}">
              <td>
                <div class="user-line">
                  ${avatarHtml(user)}
                  <span><strong>${escapeHtml(user.displayName)}</strong><br />@${escapeHtml(user.username)}</span>
                </div>
              </td>
              <td>UID: ${escapeHtml(user.uid)}<br /><span class="muted-line">${escapeHtml(user.email)}</span><br /><span class="muted-line">ID: ${escapeHtml(user.id)}</span></td>
              <td>
                <div class="tag-editor">
                  <input data-badge-input="${escapeHtml(user.id)}" maxlength="20" value="${escapeHtml(user.badgeLabel || '')}" placeholder="例如：博主" />
                  <input data-badge-color="${escapeHtml(user.id)}" type="color" value="${escapeHtml(normalizeBadgeColor(user.badgeColor) || '#ff5f63')}" />
                  <button class="ghost-btn" type="button" data-save-badge="${escapeHtml(user.id)}">保存标签</button>
                </div>
              </td>
              <td>${escapeHtml(formatDate(user.createdAt))}<br /><span class="muted-line">最后登录：${escapeHtml(formatDate(user.lastLoginAt))}</span></td>
              <td><span class="status-pill ${user.role === 'admin' ? 'is-admin' : 'is-user'}">${user.role === 'admin' ? '管理员' : '普通用户'}</span><br /><span class="status-pill ${user.status === 'blocked' ? 'is-blocked' : 'is-active'}">${user.status === 'blocked' ? '停用' : '可用'}</span></td>
              <td>
                <div class="row-actions">
                  <button type="button" data-user-detail="${escapeHtml(user.id)}">详情</button>
                  <button type="button" data-toggle-role="${escapeHtml(user.id)}">${user.role === 'admin' ? '移除管理员' : '设为管理员'}</button>
                  <button type="button" data-toggle-status="${escapeHtml(user.id)}">${user.status === 'blocked' ? '启用' : '停用'}</button>
                  <button class="delete-user" type="button" data-delete="${escapeHtml(user.id)}">删除</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminSummary(users = state.users) {
  const target = document.querySelector('#adminSummary');
  if (!target) return;
  const admins = users.filter((user) => user.role === 'admin').length;
  const blocked = users.filter((user) => user.status === 'blocked').length;
  target.innerHTML = `
    <span><strong>${users.length}</strong><small>当前列表</small></span>
    <span><strong>${admins}</strong><small>管理员</small></span>
    <span><strong>${blocked}</strong><small>停用</small></span>
  `;
}

function renderUserDetailModal(user) {
  openModal('用户详情', `
    <div class="detail-list">
      <div>${avatarHtml(user, 'detail-avatar')}<strong>${escapeHtml(user.displayName)}</strong></div>
      <p><b>UID</b><span>${escapeHtml(user.uid)}</span></p>
      <p><b>ID</b><span>${escapeHtml(user.id)}</span></p>
      <p><b>用户名</b><span>@${escapeHtml(user.username)}</span></p>
      <p><b>邮箱</b><span>${escapeHtml(user.email)}</span></p>
      <p><b>头像外链</b><span>${escapeHtml(user.avatarUrl || '未设置')}</span></p>
      <p><b>个人简介</b><span>${escapeHtml(user.bio || '未设置')}</span></p>
      <p><b>个人网站</b><span>${escapeHtml(user.websiteUrl || '未设置')}</span></p>
      <p><b>联系邮箱</b><span>${escapeHtml(user.contactEmail || '未设置')}</span></p>
      <p><b>身份标签</b><span>${escapeHtml(user.badgeLabel || '未设置')}</span></p>
      <p><b>标签颜色</b><span>${escapeHtml(user.badgeColor || '未设置')}</span></p>
      <p><b>身份</b><span>${user.role === 'admin' ? '管理员' : '普通用户'}</span></p>
      <p><b>状态</b><span>${user.status === 'blocked' ? '停用' : '可用'}</span></p>
      <p><b>注册时间</b><span>${escapeHtml(formatDate(user.createdAt))}</span></p>
      <p><b>最后登录</b><span>${escapeHtml(formatDate(user.lastLoginAt))}</span></p>
    </div>
  `);
}

async function updateAdminUser(user, updates) {
  const payload = await api('updateUser', { method: 'POST', body: { id: user.id, ...updates } });
  if (state.currentUser.id === payload.user.id) state.currentUser = payload.user;
  await loadAdminUsers();
  updateShell();
}

async function handleAdminTableAction(event) {
  const roleButton = event.target.closest('[data-toggle-role]');
  const statusButton = event.target.closest('[data-toggle-status]');
  const deleteButton = event.target.closest('[data-delete]');
  const detailButton = event.target.closest('[data-user-detail]');
  const badgeButton = event.target.closest('[data-save-badge]');
  const userId = roleButton?.dataset.toggleRole || statusButton?.dataset.toggleStatus || deleteButton?.dataset.delete || detailButton?.dataset.userDetail || badgeButton?.dataset.saveBadge;
  if (!userId) return false;

  const user = state.users.find((item) => item.id === userId);
  if (!user) return true;

  if (detailButton) {
    renderUserDetailModal(user);
    return true;
  }
  if (roleButton) {
    await updateAdminUser(user, { role: user.role === 'admin' ? 'user' : 'admin' });
    showToast('用户身份已更新。');
    return true;
  }
  if (badgeButton) {
    const input = document.querySelector(`[data-badge-input="${CSS.escape(user.id)}"]`);
    const colorInput = document.querySelector(`[data-badge-color="${CSS.escape(user.id)}"]`);
    await updateAdminUser(user, { badgeLabel: input?.value.trim() || '', badgeColor: colorInput?.value || '' });
    showToast('身份标签已保存。');
    return true;
  }
  if (statusButton) {
    await updateAdminUser(user, { status: user.status === 'blocked' ? 'active' : 'blocked' });
    showToast('用户状态已更新。');
    return true;
  }
  if (deleteButton && confirm(`确认删除 ${user.displayName} 吗？`)) {
    await api('deleteUser', { method: 'POST', body: { id: user.id } });
    await loadAdminUsers();
    showToast('用户已删除。');
  }
  return true;
}

async function saveAccountForm(form) {
  if (form.id === 'editProfileForm') {
    const payload = await api('updateProfile', { method: 'POST', body: { ...state.credentials, ...formData(form) } });
    state.currentUser = payload.user;
    updateShell();
    showToast('资料已更新。');
    return true;
  }
  if (form.id === 'passwordForm') {
    const body = { email: state.credentials?.email, ...formData(form) };
    const payload = await api('changePassword', { method: 'POST', body });
    state.currentUser = payload.user;
    if (state.credentials) state.credentials.password = body.newPassword;
    updateShell();
    showToast('密码已更新。');
    return true;
  }
  if (form.id === 'noticeForm') {
    const data = formData(form);
    const payload = await api('updateProfile', {
      method: 'POST',
      body: {
        ...state.credentials,
        notifications: {
          siteReplies: data.siteReplies === 'on',
          emailReplies: data.emailReplies === 'on',
          emailSystem: data.emailSystem === 'on',
          browserPush: data.browserPush === 'on',
        },
      },
    });
    state.currentUser = payload.user;
    updateShell();
    showToast('通知设置已保存。');
    return true;
  }
  return false;
}

els.authSwitchBtn?.addEventListener('click', () => {
  setAuthMode(els.authSwitchBtn.dataset.authMode);
});

els.authTabs.forEach((tab) => {
  tab.addEventListener('click', () => setAuthMode(tab.dataset.authTab));
});

els.authEmailForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await showPasswordStep(event.submitter || els.authEmailForm.querySelector('button'));
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelectorAll('[data-back-email]').forEach((button) => {
  button.addEventListener('click', () => {
    els.authEmailForm.classList.remove('hidden');
    els.authCodeForm.classList.add('hidden');
    els.authPasswordForm.classList.add('hidden');
    els.authRegisterForm.classList.add('hidden');
    els.authResetForm.classList.add('hidden');
    els.authEmailInput.focus();
  });
});

document.querySelectorAll('[data-auth-forgot]').forEach((button) => {
  button.addEventListener('click', async () => {
    state.authMode = 'reset';
    state.authEmail = state.authEmail || els.authEmailInput.value.trim().toLowerCase();
    if (!state.authEmail) {
      setAuthMode('reset');
      return;
    }
    try {
      await requestCodeStep(button, 'reset');
    } catch (error) {
      showToast(error.message, true);
    }
  });
});

els.authCodeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter || els.authCodeForm.querySelector('button');
  submitter.disabled = true;
  try {
    const code = formData(els.authCodeForm).code;
    const displayName = makeUsernameFromEmail(state.authEmail);
    const result = await api('verifyCode', {
      method: 'POST',
      body: {
        email: state.authEmail,
        code,
        username: displayName,
        displayName,
      },
    });
    setAuthenticated(result);
    updateShell();
    if (!state.commentAuth) showToast('已登录。');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

els.authPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  submitter.disabled = true;
  try {
    const captcha = await runCaptchaChallenge();
    await login({ email: state.authEmail, password: formData(els.authPasswordForm).password, captcha });
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

els.authRegisterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  submitter.disabled = true;
  try {
    const body = { ...formData(els.authRegisterForm), email: state.authEmail };
    const result = await api('registerWithCode', { method: 'POST', body });
    setAuthenticated(result);
    updateShell();
    if (!state.commentAuth) showToast('注册成功，已进入用户中心。');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

els.authResetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  submitter.disabled = true;
  try {
    const body = { ...formData(els.authResetForm), email: state.authEmail };
    const result = await api('resetPassword', { method: 'POST', body });
    setAuthenticated(result);
    updateShell();
    if (!state.commentAuth) showToast('密码已重置，已进入用户中心。');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

els.actionGrid.addEventListener('click', (event) => {
  const action = event.target.closest('[data-route]');
  if (action) window.location.href = action.dataset.route;
});

els.logoutBtn.addEventListener('click', () => {
  state.currentUser = null;
  state.credentials = null;
  state.sessionToken = '';
  state.users = [];
  state.commentAuthorizePromptShown = false;
  state.commentAuthCompleted = false;
  clearStoredSession();
  updateShell();
  showToast('已退出登录。');
});

els.routeView.addEventListener('click', async (event) => {
  try {
    if (event.target.closest('[data-mark-all-notifications]')) {
      await api('markNotifications', { method: 'POST', body: { all: true } });
      await renderNotificationsPage();
      showToast('通知已全部标为已读。');
      return;
    }
    await handleAdminTableAction(event);
  } catch (error) {
    showToast(error.message, true);
  }
});

els.routeView.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  if (submitter) submitter.disabled = true;
  try {
    await saveAccountForm(event.target);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (submitter) submitter.disabled = false;
  }
});

els.modalRoot.addEventListener('click', async (event) => {
  if (event.target === els.modalRoot || event.target.closest('[data-close-modal]')) {
    closeModal();
    return;
  }

  const roleButton = event.target.closest('[data-toggle-role]');
  const statusButton = event.target.closest('[data-toggle-status]');
  const deleteButton = event.target.closest('[data-delete]');
  const detailButton = event.target.closest('[data-user-detail]');
  const userId = roleButton?.dataset.toggleRole || statusButton?.dataset.toggleStatus || deleteButton?.dataset.delete || detailButton?.dataset.userDetail;
  if (!userId) return;

  const user = state.users.find((item) => item.id === userId);
  if (!user) return;

  try {
    if (detailButton) {
      renderUserDetailModal(user);
      return;
    }
    if (roleButton) {
      await updateAdminUser(user, { role: user.role === 'admin' ? 'user' : 'admin' });
      showToast('用户身份已更新。');
    }
    if (statusButton) {
      await updateAdminUser(user, { status: user.status === 'blocked' ? 'active' : 'blocked' });
      showToast('用户状态已更新。');
    }
    if (deleteButton && confirm(`确认删除 ${user.displayName} 吗？`)) {
      await api('deleteUser', { method: 'POST', body: { id: user.id } });
      await loadAdminUsers();
      showToast('用户已删除。');
    }
  } catch (error) {
    showToast(error.message, true);
  }
});

els.modalRoot.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  submitter.disabled = true;
  try {
    if (event.target.id === 'editProfileForm') {
      const body = { ...state.credentials, ...formData(event.target) };
      const payload = await api('updateProfile', { method: 'POST', body });
      state.currentUser = payload.user;
      updateShell();
      closeModal();
      showToast('资料已更新。');
    }
    if (event.target.id === 'passwordForm') {
      const body = { email: state.credentials?.email, ...formData(event.target) };
      const payload = await api('changePassword', { method: 'POST', body });
      state.currentUser = payload.user;
      if (state.credentials) state.credentials.password = body.newPassword;
      updateShell();
      closeModal();
      showToast('密码已更新。');
    }
    if (event.target.id === 'noticeForm') {
      const data = formData(event.target);
      const body = {
        ...state.credentials,
        notifications: {
          siteReplies: data.siteReplies === 'on',
          emailReplies: data.emailReplies === 'on',
          emailSystem: data.emailSystem === 'on',
          browserPush: data.browserPush === 'on',
        },
      };
      const payload = await api('updateProfile', { method: 'POST', body });
      state.currentUser = payload.user;
      updateShell();
      closeModal();
      showToast('通知设置已保存。');
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-comment-authorize]')) authorizeCommentArea();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

window.addEventListener('message', (event) => {
  if (event.data?.type === 'ZEORA_TWIKOO_COMMENT_AUTH_ACK') {
    state.parentAuthorized = true;
  }
});

(async function boot() {
  document.body.classList.toggle('is-comment-auth', state.commentAuth);
  document.body.classList.toggle('is-public-profile', Boolean(state.publicProfileHandle));
  const siteTitle = document.querySelector('#authTitle');
  if (state.siteName && siteTitle) siteTitle.textContent = state.siteName;

  if (els.rememberMeInput) els.rememberMeInput.checked = state.rememberSession;

  try {
    await refreshHealth();
    if (state.publicProfileHandle) {
      if (state.sessionToken) {
        const storedUser = readStoredUser();
        if (storedUser) state.currentUser = storedUser;
        try {
          const payload = await api('me');
          state.currentUser = payload.user;
          persistSession(state.currentUser, state.sessionToken);
        } catch (error) {
          state.currentUser = null;
          state.sessionToken = '';
          clearStoredSession();
        }
      }
      await loadPublicProfile();
      return;
    }

    if (state.sessionToken) {
      const storedUser = readStoredUser();
      if (storedUser) {
        state.currentUser = storedUser;
        updateShell();
      }
      try {
        const payload = await api('me');
        state.currentUser = payload.user;
        persistSession(state.currentUser, state.sessionToken);
        updateShell();
        return;
      } catch (error) {
        state.sessionToken = '';
        clearStoredSession();
      }
    }
    els.authEmailInput.value = '';
    setAuthMode('login');
    updateShell();
  } catch (error) {
    if (state.publicProfileHandle) {
      await loadPublicProfile();
      return;
    }
    els.authEmailInput.value = '';
    setAuthMode('login');
    updateShell();
  }
})();
