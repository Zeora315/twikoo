const crypto = require('crypto');

const COLLECTION_NAME = process.env.DEMO_USERS_COLLECTION || 'twikoo_demo_users';
const CODE_COLLECTION_NAME = process.env.DEMO_CODES_COLLECTION || `${COLLECTION_NAME}_codes`;
const DB_NAME = process.env.DEMO_MONGODB_DB || undefined;
const PASSWORD_ITERATIONS = 120000;
const MAX_AVATAR_LENGTH = 240000;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://blog.zeora.top',
  'https://blog.315996.com',
  'http://blog.315996.com',
  'http://localhost:4000',
  'http://127.0.0.1:4000',
  'http://localhost:4011',
  'http://127.0.0.1:4011',
  'http://localhost:4317',
  'http://127.0.0.1:4317',
];

const memoryStore = global.__twikooUserDemoStore || {
  users: [],
  codes: [],
  seeded: false,
};

if (!Array.isArray(memoryStore.users)) memoryStore.users = [];
if (!Array.isArray(memoryStore.codes)) memoryStore.codes = [];
global.__twikooUserDemoStore = memoryStore;

let mongoClientPromise;
let mongoIndexesReady = false;
let mongoCodeIndexesReady = false;

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
  res.setHeader('access-control-allow-headers', 'content-type,x-admin-token,x-session-token,authorization');
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

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeEmail(email) {
  return cleanString(email).toLowerCase();
}

function validateEmail(email) {
  const normalized = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new HttpError(400, '邮箱格式不正确。');
  }
  return normalized;
}

function validateAvatarUrl(avatarUrl) {
  const value = cleanString(avatarUrl);
  if (!value) return '';
  if (value.length > MAX_AVATAR_LENGTH) {
    throw new HttpError(400, '头像链接太长，请换一个更短的图片外链。');
  }
  if (/^https?:\/\//i.test(value)) return value;
  throw new HttpError(400, '头像只能填写 http(s) 图片外链。');
}

function makeUsernameFromEmail(email) {
  const localPart = normalizeEmail(email).split('@')[0] || 'user';
  const cleaned = localPart.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^[-_.]+|[-_.]+$/g, '');
  return (cleaned || 'user').slice(0, 28).padEnd(3, '0');
}

function validateRegistration(body) {
  const username = cleanString(body.username);
  const displayName = cleanString(body.displayName) || username;
  const email = validateEmail(body.email);
  const password = String(body.password || '');
  const avatarUrl = validateAvatarUrl(body.avatarUrl);

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    throw new HttpError(400, '用户名需要 3-32 位，只能包含字母、数字、下划线、点或短横线。');
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
  if (!user?.salt || !user?.passwordHash) return false;
  const { passwordHash } = hashPassword(password, user.salt);
  return safeCompare(passwordHash, user.passwordHash);
}

function hashCode(code, salt = crypto.randomBytes(16).toString('hex')) {
  const codeHash = crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
  return { salt, codeHash };
}

function verifyCodeHash(code, record) {
  const { codeHash } = hashCode(code, record.salt);
  return safeCompare(codeHash, record.codeHash);
}

function makeUid(user) {
  if (user.uid) return user.uid;
  return '0000';
}

function numericUid(uid) {
  return /^\d+$/.test(String(uid || '')) ? Number(uid) : 0;
}

async function createAvailableUid(collection) {
  let maxUid = 0;

  if (collection) {
    const users = await collection.find({ uid: { $regex: '^\\d+$' } }, { projection: { uid: 1, _id: 0 } }).toArray();
    maxUid = users.reduce((max, user) => Math.max(max, numericUid(user.uid)), 0);
    for (let next = maxUid + 1; next < maxUid + 10000; next += 1) {
      const uid = String(next).padStart(4, '0');
      if (!(await collection.findOne({ uid }))) return uid;
    }
  } else {
    seedMemoryStore();
    maxUid = memoryStore.users.reduce((max, user) => Math.max(max, numericUid(user.uid)), 0);
    for (let next = maxUid + 1; next < maxUid + 10000; next += 1) {
      const uid = String(next).padStart(4, '0');
      if (!memoryStore.users.some((user) => user.uid === uid)) return uid;
    }
  }

  throw new HttpError(500, 'UID 编号已用尽，请检查用户数据。');
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
  memoryStore.seeded = true;
}

