const crypto = require('crypto');

const COLLECTION_NAME = process.env.DEMO_USERS_COLLECTION || 'twikoo_demo_users';
const DB_NAME = process.env.DEMO_MONGODB_DB || undefined;
const PASSWORD_ITERATIONS = 120000;
const MAX_AVATAR_LENGTH = 240000;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://blog.zeora.top',
  'https://blog.315996.com',
  'http://blog.315996.com',
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  'http://localhost:4011',
  'http://127.0.0.1:4011',
];

const memoryStore = global.__twikooUserDemoStore || {
  users: [],
  seeded: false,
};

global.__twikooUserDemoStore = memoryStore;

let mongoClientPromise;
let mongoIndexesReady = false;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function allowedOrigins() {
  return (process.env.DEMO_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;

  const origins = allowedOrigins();
  if (!origins.includes('*') && !origins.includes(origin)) return;

  res.setHeader('access-control-allow-origin', origins.includes('*') ? '*' : origin);
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-admin-token');
  res.setHeader('access-control-max-age', '86400');
  res.setHeader('vary', 'Origin');
}

function getRequestUrl(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url, `https://${host}`);
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function requireAdmin(req, body, url) {
  const configuredToken = process.env.DEMO_ADMIN_TOKEN;
  if (!configuredToken) return;

  const suppliedToken =
    req.headers['x-admin-token'] ||
    body.adminToken ||
    url.searchParams.get('adminToken');

  if (!safeCompare(suppliedToken, configuredToken)) {
    throw new HttpError(401, '管理员令牌不正确。');
  }
}

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeEmail(email) {
  return cleanString(email).toLowerCase();
}

function validateAvatarUrl(avatarUrl) {
  const value = cleanString(avatarUrl);
  if (!value) return '';
  if (value.length > MAX_AVATAR_LENGTH) {
    throw new HttpError(400, '头像链接太长，请换一个更短的图片外链。');
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  throw new HttpError(400, '头像只能填写 http(s) 图片外链。');
}

function validateRegistration(body) {
  const username = cleanString(body.username);
  const displayName = cleanString(body.displayName) || username;
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const avatarUrl = validateAvatarUrl(body.avatarUrl);

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    throw new HttpError(400, '用户名需要 3-32 位，只能包含字母、数字、下划线、点或短横线。');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, '邮箱格式不正确。');
  }
  if (displayName.length > 64) {
    throw new HttpError(400, '显示名称不能超过 64 个字符。');
  }
  if (password.length < 8) {
    throw new HttpError(400, '密码至少需要 8 位。');
  }

  return { username, usernameLower: username.toLowerCase(), displayName, email, emailLower: email, password, avatarUrl };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const passwordHash = crypto
    .pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, 'sha256')
    .toString('hex');

  return { salt, passwordHash };
}

function verifyPassword(password, user) {
  const { passwordHash } = hashPassword(password, user.salt);
  return safeCompare(passwordHash, user.passwordHash);
}

function makeUid(user) {
  if (user.uid) return user.uid;
  const source = user.id || user.emailLower || user.email || user.username || crypto.randomUUID();
  return crypto.createHash('sha1').update(source).digest('base64url').slice(0, 5);
}

function createUid() {
  return crypto.randomBytes(4).toString('base64url').slice(0, 5);
}

async function createAvailableUid(collection) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const uid = createUid();
    if (collection) {
      const existing = await collection.findOne({ uid });
      if (!existing) return uid;
    } else {
      seedMemoryStore();
      if (!memoryStore.users.some((user) => user.uid === uid)) return uid;
    }
  }
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function defaultNotifications() {
  return {
    emailReplies: true,
    emailSystem: false,
    browserPush: false,
  };
}

