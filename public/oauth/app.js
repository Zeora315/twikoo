const SESSION_TOKEN_KEY = 'twikooDemoSessionToken';
const SESSION_USER_KEY = 'twikooDemoSessionUser';
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

function initials(user) {
  return String(user?.displayName || user?.username || '?').trim().slice(0, 2).toUpperCase();
}

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_USER_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function persistSession(user, token) {
  if (token) localStorage.setItem(SESSION_TOKEN_KEY, token);
  if (user) localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
}

function clearStoredSession() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_USER_KEY);
}

const state = {
  currentUser: null,
  sessionToken: localStorage.getItem(SESSION_TOKEN_KEY) || '',
  authEmail: '',
  authMode: 'login',
  parentOrigin: normalizeOrigin(params.get('origin')) || normalizeOrigin(document.referrer),
  parentAcked: false,
  sendingTimer: null,
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
  emailInput: document.querySelector('#emailInput'),
  modeSwitch: document.querySelector('#modeSwitch'),
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
  els.modeSwitch.dataset.mode = mode === 'login' ? 'register' : 'login';
  els.modeSwitch.textContent = mode === 'login' ? '没有账号？注册' : '已有账号？登录';
  if (!els.loginView.classList.contains('hidden')) setPageTitle(mode === 'login' ? '登录' : '注册');
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

els.emailForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.authEmail = els.emailInput.value.trim().toLowerCase();
  if (!state.authEmail) return;

  els.emailForm.classList.add('hidden');
  if (state.authMode === 'login') {
    els.passwordForm.classList.remove('hidden');
    els.passwordForm.password.focus();
  } else {
    els.registerForm.classList.remove('hidden');
    els.registerForm.username.value = makeUsernameFromEmail(state.authEmail);
    els.registerForm.displayName.value = els.registerForm.displayName.value || makeUsernameFromEmail(state.authEmail);
    els.registerForm.password.focus();
  }
});

document.querySelectorAll('[data-back-email]').forEach((button) => {
  button.addEventListener('click', () => {
    els.emailForm.classList.remove('hidden');
    els.passwordForm.classList.add('hidden');
    els.registerForm.classList.add('hidden');
    els.emailInput.focus();
  });
});

els.passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter || els.passwordForm.querySelector('button');
  submitter.disabled = true;
  try {
    await login({ email: state.authEmail, password: formData(els.passwordForm).password });
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
    const result = await api('register', { method: 'POST', body });
    state.currentUser = result.user;
    state.sessionToken = result.sessionToken || state.sessionToken;
    persistSession(state.currentUser, state.sessionToken);
    showMessage('注册成功，请确认授权。');
    renderConsent();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

els.modeSwitch.addEventListener('click', () => {
  setAuthMode(els.modeSwitch.dataset.mode);
});

document.querySelector('[data-use-other]').addEventListener('click', () => {
  state.currentUser = null;
  state.sessionToken = '';
  clearStoredSession();
  showLogin();
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

  try {
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
