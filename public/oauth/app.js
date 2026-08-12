const SESSION_TOKEN_KEY = 'twikooUserCenterSessionToken';
const SESSION_USER_KEY = 'twikooUserCenterSessionUser';
const LEGACY_SESSION_TOKEN_KEY = 'twikooDemoSessionToken';
const LEGACY_SESSION_USER_KEY = 'twikooDemoSessionUser';
const params = new URLSearchParams(window.location.search);

function normalizeOrigin(value) {
  try {
    return value ? new URL(value).origin : '';
  } catch (error) {
    return '';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function makeUsernameFromEmail(email) {
  const localPart = String(email || '').split('@')[0] || 'user';
  return localPart.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 32).padEnd(3, '0');
}

let geetestLoaderPromise = null;

function loadScriptOnce(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('人机验证脚本加载失败，请检查网络后重试。'));
    document.head.appendChild(script);
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
  throw new Error(`暂不支持 ${state.captcha.provider || '当前'} 人机验证前端，请先切换为极验 Geetest。`);
}

function initials(user) {
  return String(user?.displayName || user?.username || '?').trim().slice(0, 2).toUpperCase();
}

function storedSessionToken() {
  return localStorage.getItem(SESSION_TOKEN_KEY) ||
    sessionStorage.getItem(SESSION_TOKEN_KEY) ||
    localStorage.getItem(LEGACY_SESSION_TOKEN_KEY) ||
    '';
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

const state = {
  currentUser: null,
  sessionToken: storedSessionToken(),
  rememberSession: !sessionStorage.getItem(SESSION_TOKEN_KEY),
  authEmail: '',
  authMode: 'login',
  parentOrigin: normalizeOrigin(params.get('origin')) || normalizeOrigin(document.referrer),
  parentAcked: false,
  sendingTimer: null,
  captcha: { enabled: false, provider: '' },
  siteName: params.get('site') || '当前博客',
};

const els = {
  loadingView: document.querySelector('#loadingView'),
  loginView: document.querySelector('#loginView'),
  consentView: document.querySelector('#consentView'),
  returningView: document.querySelector('#returningView'),
  siteNameTargets: document.querySelectorAll('[data-site-name]'),
  emailForm: document.querySelector('#emailForm'),
  passwordForm: document.querySelector('#passwordForm'),
  registerForm: document.querySelector('#registerForm'),
  resetForm: document.querySelector('#resetForm'),
  emailInput: document.querySelector('#emailInput'),
  rememberMeInput: document.querySelector('#rememberMeInput'),
  captchaStatus: document.querySelector('#captchaStatus'),
  modeTabs: document.querySelectorAll('[data-mode-tab]'),
  authorizeBtn: document.querySelector('#authorizeBtn'),
  retryReturnBtn: document.querySelector('#retryReturnBtn'),
  userAvatar: document.querySelector('#userAvatar'),
  userName: document.querySelector('#userName'),
  userUid: document.querySelector('#userUid'),
  pageTitle: document.querySelector('[data-page-title]'),
  message: document.querySelector('#message'),
};

function setPageTitle(title) {
  const label = title || '评论授权';
  if (els.pageTitle) els.pageTitle.textContent = label;
  document.title = `${label} - ${state.siteName}`;
}

function showMessage(message, isError = false) {
  els.message.textContent = message || '';
  els.message.classList.toggle('is-error', isError);
}

function showView(view) {
  [els.loadingView, els.loginView, els.consentView, els.returningView].forEach((node) => {
    node.classList.toggle('hidden', node !== view);
  });
  if (view === els.loadingView) setPageTitle('检查登录');
  if (view === els.consentView) setPageTitle('授权确认');
  if (view === els.returningView) setPageTitle('返回评论区');
  showMessage('');
}

async function refreshHealth() {
  const payload = await api('health');
  const captcha = payload.captcha || { enabled: false, provider: '' };
  state.captcha = captcha;
  if (els.captchaStatus) {
    els.captchaStatus.querySelector('span').textContent = captcha.provider ? `站点人机验证已启用：${captcha.provider}` : '站点人机验证已启用';
    els.captchaStatus.classList.toggle('hidden', !captcha.enabled);
  }
}

async function api(action, options = {}) {
  const headers = {};
  const method = options.method || 'GET';
  const url = new URL('/api/demo', window.location.origin);
  url.searchParams.set('action', action);
  const fetchOptions = { method, headers };

  if (state.sessionToken) headers['x-session-token'] = state.sessionToken;
  if (state.sessionToken && method === 'GET') url.searchParams.set('sessionToken', state.sessionToken);
  if (options.body) {
    headers['content-type'] = 'application/json';
    fetchOptions.body = JSON.stringify({
      ...options.body,
      ...(state.sessionToken ? { sessionToken: state.sessionToken } : {}),
    });
  }

  const response = await fetch(url.toString(), fetchOptions);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.message || '请求失败，请稍后再试。');
  return payload;
}