async function getMongoDatabase() {
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
  return DB_NAME ? client.db(DB_NAME) : client.db();
}

async function getMongoCollection() {
  const db = await getMongoDatabase();
  if (!db) return null;

  const collection = db.collection(COLLECTION_NAME);

  if (!mongoIndexesReady) {
    await Promise.all([
      collection.createIndex({ id: 1 }, { unique: true }),
      collection.createIndex({ uid: 1 }, { unique: true }),
      collection.createIndex({ emailLower: 1 }, { unique: true }),
      collection.createIndex({ usernameLower: 1 }, { unique: true }),
      collection.createIndex({ role: 1 }),
    ]);
    mongoIndexesReady = true;
  }

  return collection;
}

async function getCodeCollection() {
  const db = await getMongoDatabase();
  if (!db) return null;

  const collection = db.collection(CODE_COLLECTION_NAME);

  if (!mongoCodeIndexesReady) {
    await Promise.all([
      collection.createIndex({ emailLower: 1, createdAt: -1 }),
      collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 }),
    ]);
    mongoCodeIndexesReady = true;
  }

  return collection;
}

async function countUsers(collection, filter = {}) {
  if (collection) return collection.countDocuments(filter);
  seedMemoryStore();
  return memoryStore.users.filter((user) => {
    return Object.entries(filter).every(([key, value]) => user[key] === value);
  }).length;
}

async function listUsers(collection) {
  if (collection) {
    const users = await collection.find({}, { projection: { _id: 0, passwordHash: 0, salt: 0 } }).sort({ uid: 1, createdAt: 1 }).toArray();
    return users.map(toPublicUser);
  }

  seedMemoryStore();
  return [...memoryStore.users].sort((a, b) => makeUid(a).localeCompare(makeUid(b))).map(toPublicUser);
}

async function findUserByEmail(collection, emailLower) {
  if (collection) return collection.findOne({ emailLower });
  seedMemoryStore();
  return memoryStore.users.find((user) => user.emailLower === emailLower);
}

async function findUserById(collection, id) {
  if (!id) return null;
  if (collection) return collection.findOne({ id });
  seedMemoryStore();
  return memoryStore.users.find((user) => user.id === id);
}

async function findUserByUsername(collection, usernameLower) {
  if (collection) return collection.findOne({ usernameLower });
  seedMemoryStore();
  return memoryStore.users.find((user) => user.usernameLower === usernameLower);
}

async function createUniqueUsername(collection, email) {
  const base = makeUsernameFromEmail(email);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt ? String(attempt + 1) : '';
    const username = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    if (!(await findUserByUsername(collection, username.toLowerCase()))) return username;
  }
  throw new HttpError(500, '无法生成可用用户名，请稍后再试。');
}

async function roleForNewUser(collection) {
  return (await countUsers(collection)) === 0 ? 'admin' : 'user';
}

async function persistNewUser(collection, user) {
  if (collection) {
    try {
      await collection.insertOne(user);
    } catch (error) {
      if (error.code === 11000) throw new HttpError(409, '用户名或邮箱已经存在。');
      throw error;
    }
    return user;
  }

  seedMemoryStore();
  if (memoryStore.users.some((item) => item.emailLower === user.emailLower || item.usernameLower === user.usernameLower || item.uid === user.uid)) {
    throw new HttpError(409, '用户名或邮箱已经存在。');
  }
  memoryStore.users.push(user);
  return user;
}

async function registerUser(collection, body) {
  const input = validateRegistration(body);
  const now = new Date().toISOString();
  const passwordFields = hashPassword(input.password);
  const uid = await createAvailableUid(collection);
  const role = await roleForNewUser(collection);
  const user = {
    id: crypto.randomUUID(),
    uid,
    username: input.username,
    usernameLower: input.usernameLower,
    displayName: input.displayName,
    email: input.email,
    emailLower: input.emailLower,
    avatarUrl: input.avatarUrl,
    role,
    status: 'active',
    notifications: defaultNotifications(),
    createdAt: now,
    updatedAt: now,
    ...passwordFields,
  };

  await persistNewUser(collection, user);
  return toPublicUser(user);
}

