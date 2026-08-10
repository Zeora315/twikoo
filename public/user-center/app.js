const SESSION_TOKEN_KEY = 'twikooDemoSessionToken';
const SESSION_USER_KEY = 'twikooDemoSessionUser';
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

function normalizeOrigin(value) {
  try {
    return value ? new URL(value).origin : '';
  } catch (error) {
    return '';
  }
}

const state = {
  currentUser: null,
  credentials: null,
  sessionToken: localStorage.getItem(SESSION_TOKEN_KEY) || '',
  users: [],
  authMode: 'login',
  authEmail: '',
  adminProtected: false,
  adminToken: localStorage.getItem('twikooDemoAdminToken') || '',
  commentAuth: params.get('comment_auth') === '1',
  parentOrigin: normalizeOrigin(params.get('origin')) || normalizeOrigin(document.referrer),
  parentAuthorized: false,
  commentAuthCompleted: false,
  commentAuthSending: false,
  commentAuthorizePromptShown: false,
  authReturnTimer: null,
  siteName: params.get('site') || '',
  publicProfileHandle: readPublicProfileHandle(),
  filter: { query: '', role: 'all', status: 'all' },
};

const els = {
  authView: document.querySelector('#authView'),
  centerView: document.querySelector('#centerView'),
  publicProfileView: document.querySelector('#publicProfileView'),
  authTitle: document.querySelector('#authTitle'),
  authSwitchText: document.querySelector('#authSwitchText'),
  authSwitchBtn: document.querySelector('#authSwitchBtn'),
  authEmailForm: document.querySelector('#authEmailForm'),
  authCodeForm: document.querySelector('#authCodeForm'),
  authPasswordForm: document.querySelector('#authPasswordForm'),
  authRegisterForm: document.querySelector('#authRegisterForm'),
  authEmailInput: document.querySelector('#authEmailInput'),
  profileAvatar: document.querySelector('#profileAvatar'),
  profileName: document.querySelector('#profileName'),
  profileUid: document.querySelector('#profileUid'),
  profileJoined: document.querySelector('#profileJoined'),
  profileEmail: document.querySelector('#profileEmail'),
  profileHero: document.querySelector('.profile-hero'),
  roleBadge: document.querySelector('#roleBadge'),
  actionGrid: document.querySelector('.action-grid'),
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
  els.authTitle.textContent = mode === 'login' ? '登录' : '注册';
  els.authSwitchText.classList.remove('hidden');
  els.authSwitchText.firstChild.textContent = mode === 'login' ? '没有账号？' : '已有账号？';
  els.authSwitchBtn.textContent = mode === 'login' ? '注册' : '登录';
  els.authSwitchBtn.dataset.authMode = mode === 'login' ? 'register' : 'login';
  requestAnimationFrame(() => els.authEmailInput.focus());
}

function makeUsernameFromEmail(email) {
  const localPart = email.split('@')[0] || 'user';
  return localPart.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 32).padEnd(3, '0');
}

async function requestCodeStep(submitter) {
  if (submitter) submitter.disabled = true;
  try {
    await api('requestCode', { method: 'POST', body: { email: state.authEmail } });
    els.authEmailForm.classList.add('hidden');
    els.authCodeForm.classList.remove('hidden');
    els.authPasswordForm.classList.add('hidden');
    els.authRegisterForm.classList.add('hidden');
    els.authCodeForm.code.focus();
    showToast('验证码已发送，请检查邮箱。');
  } finally {
    if (submitter) submitter.disabled = false;
  }
}