function setAvatar(user) {
  if (user?.avatarUrl) {
    els.userAvatar.innerHTML = `<img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.displayName || user.username)} 的头像" />`;
  } else {
    els.userAvatar.textContent = initials(user);
  }
}

function renderConsent() {
  const user = state.currentUser;
  els.userName.textContent = user.displayName || user.username;
  els.userUid.textContent = `UID: ${user.uid || String(user.id || '').slice(0, 8)}`;
  setAvatar(user);
  els.authorizeBtn.disabled = false;
  showView(els.consentView);
}

function setAuthMode(mode) {
  state.authMode = mode;
  els.emailForm.classList.remove('hidden');
  els.passwordForm.classList.add('hidden');
  els.registerForm.classList.add('hidden');
  els.resetForm.classList.add('hidden');
  els.modeTabs.forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.modeTab === mode);
  });
  if (!els.loginView.classList.contains('hidden')) {
    setPageTitle(mode === 'register' ? '注册' : mode === 'reset' ? '重置密码' : '登录');
  }
  requestAnimationFrame(() => els.emailInput.focus());
}

function showLogin() {
  showView(els.loginView);
  setAuthMode(state.authMode);
}

async function login(credentials, silent = false) {
  const result = await api('login', { method: 'POST', body: credentials });
  state.currentUser = result.user;
  state.sessionToken = result.sessionToken || state.sessionToken;
  persistSession(state.currentUser, state.sessionToken);
  if (!silent) showMessage('登录成功，请确认授权。');
  renderConsent();
}

async function sendEmailCode(purpose, submitter) {
  submitter.disabled = true;
  try {
    const captcha = await runCaptchaChallenge();
    await api('requestCode', { method: 'POST', body: { email: state.authEmail, purpose, captcha } });
    showMessage('验证码已发送，请检查邮箱。');
  } finally {
    submitter.disabled = false;
  }
}

function storeAuthenticatedResult(result, message) {
  state.currentUser = result.user;
  state.sessionToken = result.sessionToken || state.sessionToken;
  persistSession(state.currentUser, state.sessionToken);
  showMessage(message);
  renderConsent();
}

function postToParent(payload) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage(payload, state.parentOrigin || '*');
  } catch (error) {
    window.parent.postMessage(payload, '*');
  }

  if (state.parentOrigin) {
    window.setTimeout(() => {
      if (!state.parentAcked) window.parent.postMessage({ ...payload, fallback: true }, '*');
    }, 80);
  }
}

function sendAuthorization() {
  if (!state.currentUser || !state.sessionToken) {
    showMessage('请先登录后再授权。', true);
    showLogin();
    return;
  }

  els.authorizeBtn.disabled = true;
  state.parentAcked = false;
  showView(els.returningView);

  const payload = {
    type: 'ZEORA_TWIKOO_COMMENT_AUTH',
    user: state.currentUser,
    sessionToken: state.sessionToken,
    source: 'oauth',
    sentAt: Date.now(),
  };

  let attempts = 0;
  clearInterval(state.sendingTimer);
  const sendOnce = () => {
    attempts += 1;
    postToParent(payload);
    if (state.parentAcked || attempts >= 14) {
      clearInterval(state.sendingTimer);
      state.sendingTimer = null;
      if (!state.parentAcked) showMessage('如果没有自动返回，请点击“重试返回”。', true);
    }
  };

  sendOnce();
  state.sendingTimer = setInterval(sendOnce, 240);
}