function sessionSecret() {
  return process.env.DEMO_SESSION_SECRET ||
    process.env.DEMO_ADMIN_TOKEN ||
    process.env.SMTP_PASS ||
    process.env.MONGODB_URI ||
    'twikoo-demo-local-session-secret';
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function signSession(user) {
  const payload = encodePayload({
    id: user.id,
    email: user.emailLower || normalizeEmail(user.email),
    exp: Date.now() + SESSION_TTL_MS,
  });
  const signature = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSessionToken(req, body = {}) {
  const auth = req.headers.authorization || '';
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return cleanString(req.headers['x-session-token'] || body.sessionToken);
}

function verifySessionToken(req, body = {}) {
  const token = readSessionToken(req, body);
  if (!token) throw new HttpError(401, '请先登录。');

  const [payloadPart, signature] = token.split('.');
  if (!payloadPart || !signature) throw new HttpError(401, '登录状态无效，请重新登录。');

  const expected = crypto.createHmac('sha256', sessionSecret()).update(payloadPart).digest('base64url');
  if (!safeCompare(signature, expected)) throw new HttpError(401, '登录状态无效，请重新登录。');

  const payload = decodePayload(payloadPart);
  if (!payload.exp || payload.exp < Date.now()) throw new HttpError(401, '登录已过期，请重新登录。');
  return payload;
}

async function requireSessionUser(collection, req, body) {
  const payload = verifySessionToken(req, body);
  const user = await findUserById(collection, payload.id);
  if (!user || normalizeEmail(user.email) !== payload.email) throw new HttpError(401, '登录状态无效，请重新登录。');
  if (user.status === 'blocked') throw new HttpError(403, '该用户已被管理员停用。');
  return user;
}

async function ensureAdminIfMissing(collection, user) {
  if (user.role === 'admin') return user;
  if ((await countUsers(collection, { role: 'admin' })) > 0) return user;

  const updates = { role: 'admin', updatedAt: new Date().toISOString() };
  if (collection) {
    await collection.updateOne({ id: user.id }, { $set: updates });
  } else {
    Object.assign(user, updates);
  }
  return { ...user, ...updates };
}

async function touchLogin(collection, user) {
  let activeUser = await ensureAdminIfMissing(collection, user);
  const updates = {
    lastLoginAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (collection) {
    await collection.updateOne({ id: activeUser.id }, { $set: updates });
    activeUser = { ...activeUser, ...updates };
  } else {
    Object.assign(activeUser, updates);
  }

  return activeUser;
}

async function loginUser(collection, body) {
  const emailLower = validateEmail(body.email);
  const password = String(body.password || '');
  const user = await findUserByEmail(collection, emailLower);

  if (!user || !verifyPassword(password, user)) {
    throw new HttpError(401, '邮箱或密码不正确。');
  }
  if (user.status === 'blocked') {
    throw new HttpError(403, '该用户已被管理员停用。');
  }

  const activeUser = await touchLogin(collection, user);
  return {
    user: toPublicUser(activeUser),
    sessionToken: signSession(activeUser),
  };
}

function mailConfig() {
  const smtpUser = cleanString(process.env.SMTP_USER);
  const smtpPass = cleanString(process.env.SMTP_PASS);
  if (!smtpUser || !smtpPass) {
    throw new HttpError(500, '邮箱验证码未配置：请在 Vercel 环境变量中设置 SMTP_USER 和 SMTP_PASS。');
  }

  const auth = { user: smtpUser, pass: smtpPass };
  const service = cleanString(process.env.SMTP_SERVICE);
  if (service) return { service, auth };

  const host = cleanString(process.env.SMTP_HOST);
  if (!host) throw new HttpError(500, '邮箱验证码未配置：请设置 SMTP_SERVICE 或 SMTP_HOST。');

  const port = Number(process.env.SMTP_PORT || 465);
  const secureRaw = cleanString(process.env.SMTP_SECURE).toLowerCase();
  return {
    host,
    port,
    secure: secureRaw ? secureRaw !== 'false' : port === 465,
    auth,
  };
}

async function sendVerificationMail(email, code) {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (error) {
    throw new HttpError(500, '当前环境缺少 nodemailer 依赖，请重新部署 Twikoo 后端。');
  }

  const siteName = cleanString(process.env.SITE_NAME) || cleanString(process.env.SENDER_NAME) || 'Zeora';
  const senderEmail = cleanString(process.env.SENDER_EMAIL) || cleanString(process.env.SMTP_USER);
  const senderName = cleanString(process.env.SENDER_NAME) || siteName;
  const transporter = nodemailer.createTransport(mailConfig());
  const text = `${siteName} 登录验证码：${code}\n\n验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。`;

  await transporter.sendMail({
    from: `"${senderName}" <${senderEmail}>`,
    to: email,
    subject: `${siteName} 登录验证码 ${code}`,
    text,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#202124">
        <p>${siteName} 登录验证码：</p>
        <p style="font-size:28px;font-weight:800;letter-spacing:4px;margin:12px 0">${code}</p>
        <p>验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>
      </div>
    `,
  });
}

async function findLatestCode(collection, emailLower) {
  const now = Date.now();
  if (collection) {
    return collection.findOne(
      { emailLower, consumedAt: { $exists: false }, expiresAt: { $gt: new Date(now) } },
      { sort: { createdAt: -1 } }
    );
  }

  seedMemoryStore();
  memoryStore.codes = memoryStore.codes.filter((record) => new Date(record.expiresAt).getTime() > now && !record.consumedAt);
  return memoryStore.codes
    .filter((record) => record.emailLower === emailLower)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

async function saveLoginCode(collection, record) {
  if (collection) {
    await collection.insertOne(record);
    return;
  }
  seedMemoryStore();
  memoryStore.codes.push(record);
}

async function markCodeAttempt(collection, record, updates) {
  if (collection) {
    await collection.updateOne({ id: record.id }, { $set: updates });
    return;
  }
  Object.assign(record, updates);
}

async function requestLoginCode(codeCollection, body) {
  const emailLower = validateEmail(body.email);
  const recent = await findLatestCode(codeCollection, emailLower);
  if (recent && Date.now() - new Date(recent.createdAt).getTime() < CODE_RESEND_MS) {
    throw new HttpError(429, '验证码发送太频繁，请稍后再试。');
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeFields = hashCode(code);
  const now = new Date();
  const record = {
    id: crypto.randomUUID(),
    email: emailLower,
    emailLower,
    attempts: 0,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    ...codeFields,
  };

  await saveLoginCode(codeCollection, record);
  await sendVerificationMail(emailLower, code);

  return {
    email: emailLower,
    expiresIn: Math.floor(CODE_TTL_MS / 1000),
    resendAfter: Math.floor(CODE_RESEND_MS / 1000),
  };
}

async function verifyLoginCode(userCollection, codeCollection, body) {
  const emailLower = validateEmail(body.email);
  const code = cleanString(body.code);
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, '请输入 6 位邮箱验证码。');

  const record = await findLatestCode(codeCollection, emailLower);
  if (!record) throw new HttpError(400, '验证码已过期，请重新获取。');
  if ((record.attempts || 0) >= CODE_MAX_ATTEMPTS) {
    throw new HttpError(429, '验证码尝试次数过多，请重新获取。');
  }
  if (!verifyCodeHash(code, record)) {
    await markCodeAttempt(codeCollection, record, { attempts: (record.attempts || 0) + 1, updatedAt: new Date() });
    throw new HttpError(400, '验证码不正确。');
  }

  await markCodeAttempt(codeCollection, record, { consumedAt: new Date(), updatedAt: new Date() });

  let user = await findUserByEmail(userCollection, emailLower);
  let isNewUser = false;
  if (!user) {
    const username = cleanString(body.username) || await createUniqueUsername(userCollection, emailLower);
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      throw new HttpError(400, '用户名需要 3-32 位，只能包含字母、数字、下划线、点或短横线。');
    }

    const displayName = cleanString(body.displayName) || username;
    if (displayName.length > 64) throw new HttpError(400, '显示名称不能超过 64 个字符。');

    const now = new Date().toISOString();
    const uid = await createAvailableUid(userCollection);
    user = {
      id: crypto.randomUUID(),
      uid,
      username,
      usernameLower: username.toLowerCase(),
      displayName,
      email: emailLower,
      emailLower,
      avatarUrl: validateAvatarUrl(body.avatarUrl),
      role: await roleForNewUser(userCollection),
      status: 'active',
      notifications: defaultNotifications(),
      createdAt: now,
      updatedAt: now,
      ...hashPassword(crypto.randomUUID()),
    };
    await persistNewUser(userCollection, user);
    isNewUser = true;
  }

  if (user.status === 'blocked') throw new HttpError(403, '该用户已被管理员停用。');

  const activeUser = await touchLogin(userCollection, user);
  return {
    user: toPublicUser(activeUser),
    sessionToken: signSession(activeUser),
    isNewUser,
  };
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

async function updateProfile(collection, req, body) {
  let user;
  if (readSessionToken(req, body)) {
    user = await requireSessionUser(collection, req, body);
  } else {
    const emailLower = validateEmail(body.email);
    const password = String(body.password || '');
    user = await findUserByEmail(collection, emailLower);
    if (!user || !verifyPassword(password, user)) throw new HttpError(401, '邮箱或密码不正确。');
  }

  const updates = pickUserUpdates(body, false);
  return updateUser(collection, user.id, updates);
}

async function changePassword(collection, req, body) {
  let user;
  if (readSessionToken(req, body)) {
    user = await requireSessionUser(collection, req, body);
  } else {
    const emailLower = validateEmail(body.email);
    const currentPassword = String(body.currentPassword || body.password || '');
    user = await findUserByEmail(collection, emailLower);
    if (!user || !verifyPassword(currentPassword, user)) throw new HttpError(401, '当前密码不正确。');
  }

  const newPassword = String(body.newPassword || '');
  if (newPassword.length < 8) throw new HttpError(400, '新密码至少需要 8 位。');

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

async function authorizeAdmin(collection, req, body, url) {
  const configuredToken = process.env.DEMO_ADMIN_TOKEN;
  const suppliedToken =
    req.headers['x-admin-token'] ||
    body.adminToken ||
    url.searchParams.get('adminToken');

  if (configuredToken && safeCompare(suppliedToken, configuredToken)) return null;

  const user = await requireSessionUser(collection, req, body);
  if (user.role !== 'admin') throw new HttpError(403, '只有管理员可以执行这个操作。');
  return user;
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
  const codeCollection = await getCodeCollection();
  const storageMode = collection ? 'mongodb' : 'memory';

  if (action === 'health' && req.method === 'GET') {
    send(res, 200, {
      ok: true,
      storageMode,
      adminProtected: true,
      authMode: 'email-code',
      collection: collection ? COLLECTION_NAME : null,
    });
    return;
  }

  if (action === 'me' && req.method === 'GET') {
    const user = await requireSessionUser(collection, req, body);
    send(res, 200, { ok: true, user: toPublicUser(user) });
    return;
  }

  if (action === 'requestCode' && req.method === 'POST') {
    send(res, 200, { ok: true, code: await requestLoginCode(codeCollection, body) });
    return;
  }

  if (action === 'verifyCode' && req.method === 'POST') {
    send(res, 200, { ok: true, ...(await verifyLoginCode(collection, codeCollection, body)) });
    return;
  }

  if (action === 'listUsers' && req.method === 'GET') {
    await authorizeAdmin(collection, req, body, url);
    send(res, 200, { ok: true, users: await listUsers(collection), storageMode });
    return;
  }

  if (action === 'register' && req.method === 'POST') {
    const user = await registerUser(collection, body);
    send(res, 201, { ok: true, user, sessionToken: signSession({ ...user, emailLower: normalizeEmail(user.email) }) });
    return;
  }

  if (action === 'login' && req.method === 'POST') {
    send(res, 200, { ok: true, ...(await loginUser(collection, body)) });
    return;
  }

  if (action === 'updateProfile' && req.method === 'POST') {
    send(res, 200, { ok: true, user: await updateProfile(collection, req, body) });
    return;
  }

  if (action === 'changePassword' && req.method === 'POST') {
    send(res, 200, { ok: true, user: await changePassword(collection, req, body) });
    return;
  }

  if (action === 'updateUser' && req.method === 'POST') {
    await authorizeAdmin(collection, req, body, url);
    const updates = pickUserUpdates(body, true);
    send(res, 200, { ok: true, user: await updateUser(collection, body.id, updates) });
    return;
  }

  if (action === 'deleteUser' && req.method === 'POST') {
    await authorizeAdmin(collection, req, body, url);
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
      message: status >= 500 ? error.message || '服务器处理失败，请检查部署日志。' : error.message,
      detail: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};