function toPublicUser(user) {
  return {
    id: user.id,
    uid: makeUid(user),
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl || '',
    role: user.role || 'user',
    status: user.status || 'active',
    notifications: user.notifications || defaultNotifications(),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function seedMemoryStore() {
  if (memoryStore.seeded || memoryStore.users.length) return;
  const now = new Date().toISOString();
  const first = hashPassword('twikoo-demo-admin');
  const second = hashPassword('twikoo-demo-user');

  memoryStore.users.push(
    {
      id: crypto.randomUUID(),
      uid: '7PLg',
      username: 'zeora',
      usernameLower: 'zeora',
      displayName: 'zeora',
      email: 'zeora315@foxmail.com',
      emailLower: 'zeora315@foxmail.com',
      avatarUrl: '',
      role: 'admin',
      status: 'active',
      notifications: defaultNotifications(),
      createdAt: now,
      updatedAt: now,
      ...first,
    },
    {
      id: crypto.randomUUID(),
      uid: 'L2mQ9',
      username: 'commenter-lin',
      usernameLower: 'commenter-lin',
      displayName: '林同学',
      email: 'lin@example.com',
      emailLower: 'lin@example.com',
      avatarUrl: '',
      role: 'user',
      status: 'active',
      notifications: defaultNotifications(),
      createdAt: now,
      updatedAt: now,
      ...second,
    }
  );
  memoryStore.seeded = true;
}

async function getMongoCollection() {
  if (!process.env.MONGODB_URI) return null;

  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch (error) {
    throw new HttpError(500, '当前环境缺少 mongodb 依赖，请重新安装依赖后再启用 MongoDB。');
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    mongoClientPromise = client.connect();
  }

  const client = await mongoClientPromise;
  const db = DB_NAME ? client.db(DB_NAME) : client.db();
  const collection = db.collection(COLLECTION_NAME);

  if (!mongoIndexesReady) {
    await Promise.all([
      collection.createIndex({ id: 1 }, { unique: true }),
      collection.createIndex({ uid: 1 }, { unique: true }),
      collection.createIndex({ emailLower: 1 }, { unique: true }),
      collection.createIndex({ usernameLower: 1 }, { unique: true }),
    ]);
    mongoIndexesReady = true;
  }

  return collection;
}

async function listUsers(collection) {
  if (collection) {
    const users = await collection.find({}, { projection: { _id: 0, passwordHash: 0, salt: 0 } }).sort({ createdAt: -1 }).toArray();
    return users.map(toPublicUser);
  }

  seedMemoryStore();
  return [...memoryStore.users].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toPublicUser);
}

async function findUserByEmail(collection, emailLower) {
  if (collection) return collection.findOne({ emailLower });
  seedMemoryStore();
  return memoryStore.users.find((user) => user.emailLower === emailLower);
}

async function registerUser(collection, body) {
  const input = validateRegistration(body);
  const now = new Date().toISOString();
  const passwordFields = hashPassword(input.password);
  const uid = await createAvailableUid(collection);
  const user = {
    id: crypto.randomUUID(),
    uid,
    username: input.username,
    usernameLower: input.usernameLower,
    displayName: input.displayName,
    email: input.email,
    emailLower: input.emailLower,
    avatarUrl: input.avatarUrl,
    role: 'user',
    status: 'active',
    notifications: defaultNotifications(),
    createdAt: now,
    updatedAt: now,
    ...passwordFields,
  };

  if (collection) {
    try {
      await collection.insertOne(user);
    } catch (error) {
      if (error.code === 11000) throw new HttpError(409, '用户名或邮箱已经存在。');
      throw error;
    }
    return toPublicUser(user);
  }

  seedMemoryStore();
  if (memoryStore.users.some((item) => item.emailLower === user.emailLower || item.usernameLower === user.usernameLower || item.uid === user.uid)) {
    throw new HttpError(409, '用户名或邮箱已经存在。');
  }
  memoryStore.users.push(user);
  return toPublicUser(user);
}

async function loginUser(collection, body) {
  const emailLower = normalizeEmail(body.email);
  const password = String(body.password || '');
  const user = await findUserByEmail(collection, emailLower);

  if (!user || !verifyPassword(password, user)) {
    throw new HttpError(401, '邮箱或密码不正确。');
  }
  if (user.status === 'blocked') {
    throw new HttpError(403, '该用户已被管理员停用。');
  }

  const now = new Date().toISOString();
  if (collection) {
    await collection.updateOne({ id: user.id }, { $set: { lastLoginAt: now, updatedAt: now } });
  } else {
    user.lastLoginAt = now;
    user.updatedAt = now;
  }

  return toPublicUser({ ...user, lastLoginAt: now, updatedAt: now });
}

function pickUserUpdates(body, allowRoleStatus) {
  const updates = {};

  if (body.displayName !== undefined) {
    const displayName = cleanString(body.displayName);
    if (!displayName || displayName.length > 64) throw new HttpError(400, '显示名称需要 1-64 个字符。');
    updates.displayName = displayName;
  }
  if (body.avatarUrl !== undefined) updates.avatarUrl = validateAvatarUrl(body.avatarUrl);
  if (!allowRoleStatus && body.notifications !== undefined) {
    const current = typeof body.notifications === 'object' && body.notifications ? body.notifications : {};
    updates.notifications = {
      emailReplies: Boolean(current.emailReplies),
      emailSystem: Boolean(current.emailSystem),
      browserPush: Boolean(current.browserPush),
    };
  }
  if (allowRoleStatus && body.role !== undefined) {
    if (!['user', 'admin'].includes(body.role)) throw new HttpError(400, '角色只能是 user 或 admin。');
    updates.role = body.role;
  }
  if (allowRoleStatus && body.status !== undefined) {
    if (!['active', 'blocked'].includes(body.status)) throw new HttpError(400, '状态只能是 active 或 blocked。');
    updates.status = body.status;
  }

  if (!Object.keys(updates).length) throw new HttpError(400, '没有可更新的字段。');
  updates.updatedAt = new Date().toISOString();
  return updates;
}

async function updateUser(collection, id, updates) {
  if (!id) throw new HttpError(400, '缺少用户 ID。');

  if (collection) {
    const result = await collection.findOneAndUpdate(
      { id },
      { $set: updates },
      { returnDocument: 'after', projection: { _id: 0, passwordHash: 0, salt: 0 } }
    );
    if (!result) throw new HttpError(404, '用户不存在。');
    return toPublicUser(result);
  }

  seedMemoryStore();
  const user = memoryStore.users.find((item) => item.id === id);
  if (!user) throw new HttpError(404, '用户不存在。');
  Object.assign(user, updates);
  return toPublicUser(user);
}

async function updateProfile(collection, body) {
  const emailLower = normalizeEmail(body.email);
  const password = String(body.password || '');
  const user = await findUserByEmail(collection, emailLower);

  if (!user || !verifyPassword(password, user)) {
    throw new HttpError(401, '邮箱或密码不正确。');
  }

  const updates = pickUserUpdates(body, false);
  return updateUser(collection, user.id, updates);
}

async function changePassword(collection, body) {
  const emailLower = normalizeEmail(body.email);
  const currentPassword = String(body.currentPassword || body.password || '');
  const newPassword = String(body.newPassword || '');
  const user = await findUserByEmail(collection, emailLower);

  if (!user || !verifyPassword(currentPassword, user)) {
    throw new HttpError(401, '当前密码不正确。');
  }
  if (newPassword.length < 8) {
    throw new HttpError(400, '新密码至少需要 8 位。');
  }

  const updates = {
    ...hashPassword(newPassword),
    updatedAt: new Date().toISOString(),
  };

  if (collection) {
    await collection.updateOne({ id: user.id }, { $set: updates });
  } else {
    Object.assign(user, updates);
  }

  return toPublicUser({ ...user, ...updates });
}

async function deleteUser(collection, id) {
  if (!id) throw new HttpError(400, '缺少用户 ID。');

  if (collection) {
    const result = await collection.deleteOne({ id });
    if (!result.deletedCount) throw new HttpError(404, '用户不存在。');
    return { id };
  }

  seedMemoryStore();
  const index = memoryStore.users.findIndex((user) => user.id === id);
  if (index === -1) throw new HttpError(404, '用户不存在。');
  memoryStore.users.splice(index, 1);
  return { id };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = getRequestUrl(req);
  const action = url.searchParams.get('action') || 'health';
  const needsBody = !['GET', 'HEAD'].includes(req.method);
  const body = needsBody ? await readBody(req) : {};
  const collection = await getMongoCollection();
  const storageMode = collection ? 'mongodb' : 'memory';

  if (action === 'health' && req.method === 'GET') {
    send(res, 200, {
      ok: true,
      storageMode,
      adminProtected: Boolean(process.env.DEMO_ADMIN_TOKEN),
      collection: collection ? COLLECTION_NAME : null,
    });
    return;
  }

  if (action === 'listUsers' && req.method === 'GET') {
    requireAdmin(req, body, url);
    send(res, 200, { ok: true, users: await listUsers(collection), storageMode });
    return;
  }

  if (action === 'register' && req.method === 'POST') {
    send(res, 201, { ok: true, user: await registerUser(collection, body) });
    return;
  }

  if (action === 'login' && req.method === 'POST') {
    send(res, 200, { ok: true, user: await loginUser(collection, body) });
    return;
  }

  if (action === 'updateProfile' && req.method === 'POST') {
    send(res, 200, { ok: true, user: await updateProfile(collection, body) });
    return;
  }

  if (action === 'changePassword' && req.method === 'POST') {
    send(res, 200, { ok: true, user: await changePassword(collection, body) });
    return;
  }

  if (action === 'updateUser' && req.method === 'POST') {
    requireAdmin(req, body, url);
    const updates = pickUserUpdates(body, true);
    send(res, 200, { ok: true, user: await updateUser(collection, body.id, updates) });
    return;
  }

  if (action === 'deleteUser' && req.method === 'POST') {
    requireAdmin(req, body, url);
    send(res, 200, { ok: true, deleted: await deleteUser(collection, body.id) });
    return;
  }

  throw new HttpError(404, '未知的 demo API 操作。');
}

module.exports = async function demoUsersApi(req, res) {
  setCorsHeaders(req, res);

  try {
    await handle(req, res);
  } catch (error) {
    const status = error.status || 500;
    send(res, status, {
      ok: false,
      message: status >= 500 ? '服务器处理失败，请检查部署日志。' : error.message,
      detail: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};