async function showPasswordStep(submitter) {
  state.authEmail = els.authEmailInput.value.trim().toLowerCase();

  els.authEmailForm.classList.add('hidden');
  els.authCodeForm.classList.add('hidden');
  if (state.authMode === 'login') {
    els.authPasswordForm.classList.remove('hidden');
    els.authRegisterForm.classList.add('hidden');
    els.authPasswordForm.password.focus();
  } else {
    els.authPasswordForm.classList.add('hidden');
    els.authRegisterForm.classList.remove('hidden');
    els.authRegisterForm.username.value = makeUsernameFromEmail(state.authEmail);
    els.authRegisterForm.displayName.value = els.authRegisterForm.displayName.value || makeUsernameFromEmail(state.authEmail);
    els.authRegisterForm.password.focus();
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
    <a class="public-back" href="/admin" aria-label="返回用户中心">← HeoID</a>
    <article class="public-profile-card">
      ${avatarHtml(user, 'public-avatar')}
      <h1>${escapeHtml(user.displayName || user.username)}</h1>
      <p class="public-subtitle">${escapeHtml(user.bio || '这个人还没有填写个人简介')}</p>
      <div class="public-id-row" aria-label="用户身份">
        <span>@${escapeHtml(user.username)}</span>
      </div>
      <div class="public-actions">
        ${websiteUrl ? `<a class="public-primary" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener">立即访问个人网站</a>` : ''}
        ${contactEmail ? `<a class="public-secondary" href="mailto:${escapeHtml(contactEmail)}">联系我</a>` : ''}
      </div>
      ${state.currentUser && userMatchesHandle(state.currentUser, user.username)
        ? '<a class="public-primary" href="/admin">进入后台</a>'
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
      <a class="public-back" href="/admin" aria-label="返回用户中心">← HeoID</a>
      <article class="public-profile-card">
        <div class="public-avatar" aria-hidden="true">?</div>
        <h1>用户不存在</h1>
        <p class="public-subtitle">${escapeHtml(error.message)}</p>
      </article>
    `;
  }
}

function updateShell() {
  const user = state.currentUser;
  els.publicProfileView?.classList.add('hidden');
  if (!user) {
    els.authView.classList.remove('hidden');
    els.centerView.classList.add('hidden');
    document.querySelector('#commentAuthPanel')?.remove();
    els.profileHero?.classList.remove('hidden');
    els.actionGrid.classList.remove('hidden');
    closeModal();
    return;
  }

  els.authView.classList.add('hidden');
  els.centerView.classList.remove('hidden');
  els.commentCenterReturn?.classList.add('hidden');
  setAvatar(els.profileAvatar, user);
  els.profileName.textContent = user.displayName;
  els.profileUid.textContent = `UID: ${user.uid || user.id.slice(0, 5)}`;
  els.profileJoined.textContent = `加入于 ${formatDate(user.createdAt)}`;
  els.profileEmail.textContent = user.email;
  const existingBio = document.querySelector('#profileBio');
  if (existingBio) existingBio.textContent = user.bio || '还没有填写个人简介';
  els.roleBadge.classList.toggle('hidden', user.role !== 'admin');
  els.adminCard.classList.toggle('hidden', user.role !== 'admin');
  if (state.commentAuth) {
    closeModal();
    els.profileHero?.classList.add('hidden');
    els.actionGrid.classList.add('hidden');
    renderCommentAuthPanel();
  } else {
    els.profileHero?.classList.remove('hidden');
    els.actionGrid.classList.remove('hidden');
    document.querySelector('#commentAuthPanel')?.remove();
  }
}

function renderCommentAuthPanel() {
  if (!state.commentAuth || !state.currentUser) return;
  const user = state.currentUser;
  let panel = document.querySelector('#commentAuthPanel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'commentAuthPanel';
    panel.className = 'comment-auth-panel';
    els.centerView.prepend(panel);
  }
  const statusText = state.commentAuthSending
    ? '正在把登录状态同步到评论框。'
    : `${state.siteName || '当前博客'} 将使用你的昵称、头像和邮箱发表评论。`;
  panel.innerHTML = `
    <div class="comment-auth-kicker">授权登录</div>
    <h1>你即将登录到 ${escapeHtml(state.siteName || '当前博客')} 评论系统</h1>
    <div class="comment-auth-user">
      ${avatarHtml(user, 'consent-avatar')}
      <span>
        <strong>${escapeHtml(user.displayName || user.username)}</strong>
        <small>UID: ${escapeHtml(user.uid || user.id.slice(0, 5))}</small>
      </span>
    </div>
    <div class="permission-card" aria-label="应用权限">
      <p>此应用将获得以下权限</p>
      <ul class="permission-list">
        <li>获取用户基本信息</li>
        <li>发送通知</li>
        <li>获取邮箱地址</li>
      </ul>
    </div>
    <button class="authorize-login-btn" type="button" data-comment-authorize>${state.commentAuthSending ? '正在返回' : '确认登录'}</button>
    <button class="switch-account-btn" type="button" data-comment-switch-account>使用其他账户登录</button>
    <p id="commentAuthStatus" class="comment-auth-status">${escapeHtml(statusText)}</p>
  `;
}

function authorizeCommentArea() {
  if (!state.currentUser || !state.sessionToken) {
    showToast('请先登录后再授权。', true);
    return;
  }
  if (state.commentAuthSending) return;

  if (window.parent === window) {
    showToast('已登录，可回到评论区继续。');
    return;
  }

  state.parentAuthorized = false;
  state.commentAuthSending = true;
  state.commentAuthCompleted = false;
  const payload = {
    type: 'ZEORA_TWIKOO_COMMENT_AUTH',
    user: state.currentUser,
    sessionToken: state.sessionToken,
    source: 'user-center',
    sentAt: Date.now(),
  };

  let attempts = 0;
  clearInterval(state.authReturnTimer);
  renderCommentAuthPanel();
  const sendOnce = () => {
    attempts += 1;
    try {
      window.parent.postMessage(payload, state.parentOrigin || '*');
    } catch (error) {
      window.parent.postMessage(payload, '*');
    }
    if (state.parentOrigin) {
      window.setTimeout(() => {
        if (!state.parentAuthorized) window.parent.postMessage({ ...payload, fallback: true }, '*');
      }, 80);
    }
    if (state.parentAuthorized || attempts >= 24) {
      clearInterval(state.authReturnTimer);
      state.authReturnTimer = null;
      state.commentAuthSending = false;
      if (state.parentAuthorized) {
        state.commentAuthCompleted = true;
        return;
      }
      renderCommentAuthPanel();
      const status = document.querySelector('#commentAuthStatus');
      if (status) status.textContent = '如果没有自动返回，请再点一次“确认登录”。';
    }
  };

  sendOnce();
  state.authReturnTimer = setInterval(sendOnce, 220);
}

async function refreshHealth() {
  const health = await api('health');
  state.adminProtected = health.adminProtected;
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
        <button class="modal-close" type="button" data-close-modal aria-label="关闭弹窗">×</button>
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
        <option value="user">无标签用户</option>
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
    const queryTarget = `${user.displayName} ${user.username} ${user.email} ${user.uid} ${user.bio || ''} ${user.websiteUrl || ''} ${user.contactEmail || ''}`.toLowerCase();
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
    <table class="user-table">
      <thead>
        <tr>
          <th>用户</th>
          <th>UID / 邮箱</th>
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
            <td>${escapeHtml(formatDate(user.createdAt))}<br /><span class="muted-line">最后登录：${escapeHtml(formatDate(user.lastLoginAt))}</span></td>
            <td><span class="status-pill ${user.role === 'admin' ? 'is-admin' : 'is-user'}">${user.role === 'admin' ? '管理员' : '无标签'}</span><br /><span class="status-pill ${user.status === 'blocked' ? 'is-blocked' : 'is-active'}">${user.status === 'blocked' ? '停用' : '可用'}</span></td>
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
      <p><b>身份</b><span>${user.role === 'admin' ? '管理员' : '无标签用户'}</span></p>
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

els.authSwitchBtn.addEventListener('click', () => {
  setAuthMode(els.authSwitchBtn.dataset.authMode);
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
    els.authEmailInput.focus();
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
    await login({ email: state.authEmail, password: formData(els.authPasswordForm).password });
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
    await api('register', { method: 'POST', body });
    await login({ email: body.email, password: body.password });
    if (!state.commentAuth) showToast('注册成功，已进入用户中心。');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitter.disabled = false;
  }
});

els.actionGrid.addEventListener('click', (event) => {
  const action = event.target.closest('[data-panel]');
  if (action) openPanel(action.dataset.panel);
});

els.logoutBtn.addEventListener('click', () => {
  state.currentUser = null;
  state.credentials = null;
  state.sessionToken = '';
  state.users = [];
  state.commentAuthorizePromptShown = false;
  state.commentAuthCompleted = false;
  state.commentAuthSending = false;
  clearInterval(state.authReturnTimer);
  state.authReturnTimer = null;
  clearStoredSession();
  updateShell();
  showToast('已退出登录。');
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
  if (event.target.closest('[data-comment-switch-account]')) {
    state.currentUser = null;
    state.credentials = null;
    state.sessionToken = '';
    state.users = [];
    state.commentAuthorizePromptShown = false;
    state.commentAuthCompleted = false;
    state.commentAuthSending = false;
    clearInterval(state.authReturnTimer);
    state.authReturnTimer = null;
    clearStoredSession();
    setAuthMode('login');
    updateShell();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

window.addEventListener('message', (event) => {
  if (event.data?.type === 'ZEORA_TWIKOO_COMMENT_AUTH_ACK') {
    state.parentAuthorized = true;
    state.commentAuthCompleted = true;
    clearInterval(state.authReturnTimer);
    state.authReturnTimer = null;
  }
});

(async function boot() {
  document.body.classList.toggle('is-comment-auth', state.commentAuth);
  document.body.classList.toggle('is-public-profile', Boolean(state.publicProfileHandle));
  const siteTitle = document.querySelector('#authTitle');
  if (siteTitle) siteTitle.textContent = '登录';

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
          if (userMatchesHandle(state.currentUser, state.publicProfileHandle)) {
            window.location.replace('/admin');
            return;
          }
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
    const twikooEmail = detectTwikooEmail();
    els.authEmailInput.value = twikooEmail || 'zeora315@foxmail.com';
    setAuthMode('login');
    updateShell();
  } catch (error) {
    if (state.publicProfileHandle) {
      await loadPublicProfile();
      return;
    }
    els.authEmailInput.value = 'zeora315@foxmail.com';
    setAuthMode('login');
    updateShell();
  }
})();
