const SESSION_TOKEN_KEY = 'twikooDemoSessionToken';
const params = new URLSearchParams(window.location.search);

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
  siteName: params.get('site') || '',
  filter: { query: '', role: 'all', status: 'all' },
};

const els = {
  authView: document.querySelector('#authView'),
  centerView: document.querySelector('#centerView'),
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
  roleBadge: document.querySelector('#roleBadge'),
  actionGrid: document.querySelector('.action-grid'),
  adminCard: document.querySelector('#adminCard'),
  logoutBtn: document.querySelector('#logoutBtn'),
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
  els.authSwitchText.classList.toggle('hidden', state.commentAuth);
  if (!state.commentAuth) {
    els.authSwitchText.firstChild.textContent = mode === 'login' ? '没有账号？' : '已有账号？';
    els.authSwitchBtn.textContent = mode === 'login' ? '注册' : '登录';
    els.authSwitchBtn.dataset.authMode = mode === 'login' ? 'register' : 'login';
  }
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
  if (state.commentAuth) {
    await requestCodeStep(submitter);
    return;
  }

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
  const fetchOptions = { method: options.method || 'GET', headers };

  if (state.sessionToken) headers['x-session-token'] = state.sessionToken;
  if (state.adminToken) headers['x-admin-token'] = state.adminToken;
  if (options.body) {
    headers['content-type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(`/api/demo?action=${encodeURIComponent(action)}`, fetchOptions);
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

function updateShell() {
  const user = state.currentUser;
  if (!user) {
    els.authView.classList.remove('hidden');
    els.centerView.classList.add('hidden');
    document.querySelector('#commentAuthPanel')?.remove();
    closeModal();
    return;
  }

  els.authView.classList.add('hidden');
  els.centerView.classList.remove('hidden');
  setAvatar(els.profileAvatar, user);
  els.profileName.textContent = user.displayName;
  els.profileUid.textContent = `UID: ${user.uid || user.id.slice(0, 5)}`;
  els.profileJoined.textContent = `加入于 ${formatDate(user.createdAt)}`;
  els.profileEmail.textContent = user.email;
  els.roleBadge.classList.toggle('hidden', user.role !== 'admin');
  els.adminCard.classList.toggle('hidden', user.role !== 'admin');
  els.actionGrid.classList.toggle('hidden', state.commentAuth);
  if (state.commentAuth) {
    renderCommentAuthorization();
  } else {
    document.querySelector('#commentAuthPanel')?.remove();
  }
}

function renderCommentAuthorization() {
  let panel = document.querySelector('#commentAuthPanel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'commentAuthPanel';
    panel.className = 'comment-auth-panel';
    document.querySelector('.profile-hero')?.after(panel);
  }

  const user = state.currentUser;
  panel.innerHTML = `
    <div class="comment-auth-copy">
      <h2>授权评论区</h2>
      <p>${escapeHtml(state.siteName || '当前站点')} 将使用你的公开资料完成评论。</p>
    </div>
    <ul class="permission-list" aria-label="授权权限">
      <li>获取用户基本信息</li>
      <li>发送通知</li>
      <li>获取邮箱地址</li>
    </ul>
    <button class="primary-btn authorize-login-btn" type="button" data-comment-authorize>确认登录</button>
    <p class="comment-auth-account">当前账号：${escapeHtml(user.displayName)} · HeoID: ${escapeHtml(user.uid || user.id.slice(0, 5))}</p>
  `;
}

function authorizeCommentArea() {
  if (!state.currentUser || !state.sessionToken) {
    showToast('请先登录后再授权。', true);
    return;
  }

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
  if (state.parentOrigin) {
    setTimeout(() => {
      if (!state.parentAuthorized) window.parent.postMessage({ ...payload, fallback: true }, '*');
    }, 450);
  }
  showToast('已授权评论区。');
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
  if (state.sessionToken) localStorage.setItem(SESSION_TOKEN_KEY, state.sessionToken);
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
          <span>邮箱</span>
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
    const payload = await api('listUsers');
    state.users = payload.users;
    renderAdminTable();
  } catch (error) {
    showToast(error.message, true);
  }
}

function filteredUsers() {
  return state.users.filter((user) => {
    const queryTarget = `${user.displayName} ${user.username} ${user.email} ${user.uid}`.toLowerCase();
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
          <th>身份</th>
          <th>状态</th>
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
            <td>UID: ${escapeHtml(user.uid)}<br />${escapeHtml(user.email)}</td>
            <td><span class="status-pill ${user.role === 'admin' ? 'is-admin' : 'is-user'}">${user.role === 'admin' ? '管理员' : '无标签'}</span></td>
            <td><span class="status-pill ${user.status === 'blocked' ? 'is-blocked' : 'is-active'}">${user.status === 'blocked' ? '停用' : '可用'}</span></td>
            <td>
              <div class="row-actions">
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
    showToast('已登录，请确认授权。');
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
    showToast('注册成功，已进入用户中心。');
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
  localStorage.removeItem(SESSION_TOKEN_KEY);
  updateShell();
  showToast('已退出登录。');
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-comment-authorize]')) authorizeCommentArea();
});

els.modalRoot.addEventListener('click', async (event) => {
  if (event.target === els.modalRoot || event.target.closest('[data-close-modal]')) {
    closeModal();
    return;
  }

  const roleButton = event.target.closest('[data-toggle-role]');
  const statusButton = event.target.closest('[data-toggle-status]');
  const deleteButton = event.target.closest('[data-delete]');
  const userId = roleButton?.dataset.toggleRole || statusButton?.dataset.toggleStatus || deleteButton?.dataset.delete;
  if (!userId) return;

  const user = state.users.find((item) => item.id === userId);
  if (!user) return;

  try {
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
  const siteTitle = document.querySelector('#authTitle');
  if (state.siteName && siteTitle) siteTitle.textContent = state.siteName;

  try {
    await refreshHealth();
    if (state.sessionToken) {
      try {
        const payload = await api('me');
        state.currentUser = payload.user;
        updateShell();
        return;
      } catch (error) {
        state.sessionToken = '';
        localStorage.removeItem(SESSION_TOKEN_KEY);
      }
    }
    const twikooEmail = detectTwikooEmail();
    els.authEmailInput.value = twikooEmail || 'zeora315@foxmail.com';
    setAuthMode('login');
    updateShell();
  } catch (error) {
    els.authEmailInput.value = 'zeora315@foxmail.com';
    setAuthMode('login');
    updateShell();
  }
})();