function cancelAuthorization() {
  postToParent({ type: 'ZEORA_TWIKOO_COMMENT_AUTH_CANCEL', source: 'oauth' });
}

els.emailForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  state.authEmail = els.emailInput.value.trim().toLowerCase();
  if (!state.authEmail) return;

  const submitter = event.submitter || els.emailForm.querySelector('button');
  try {
    els.emailForm.classList.add('hidden');
    if (state.authMode === 'login') {
      els.passwordForm.classList.remove('hidden');
      els.passwordForm.password.focus();
      return;
    }

    if (state.authMode === 'register') {
      await sendEmailCode('register', submitter);
      els.registerForm.classList.remove('hidden');
      els.registerForm.username.value = makeUsernameFromEmail(state.authEmail);
      els.registerForm.displayName.value = els.registerForm.displayName.value || makeUsernameFromEmail(state.authEmail);
      els.registerForm.code.focus();
      return;
    }

    await sendEmailCode('reset', submitter);
    els.resetForm.classList.remove('hidden');
    els.resetForm.code.focus();
  } catch (error) {
    els.emailForm.classList.remove('hidden');
    showMessage(error.message, true);
  }
});

document.querySelectorAll('[data-back-email]').forEach((button) => {
  button.addEventListener('click', () => {
    els.emailForm.classList.remove('hidden');
    els.passwordForm.classList.add('hidden');
    els.registerForm.classList.add('hidden');
    els.resetForm.classList.add('hidden');
    els.emailInput.focus();
  });
});

els.passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter || els.passwordForm.querySelector('button');
  submitter.disabled = true;
  try {
    const captcha = await runCaptchaChallenge();
    await login({ email: state.authEmail, password: formData(els.passwordForm).password, captcha });
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

els.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter || els.registerForm.querySelector('button');
  submitter.disabled = true;
  try {
    const body = { ...formData(els.registerForm), email: state.authEmail };
    const result = await api('registerWithCode', { method: 'POST', body });
    storeAuthenticatedResult(result, '注册成功，请确认授权。');
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

els.resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter || els.resetForm.querySelector('button');
  submitter.disabled = true;
  try {
    const body = { ...formData(els.resetForm), email: state.authEmail };
    const result = await api('resetPassword', { method: 'POST', body });
    storeAuthenticatedResult(result, '密码已重置，请确认授权。');
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

els.modeTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    setAuthMode(tab.dataset.modeTab);
  });
});

els.authorizeBtn.addEventListener('click', sendAuthorization);
els.retryReturnBtn.addEventListener('click', sendAuthorization);

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'ZEORA_TWIKOO_COMMENT_AUTH_ACK') return;
  state.parentAcked = true;
  clearInterval(state.sendingTimer);
  state.sendingTimer = null;
});

(async function boot() {
  setPageTitle('评论授权');
  els.siteNameTargets.forEach((node) => {
    node.textContent = state.siteName;
  });

  if (els.rememberMeInput) els.rememberMeInput.checked = state.rememberSession;

  try {
    await refreshHealth();
    if (state.sessionToken) {
      const storedUser = readStoredUser();
      if (storedUser) {
        state.currentUser = storedUser;
        renderConsent();
      }
      const payload = await api('me');
      state.currentUser = payload.user;
      persistSession(state.currentUser, state.sessionToken);
      renderConsent();
      return;
    }
  } catch (error) {
    state.currentUser = null;
    state.sessionToken = '';
    clearStoredSession();
  }

  els.emailInput.value = '';
  showLogin();
})();
