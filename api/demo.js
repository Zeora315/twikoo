const crypto = require('crypto');

const COLLECTION_NAME = process.env.DEMO_USERS_COLLECTION || 'twikoo_demo_users';
const CODE_COLLECTION_NAME = process.env.DEMO_CODES_COLLECTION || `${COLLECTION_NAME}_codes`;
const NOTIFICATION_COLLECTION_NAME = process.env.DEMO_NOTIFICATIONS_COLLECTION || `${COLLECTION_NAME}_notifications`;
const COMMENT_COLLECTION_NAME = process.env.TWIKOO_COMMENT_COLLECTION || process.env.COMMENT_COLLECTION_NAME || 'comment';
const CONFIG_COLLECTION_NAME = process.env.TWIKOO_CONFIG_COLLECTION || process.env.CONFIG_COLLECTION_NAME || 'config';
const CONFIG_COLLECTION_CANDIDATES = [...new Set([
  CONFIG_COLLECTION_NAME,
  'config',
  'configs',
  'twikoo_config',
  'twikoo_configs',
])];
const DB_NAME = process.env.DEMO_MONGODB_DB || undefined;
const PASSWORD_ITERATIONS = 120000;
const MAX_AVATAR_LENGTH = 240000;
const MAX_BACKGROUND_LENGTH = 240000;
const MAX_BIO_LENGTH = 120;
const MAX_BADGE_LENGTH = 20;
const DEFAULT_ADMIN_BADGE_COLOR = '#ff5f63';
const MAX_SOCIAL_LINKS = 5;
const MAX_SOCIAL_LABEL_LENGTH = 24;
const MAX_SOCIAL_URL_LENGTH = 300;
const SHOP_REWARD_COST = 100;
const SHOP_REWARD_ITEMS = {
  quark: { label: '夸克网盘会员' },
  bilibili: { label: 'B站大会员' },
  tencent: { label: '腾讯视频会员' },
  netease: { label: '网易云音乐会员' },
};
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
  notifications: [],
  seeded: false,
};

if (!Array.isArray(memoryStore.users)) memoryStore.users = [];
if (!Array.isArray(memoryStore.codes)) memoryStore.codes = [];
if (!Array.isArray(memoryStore.notifications)) memoryStore.notifications = [];
global.__twikooUserDemoStore = memoryStore;

let mongoClientPromise;
let mongoIndexesReady = false;
let mongoCodeIndexesReady = false;
let mongoNotificationIndexesReady = false;
let mongoConfigCache = null;
let mongoConfigCacheAt = 0;
const CONFIG_CACHE_MS = 30 * 1000;

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

function actionFromPath(url) {
  const match = url.pathname.match(/^\/api\/demo\/([^/?#]+)\/?$/);
  return match ? decodeURIComponent(match[1]).trim() : '';
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

function emailMd5(email) {
  const normalized = normalizeEmail(email);
  return normalized ? crypto.createHash('md5').update(normalized).digest('hex') : '';
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

function validateBackgroundUrl(backgroundUrl) {
  const value = cleanString(backgroundUrl);
  if (!value) return '';
  if (value.length > MAX_BACKGROUND_LENGTH) {
    throw new HttpError(400, '主页背景图链接太长，请换一个更短的图片外链。');
  }
  if (/^https?:\/\//i.test(value)) return value;
  throw new HttpError(400, '主页背景图只能填写 http(s) 图片外链。');
}

function validateWebsiteUrl(websiteUrl) {
  const raw = cleanString(websiteUrl);
  if (!raw) return '';
  const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (value.length > 220) throw new HttpError(400, '个人网站链接不能超过 220 个字符。');
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    throw new HttpError(400, '个人网站链接格式不正确。');
  }
}

function validateNotificationLink(link) {
  const value = cleanString(link);
  if (!value) return '';
  if (value.length > 220) throw new HttpError(400, '通知链接不能超过 220 个字符。');
  if (value.startsWith('/')) return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
    return url.toString();
  } catch (error) {
    throw new HttpError(400, '通知链接只能填写站内路径或 http(s) 链接。');
  }
}

function validateOptionalEmail(email, label = '联系邮箱') {
  const value = cleanString(email).toLowerCase();
  if (!value) return '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new HttpError(400, `${label}格式不正确。`);
  }
  return value;
}

function validateBio(bio) {
  const value = cleanString(bio);
  if (value.length > MAX_BIO_LENGTH) throw new HttpError(400, `个人简介不能超过 ${MAX_BIO_LENGTH} 个字符。`);
  return value;
}

function validateBadgeLabel(label) {
  const value = cleanString(label);
  if (value.length > MAX_BADGE_LENGTH) throw new HttpError(400, `身份标签不能超过 ${MAX_BADGE_LENGTH} 个字符。`);
  return value;
}

function validateBadgeColor(color) {
  const value = cleanString(color);
  if (!value) return '';
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  throw new HttpError(400, '身份标签颜色只能使用 #RRGGBB 格式。');
}

function normalizeSocialLinks(value) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw new HttpError(400, '社交链接需要以数组提交。');
  if (value.length > MAX_SOCIAL_LINKS) throw new HttpError(400, `社交链接最多只能设置 ${MAX_SOCIAL_LINKS} 个。`);

  return value.map((item) => {
    const label = cleanString(item?.label || item?.name || item?.title);
    const rawUrl = cleanString(item?.url || item?.href || item?.link);
    if (!label && !rawUrl) return null;
    if (!label || label.length > MAX_SOCIAL_LABEL_LENGTH) throw new HttpError(400, `社交名称需要 1-${MAX_SOCIAL_LABEL_LENGTH} 个字符。`);
    if (!rawUrl || rawUrl.length > MAX_SOCIAL_URL_LENGTH) throw new HttpError(400, `社交链接需要 1-${MAX_SOCIAL_URL_LENGTH} 个字符。`);
    const url = validateWebsiteUrl(rawUrl);
    return { label, url };
  }).filter(Boolean);
}

function publicSocialLinks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      label: cleanString(item?.label || item?.name || item?.title).slice(0, MAX_SOCIAL_LABEL_LENGTH),
      url: cleanString(item?.url || item?.href || item?.link).slice(0, MAX_SOCIAL_URL_LENGTH),
    }))
    .filter((item) => item.label && /^https?:\/\//i.test(item.url))
    .slice(0, MAX_SOCIAL_LINKS);
}

function publicRedemptions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-20).map((item) => ({
    id: cleanString(item?.id),
    item: cleanString(item?.item),
    itemLabel: cleanString(item?.itemLabel),
    cost: positiveInteger(item?.cost),
    status: cleanString(item?.status) || 'pending',
    createdAt: item?.createdAt || '',
  })).filter((item) => item.id && item.itemLabel);
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
  const backgroundUrl = validateBackgroundUrl(body.backgroundUrl);
  const bio = validateBio(body.bio);
  const websiteUrl = validateWebsiteUrl(body.websiteUrl);
  const contactEmail = validateOptionalEmail(body.contactEmail, '公开联系邮箱');
  const socialLinks = normalizeSocialLinks(body.socialLinks);

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    throw new HttpError(400, '用户名需要 3-32 位，只能包含字母、数字、下划线、点或短横线。');
  }
  if (displayName.length > 64) {
    throw new HttpError(400, '显示名称不能超过 64 个字符。');
  }
  if (password.length < 8) {
    throw new HttpError(400, '密码至少需要 8 位。');
  }

  return { username, usernameLower: username.toLowerCase(), displayName, email, emailLower: email, password, avatarUrl, backgroundUrl, bio, websiteUrl, contactEmail, socialLinks };
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
    siteReplies: true,
    emailReplies: true,
    emailSystem: false,
    browserPush: false,
  };
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.floor(number));
}

function commentLevelStats(experienceValue) {
  const experience = positiveInteger(experienceValue);
  let level = 1;
  let spent = 0;

  while (experience >= spent + level && level < 9999) {
    spent += level;
    level += 1;
  }

  const progress = Math.max(0, experience - spent);
  const nextRequired = level;
  const toNext = Math.max(0, nextRequired - progress);

  return {
    commentExperience: experience,
    commentLevel: level,
    commentLevelLabel: `Lv.${level}`,
    commentNextLevel: level + 1,
    commentProgress: progress,
    commentNextRequired: nextRequired,
    commentToNext: toNext,
  };
}

function userLevelStats(user) {
  const stats = commentLevelStats(user?.commentExperience || user?.commentCount || 0);
  const earned = Math.floor(stats.commentLevel / 10);
  const spent = positiveInteger(user?.shopSpentPoints);
  return {
    ...stats,
    commentPointsEarned: earned,
    shopSpentPoints: spent,
    commentPoints: Math.max(0, earned - spent),
    shopRedemptions: publicRedemptions(user?.shopRedemptions),
  };
}

function runtimeValue(config, keys) {
  for (const key of keys) {
    const configValue = getConfigValue(config, key);
    if (configValue) return configValue;
  }
  for (const key of keys) {
    const envValue = cleanString(process.env[key]);
    if (envValue) return envValue;
  }
  return '';
}

function captchaStatus(config = {}) {
  const providerRaw = runtimeValue(config, [
    'CAPTCHA_PROVIDER', 'captchaProvider', 'TWIKOO_CAPTCHA_PROVIDER', 'twikooCaptchaProvider',
    'CAPTCHA_TYPE', 'captchaType', 'CAPTCHA', 'VERIFY_PROVIDER', 'verifyProvider',
    'HUMAN_VERIFY_PROVIDER', 'humanVerifyProvider',
  ]);
  const geetestId = runtimeValue(config, [
    'GEETEST_CAPTCHA_ID', 'geetestCaptchaId', 'GEETEST_ID', 'geetestId', 'GEETEST_CAPTCHAID', 'geetestCaptchaID',
  ]);
  const recaptchaKey = runtimeValue(config, [
    'RECAPTCHA_SITE_KEY', 'recaptchaSiteKey', 'RECAPTCHA_SITEKEY', 'recaptchaSitekey',
    'RECAPTCHA_KEY', 'GOOGLE_RECAPTCHA_SITE_KEY', 'googleRecaptchaSiteKey',
  ]);
  const hcaptchaKey = runtimeValue(config, [
    'HCAPTCHA_SITE_KEY', 'hcaptchaSiteKey', 'HCAPTCHA_SITEKEY', 'hcaptchaSitekey', 'HCAPTCHA_KEY',
  ]);
  const turnstileKey = runtimeValue(config, [
    'TURNSTILE_SITE_KEY', 'turnstileSiteKey', 'TURNSTILE_SITEKEY', 'turnstileSitekey',
    'TURNSTILE_KEY', 'CF_TURNSTILE_SITE_KEY', 'cfTurnstileSiteKey', 'CF_TURNSTILE_SITEKEY',
  ]);
  const provider = normalizeCaptchaProvider(providerRaw, { geetestId, recaptchaKey, hcaptchaKey, turnstileKey });
  return {
    enabled: Boolean(provider),
    provider,
    geetestCaptchaId: provider === 'Geetest' ? geetestId : '',
    siteKey: provider === 'Turnstile' ? turnstileKey : provider === 'hCaptcha' ? hcaptchaKey : provider === 'reCAPTCHA' ? recaptchaKey : '',
  };
}

function normalizeCaptchaProvider(provider, keys = {}) {
  const value = cleanString(provider).toLowerCase();
  if (value.includes('geetest') || value.includes('极验') || keys.geetestId) return 'Geetest';
  if (value.includes('turnstile') || keys.turnstileKey) return 'Turnstile';
  if (value.includes('hcaptcha') || keys.hcaptchaKey) return 'hCaptcha';
  if (value.includes('recaptcha') || keys.recaptchaKey) return 'reCAPTCHA';
  return '';
}

function readCaptchaPayload(body) {
  return body?.captcha || body?.captchaPayload || body?.captchaToken || null;
}

async function verifyGeetestCaptcha(config, payload) {
  const captchaId = runtimeValue(config, [
    'GEETEST_CAPTCHA_ID', 'geetestCaptchaId', 'GEETEST_ID', 'geetestId', 'GEETEST_CAPTCHAID', 'geetestCaptchaID',
  ]);
  const captchaKey = runtimeValue(config, [
    'GEETEST_CAPTCHA_KEY', 'geetestCaptchaKey', 'GEETEST_KEY', 'geetestKey', 'GEETEST_SECRET', 'geetestSecret',
  ]);
  if (!captchaId || !captchaKey) throw new HttpError(500, '极验人机验证配置不完整，请检查 GEETEST_CAPTCHA_ID 和 GEETEST_CAPTCHA_KEY。');
  if (!payload || typeof payload !== 'object') throw new HttpError(400, '请先完成人机验证。');

  const lotNumber = cleanString(payload.lot_number);
  const captchaOutput = cleanString(payload.captcha_output);
  const passToken = cleanString(payload.pass_token);
  const genTime = cleanString(payload.gen_time);
  if (!lotNumber || !captchaOutput || !passToken || !genTime) throw new HttpError(400, '人机验证结果无效，请重新验证。');

  const signToken = crypto.createHmac('sha256', captchaKey).update(lotNumber).digest('hex');
  const params = new URLSearchParams({
    captcha_id: captchaId,
    lot_number: lotNumber,
    captcha_output: captchaOutput,
    pass_token: passToken,
    gen_time: genTime,
    sign_token: signToken,
  });

  const response = await fetch('https://gcaptcha4.geetest.com/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.result !== 'success') throw new HttpError(400, '人机验证失败，请重新验证。');
}

async function verifySiteCaptcha(endpoint, secret, token) {
  if (!secret) throw new HttpError(500, '人机验证密钥未配置，请检查评论后台验证码配置。');
  if (!token || typeof token !== 'string') throw new HttpError(400, '请先完成人机验证。');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }).toString(),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new HttpError(400, '人机验证失败，请重新验证。');
}

async function verifyCaptchaIfNeeded(config, body) {
  const status = captchaStatus(config);
  if (!status.enabled) return;

  const payload = readCaptchaPayload(body);
  if (status.provider === 'Geetest') {
    await verifyGeetestCaptcha(config, payload);
    return;
  }
  if (status.provider === 'Turnstile') {
    await verifySiteCaptcha('https://challenges.cloudflare.com/turnstile/v0/siteverify', runtimeValue(config, [
      'TURNSTILE_SECRET_KEY', 'turnstileSecretKey', 'TURNSTILE_SECRET', 'turnstileSecret',
      'CF_TURNSTILE_SECRET_KEY', 'cfTurnstileSecretKey', 'CF_TURNSTILE_SECRET',
    ]), cleanString(payload));
    return;
  }
  if (status.provider === 'hCaptcha') {
    await verifySiteCaptcha('https://hcaptcha.com/siteverify', runtimeValue(config, [
      'HCAPTCHA_SECRET_KEY', 'hcaptchaSecretKey', 'HCAPTCHA_SECRET', 'hcaptchaSecret',
    ]), cleanString(payload));
    return;
  }
  if (status.provider === 'reCAPTCHA') {
    await verifySiteCaptcha('https://www.google.com/recaptcha/api/siteverify', runtimeValue(config, [
      'RECAPTCHA_SECRET_KEY', 'recaptchaSecretKey', 'RECAPTCHA_SECRET', 'recaptchaSecret',
      'GOOGLE_RECAPTCHA_SECRET_KEY', 'googleRecaptchaSecretKey',
    ]), cleanString(payload));
  }
}

function toPublicUser(user) {
  const level = userLevelStats(user);
  return {
    id: user.id,
    uid: makeUid(user),
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl || '',
    backgroundUrl: user.backgroundUrl || '',
    bio: user.bio || '',
    websiteUrl: user.websiteUrl || '',
    contactEmail: user.contactEmail || '',
    socialLinks: publicSocialLinks(user.socialLinks),
    badgeLabel: user.badgeLabel || (user.role === 'admin' ? '博主' : ''),
    badgeColor: user.badgeColor || (user.role === 'admin' ? DEFAULT_ADMIN_BADGE_COLOR : ''),
    role: user.role || 'user',
    status: user.status || 'active',
    notifications: user.notifications || defaultNotifications(),
    ...level,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function toProfileUser(user) {
  const level = userLevelStats(user);
  return {
    id: user.id,
    uid: makeUid(user),
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl || '',
    backgroundUrl: user.backgroundUrl || '',
    bio: user.bio || '',
    websiteUrl: user.websiteUrl || '',
    contactEmail: user.contactEmail || '',
    socialLinks: publicSocialLinks(user.socialLinks),
    badgeLabel: user.badgeLabel || (user.role === 'admin' ? '博主' : ''),
    badgeColor: user.badgeColor || (user.role === 'admin' ? DEFAULT_ADMIN_BADGE_COLOR : ''),
    role: user.role || 'user',
    status: user.status || 'active',
    ...level,
    createdAt: user.createdAt,
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
      collection.createIndex({ emailLower: 1, purpose: 1, createdAt: -1 }),
      collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 }),
    ]);
    mongoCodeIndexesReady = true;
  }

  return collection;
}

async function getNotificationCollection() {
  const db = await getMongoDatabase();
  if (!db) return null;

  const collection = db.collection(NOTIFICATION_COLLECTION_NAME);

  if (!mongoNotificationIndexesReady) {
    await Promise.all([
      collection.createIndex({ userId: 1, createdAt: -1 }),
      collection.createIndex({ userId: 1, readAt: 1, createdAt: -1 }),
      collection.createIndex({ dedupeKey: 1 }, { unique: true, sparse: true }),
    ]);
    mongoNotificationIndexesReady = true;
  }

  return collection;
}

async function getCommentCollection() {
  const db = await getMongoDatabase();
  if (!db) return null;
  return db.collection(COMMENT_COLLECTION_NAME);
}

function commentOwnerClauses(user) {
  const emailLower = normalizeEmail(user?.email);
  const uid = makeUid(user || {});
  const handle = cleanString(user?.username || uid || user?.id);
  const profilePaths = handle ? [
    `/user-center/?user=${encodeURIComponent(handle)}`,
    `/user/${encodeURIComponent(handle)}`,
  ] : [];
  const mailHash = emailMd5(emailLower);
  return [
    { userId: user?.id },
    { zeoraUserId: user?.id },
    { '_zeoraCommentAuth.userId': user?.id },
    { zeoraUid: uid },
    { '_zeoraCommentAuth.uid': uid },
    { mail: emailLower },
    { email: emailLower },
    { mailMd5: mailHash },
    { mailMD5: mailHash },
    { emailHash: mailHash },
    ...profilePaths.flatMap((link) => [{ link }, { url: link }, { href: link }, { permalink: link }]),
  ].filter((clause) => Object.values(clause)[0]);
}

async function countCommentsForUser(commentCollection, user) {
  if (!commentCollection || !user) return positiveInteger(user?.commentExperience || user?.commentCount || 0);
  const clauses = commentOwnerClauses(user);
  if (!clauses.length) return 0;
  return commentCollection.countDocuments({ $or: clauses });
}

async function refreshUserCommentStats(userCollection, commentCollection, user) {
  if (!user) return user;
  const stats = commentLevelStats(await countCommentsForUser(commentCollection, user));
  const changed = Object.entries(stats).some(([key, value]) => user[key] !== value);
  const updatedUser = { ...user, ...stats };

  if (changed) {
    const update = { ...stats, updatedAt: new Date().toISOString() };
    if (userCollection) {
      await userCollection.updateOne({ id: user.id }, { $set: update });
    } else {
      Object.assign(user, update);
    }
    updatedUser.updatedAt = update.updatedAt;
  }

  return updatedUser;
}

function getConfigValue(config, key) {
  if (!config || typeof config !== 'object') return '';

  const direct = config[key] ?? config[key.toLowerCase()] ?? config[key.toUpperCase()];
  if (direct !== undefined && direct !== null && direct !== '') return cleanString(direct);

  const nested = config.config?.[key] ?? config.value?.[key] ?? config.settings?.[key] ??
    config.config?.[key.toLowerCase()] ?? config.value?.[key.toLowerCase()] ?? config.settings?.[key.toLowerCase()];
  if (nested !== undefined && nested !== null && nested !== '') return cleanString(nested);

  return '';
}

function addEnvTextConfigEntries(target, text) {
  const value = cleanString(text);
  if (!/[A-Za-z][A-Za-z0-9_]{1,63}\s*=/.test(value)) return false;

  let matched = false;
  value.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_]{1,63})\s*=\s*(.*?)\s*$/);
    if (!match) return;
    matched = true;
    addConfigEntry(target, match[1], match[2]);
  });
  return matched;
}

function addConfigEntry(target, key, value) {
  const normalizedKey = cleanString(key);
  if (!normalizedKey || normalizedKey === '_id') return;
  if (value === undefined || value === null || value === '') return;

  if (typeof value === 'object' && !Array.isArray(value)) {
    const inner = value.value ?? value.val ?? value.content ?? value.data;
    if (inner !== undefined && inner !== null && inner !== '') {
      target[normalizedKey] = inner;
      target[normalizedKey.toUpperCase()] = inner;
      return;
    }
  }

  const mayContainConfigText = typeof value === 'string' &&
    (/^(env|config|settings|content|data|value)$/i.test(normalizedKey) || value.includes('\n'));
  if (mayContainConfigText && addEnvTextConfigEntries(target, value)) return;

  target[normalizedKey] = value;
  target[normalizedKey.toUpperCase()] = value;
}

function normalizeConfigRecord(record) {
  if (!record || typeof record !== 'object') return {};

  const normalized = {};
  const keyLike = record.key || record.name || record.label || record.id || (typeof record._id === 'string' ? record._id : '');
  const valueLike = record.value ?? record.val ?? record.content ?? record.data ?? record.configValue;
  if (keyLike && valueLike !== undefined) addConfigEntry(normalized, keyLike, valueLike);

  for (const [key, value] of Object.entries(record)) {
    if (key === '_id') continue;
    if (['key', 'name', 'label', 'id'].includes(key) && valueLike !== undefined) continue;
    addConfigEntry(normalized, key, value);
  }

  for (const bucket of [record.config, record.value, record.settings, record.env]) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    for (const [key, value] of Object.entries(bucket)) addConfigEntry(normalized, key, value);
  }

  return normalized;
}

async function readTwikooRuntimeConfig() {
  const db = await getMongoDatabase();
  if (!db) return {};

  const now = Date.now();
  if (mongoConfigCache && now - mongoConfigCacheAt < CONFIG_CACHE_MS) return mongoConfigCache;

  try {
    const merged = {};
    for (const name of CONFIG_COLLECTION_CANDIDATES) {
      const records = await db.collection(name).find({}).limit(300).toArray().catch(() => []);
      records.forEach((record) => Object.assign(merged, normalizeConfigRecord(record)));
    }
    mongoConfigCache = merged;
    mongoConfigCacheAt = now;
    return mongoConfigCache;
  } catch (error) {
    return {};
  }
}

async function countUsers(collection, filter = {}) {
  if (collection) return collection.countDocuments(filter);
  seedMemoryStore();
  return memoryStore.users.filter((user) => {
    return Object.entries(filter).every(([key, value]) => user[key] === value);
  }).length;
}

async function listUsers(collection, commentCollection) {
  let users;
  if (collection) {
    users = await collection.find({}, { projection: { _id: 0, passwordHash: 0, salt: 0 } }).sort({ uid: 1, createdAt: 1 }).toArray();
  } else {
    seedMemoryStore();
    users = [...memoryStore.users].sort((a, b) => makeUid(a).localeCompare(makeUid(b)));
  }

  const usersWithStats = await Promise.all(users.map((user) => refreshUserCommentStats(collection, commentCollection, user)));
  return usersWithStats.map(toPublicUser);
}

async function listPublicProfiles(collection, commentCollection) {
  let users;
  if (collection) {
    users = await collection.find(
      { status: { $ne: 'blocked' } },
      { projection: { _id: 0, passwordHash: 0, salt: 0, email: 0, emailLower: 0, notifications: 0 } }
    ).sort({ uid: 1, createdAt: 1 }).limit(500).toArray();
  } else {
    seedMemoryStore();
    users = memoryStore.users.filter((user) => user.status !== 'blocked').slice(0, 500);
  }

  const usersWithStats = await Promise.all(users.map((user) => refreshUserCommentStats(collection, commentCollection, user)));
  return usersWithStats.map(toProfileUser);
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

async function findUserByUid(collection, uid) {
  if (!uid) return null;
  if (collection) return collection.findOne({ uid });
  seedMemoryStore();
  return memoryStore.users.find((user) => user.uid === uid);
}

async function findUserByIdentifier(collection, identifier) {
  const value = cleanString(identifier).replace(/^@/, '');
  if (!value) throw new HttpError(400, '请输入用户名、邮箱或 UID。');

  if (value.includes('@')) {
    const byEmail = await findUserByEmail(collection, validateEmail(value));
    if (byEmail) return byEmail;
  }

  const byUid = await findUserByUid(collection, value);
  if (byUid) return byUid;

  const byUsername = await findUserByUsername(collection, value.toLowerCase());
  if (byUsername) return byUsername;

  return null;
}

async function findUserByPublicHandle(collection, handle) {
  const value = cleanString(handle).replace(/^@/, '');
  if (!value) throw new HttpError(400, '缺少用户 ID。');

  const byUsername = await findUserByUsername(collection, value.toLowerCase());
  if (byUsername) return byUsername;

  const byUid = await findUserByUid(collection, value);
  if (byUid) return byUid;

  return findUserById(collection, value);
}

async function findNotificationRecipient(collection, value) {
  const raw = cleanString(value).replace(/^@/, '');
  if (!raw) return null;

  const byId = await findUserById(collection, raw);
  if (byId) return byId;

  const byUid = await findUserByUid(collection, raw);
  if (byUid) return byUid;

  if (raw.includes('@')) {
    const byEmail = await findUserByEmail(collection, normalizeEmail(raw));
    if (byEmail) return byEmail;
  }

  return findUserByUsername(collection, raw.toLowerCase());
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
    backgroundUrl: input.backgroundUrl,
    bio: input.bio,
    websiteUrl: input.websiteUrl,
    contactEmail: input.contactEmail,
    socialLinks: input.socialLinks,
    role,
    badgeLabel: role === 'admin' ? '博主' : '',
    badgeColor: role === 'admin' ? DEFAULT_ADMIN_BADGE_COLOR : '',
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
  const urlToken = getRequestUrl(req).searchParams.get('sessionToken');
  return cleanString(req.headers['x-session-token'] || body.sessionToken || urlToken);
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

async function loginUser(collection, body, commentCollection) {
  const identifier = body.identifier || body.login || body.email || body.username || body.uid;
  const password = String(body.password || '');
  const user = await findUserByIdentifier(collection, identifier);

  if (!user || !verifyPassword(password, user)) {
    throw new HttpError(401, '账号或密码不正确。');
  }
  if (user.status === 'blocked') {
    throw new HttpError(403, '该用户已被管理员停用。');
  }

  const activeUser = await refreshUserCommentStats(collection, commentCollection, await touchLogin(collection, user));
  return {
    user: toPublicUser(activeUser),
    sessionToken: signSession(activeUser),
  };
}

function mailConfig(config = {}) {
  const smtpUser = runtimeValue(config, [
    'SMTP_USER', 'smtpUser', 'MAIL_USER', 'mailUser', 'EMAIL_USER', 'emailUser', 'SENDER_EMAIL', 'senderEmail',
  ]);
  const smtpPass = runtimeValue(config, [
    'SMTP_PASS', 'smtpPass', 'SMTP_PASSWORD', 'smtpPassword',
    'MAIL_PASS', 'mailPass', 'MAIL_PASSWORD', 'mailPassword',
    'EMAIL_PASS', 'emailPass', 'SENDER_PASS', 'senderPass', 'SENDER_PASSWORD', 'senderPassword',
  ]);
  if (!smtpUser || !smtpPass) {
    throw new HttpError(500, '邮箱验证码未配置：请在 Twikoo 评论管理的邮件通知中，或环境变量中设置 SMTP_USER 和 SMTP_PASS。');
  }

  const auth = { user: smtpUser, pass: smtpPass };
  const service = runtimeValue(config, ['SMTP_SERVICE', 'smtpService', 'MAIL_SERVICE', 'mailService', 'EMAIL_SERVICE', 'emailService']);
  if (service) return { service, auth };

  const host = runtimeValue(config, ['SMTP_HOST', 'smtpHost', 'MAIL_HOST', 'mailHost', 'EMAIL_HOST', 'emailHost']);
  if (!host) throw new HttpError(500, '邮箱验证码未配置：请设置 SMTP_SERVICE 或 SMTP_HOST。');

  const port = Number(runtimeValue(config, ['SMTP_PORT', 'smtpPort', 'MAIL_PORT', 'mailPort', 'EMAIL_PORT', 'emailPort']) || 465);
  const secureRaw = runtimeValue(config, ['SMTP_SECURE', 'smtpSecure', 'MAIL_SECURE', 'mailSecure', 'EMAIL_SECURE', 'emailSecure']).toLowerCase();
  return {
    host,
    port,
    secure: secureRaw ? secureRaw !== 'false' : port === 465,
    auth,
  };
}

function siteMeta(config = {}) {
  const senderName = runtimeValue(config, ['SENDER_NAME', 'senderName']);
  const siteName = runtimeValue(config, ['SITE_NAME', 'siteName', 'BLOG_NAME', 'blogName', 'TWIKOO_SITE_NAME', 'twikooSiteName']) || senderName || 'Zeora Blog';
  return {
    name: siteName,
    url: runtimeValue(config, ['SITE_URL', 'siteUrl', 'BLOG_URL', 'blogUrl', 'TWIKOO_SITE_URL', 'twikooSiteUrl']) || 'https://blog.zeora.top',
    logo: runtimeValue(config, ['SITE_LOGO', 'siteLogo', 'BLOG_LOGO', 'blogLogo', 'LOGO', 'logo']) || '',
    senderName: senderName || siteName,
    senderEmail: runtimeValue(config, ['SENDER_EMAIL', 'senderEmail']) || runtimeValue(config, ['SMTP_USER', 'smtpUser']),
  };
}

function verificationPurposeMeta(purpose) {
  const value = cleanString(purpose || 'login').toLowerCase();
  if (value === 'register') {
    return { purpose: 'register', label: '注册验证码', intro: '完成评论账号注册' };
  }
  if (value === 'reset') {
    return { purpose: 'reset', label: '重置密码验证码', intro: '重置你的评论账号密码' };
  }
  return { purpose: 'login', label: '登录验证码', intro: '登录评论账号' };
}

async function sendVerificationMail(email, code, purpose = 'login') {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (error) {
    throw new HttpError(500, '当前环境缺少 nodemailer 依赖，请重新部署 Twikoo 后端。');
  }

  const meta = verificationPurposeMeta(purpose);
  const runtimeConfig = await readTwikooRuntimeConfig();
  const site = siteMeta(runtimeConfig);
  const transporter = nodemailer.createTransport(mailConfig(runtimeConfig));
  const text = `${site.name} ${meta.label}：${code}\n\n此验证码用于${meta.intro}，10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。\n${site.url}`;

  await transporter.sendMail({
    from: `"${site.senderName}" <${site.senderEmail}>`,
    to: email,
    subject: `${site.name} ${meta.label} ${code}`,
    text,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#202124">
        <p>${site.name} ${meta.label}：</p>
        <p style="font-size:28px;font-weight:800;letter-spacing:4px;margin:12px 0">${code}</p>
        <p>此验证码用于${meta.intro}，10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>
        <p><a href="${site.url}" target="_blank" rel="noopener noreferrer" style="color:#307af6;text-decoration:none">${site.url}</a></p>
      </div>
    `,
  });
}

async function findLatestCode(collection, emailLower, purpose = 'login') {
  const now = Date.now();
  const normalizedPurpose = verificationPurposeMeta(purpose).purpose;
  if (collection) {
    return collection.findOne(
      { emailLower, purpose: normalizedPurpose, consumedAt: { $exists: false }, expiresAt: { $gt: new Date(now) } },
      { sort: { createdAt: -1 } }
    );
  }

  seedMemoryStore();
  memoryStore.codes = memoryStore.codes.filter((record) => new Date(record.expiresAt).getTime() > now && !record.consumedAt);
  return memoryStore.codes
    .filter((record) => record.emailLower === emailLower && (record.purpose || 'login') === normalizedPurpose)
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
  const { purpose } = verificationPurposeMeta(body.purpose);
  const recent = await findLatestCode(codeCollection, emailLower, purpose);
  const recentSentAt = recent ? new Date(recent.sentAt || 0).getTime() : 0;
  if (recentSentAt && Date.now() - recentSentAt < CODE_RESEND_MS) {
    throw new HttpError(429, '验证码发送太频繁，请稍后再试。');
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeFields = hashCode(code);
  const now = new Date();
  const record = {
    id: crypto.randomUUID(),
    email: emailLower,
    emailLower,
    purpose,
    attempts: 0,
    createdAt: now,
    sentAt: now,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    ...codeFields,
  };

  await sendVerificationMail(emailLower, code, purpose);
  await saveLoginCode(codeCollection, record);

  return {
    email: emailLower,
    purpose,
    expiresIn: Math.floor(CODE_TTL_MS / 1000),
    resendAfter: Math.floor(CODE_RESEND_MS / 1000),
  };
}

async function consumeVerificationCode(codeCollection, body, purpose = 'login') {
  const emailLower = validateEmail(body.email);
  const code = cleanString(body.code);
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, '请输入 6 位邮箱验证码。');

  const record = await findLatestCode(codeCollection, emailLower, purpose);
  if (!record) throw new HttpError(400, '验证码已过期，请重新获取。');
  if ((record.attempts || 0) >= CODE_MAX_ATTEMPTS) {
    throw new HttpError(429, '验证码尝试次数过多，请重新获取。');
  }
  if (!verifyCodeHash(code, record)) {
    await markCodeAttempt(codeCollection, record, { attempts: (record.attempts || 0) + 1, updatedAt: new Date() });
    throw new HttpError(400, '验证码不正确。');
  }

  await markCodeAttempt(codeCollection, record, { consumedAt: new Date(), updatedAt: new Date() });
  return emailLower;
}

async function verifyLoginCode(userCollection, codeCollection, body) {
  const emailLower = await consumeVerificationCode(codeCollection, body, 'login');
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
    const role = await roleForNewUser(userCollection);
    user = {
      id: crypto.randomUUID(),
      uid,
      username,
      usernameLower: username.toLowerCase(),
      displayName,
      email: emailLower,
      emailLower,
      avatarUrl: validateAvatarUrl(body.avatarUrl),
      backgroundUrl: validateBackgroundUrl(body.backgroundUrl),
      bio: validateBio(body.bio),
      websiteUrl: validateWebsiteUrl(body.websiteUrl),
      contactEmail: validateOptionalEmail(body.contactEmail, '公开联系邮箱'),
      socialLinks: normalizeSocialLinks(body.socialLinks),
      role,
      badgeLabel: role === 'admin' ? '博主' : '',
      badgeColor: role === 'admin' ? DEFAULT_ADMIN_BADGE_COLOR : '',
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

async function registerUserWithCode(userCollection, codeCollection, body) {
  validateRegistration(body);
  const emailLower = await consumeVerificationCode(codeCollection, body, 'register');
  if (await findUserByEmail(userCollection, emailLower)) {
    throw new HttpError(409, '这个邮箱已经注册，请直接登录。');
  }
  const user = await registerUser(userCollection, { ...body, email: emailLower });
  return {
    user,
    sessionToken: signSession({ ...user, emailLower: normalizeEmail(user.email) }),
  };
}

async function resetPasswordWithCode(userCollection, codeCollection, body) {
  const newPassword = String(body.newPassword || '');
  if (newPassword.length < 8) throw new HttpError(400, '新密码至少需要 8 位。');

  const emailLower = validateEmail(body.email);
  const user = await findUserByEmail(userCollection, emailLower);
  if (!user) throw new HttpError(404, '这个邮箱还没有注册账号。');
  if (user.status === 'blocked') throw new HttpError(403, '该用户已被管理员停用。');
  await consumeVerificationCode(codeCollection, body, 'reset');

  const updates = {
    ...hashPassword(newPassword),
    updatedAt: new Date().toISOString(),
  };

  if (userCollection) {
    await userCollection.updateOne({ id: user.id }, { $set: updates });
  } else {
    Object.assign(user, updates);
  }

  const activeUser = await touchLogin(userCollection, { ...user, ...updates });
  return {
    user: toPublicUser(activeUser),
    sessionToken: signSession(activeUser),
  };
}

function pickUserUpdates(body, allowRoleStatus, requireAny = true) {
  const updates = {};

  if (body.displayName !== undefined) {
    const displayName = cleanString(body.displayName);
    if (!displayName || displayName.length > 64) throw new HttpError(400, '显示名称需要 1-64 个字符。');
    updates.displayName = displayName;
  }
  if (body.avatarUrl !== undefined) updates.avatarUrl = validateAvatarUrl(body.avatarUrl);
  if (body.backgroundUrl !== undefined) updates.backgroundUrl = validateBackgroundUrl(body.backgroundUrl);
  if (body.bio !== undefined) updates.bio = validateBio(body.bio);
  if (body.websiteUrl !== undefined) updates.websiteUrl = validateWebsiteUrl(body.websiteUrl);
  if (body.contactEmail !== undefined) updates.contactEmail = validateOptionalEmail(body.contactEmail, '公开联系邮箱');
  if (body.socialLinks !== undefined) updates.socialLinks = normalizeSocialLinks(body.socialLinks);
  if (!allowRoleStatus && body.notifications !== undefined) {
    const current = typeof body.notifications === 'object' && body.notifications ? body.notifications : {};
    updates.notifications = {
      siteReplies: current.siteReplies !== false,
      emailReplies: Boolean(current.emailReplies),
      emailSystem: Boolean(current.emailSystem),
      browserPush: Boolean(current.browserPush),
    };
  }
  if (allowRoleStatus && body.role !== undefined) {
    if (!['user', 'admin'].includes(body.role)) throw new HttpError(400, '角色只能是 user 或 admin。');
    updates.role = body.role;
    if (body.role === 'admin' && body.badgeLabel === undefined) updates.badgeLabel = '博主';
    if (body.role === 'admin' && body.badgeColor === undefined) updates.badgeColor = DEFAULT_ADMIN_BADGE_COLOR;
  }
  if (allowRoleStatus && body.badgeLabel !== undefined) updates.badgeLabel = validateBadgeLabel(body.badgeLabel);
  if (allowRoleStatus && body.badgeColor !== undefined) updates.badgeColor = validateBadgeColor(body.badgeColor);
  if (allowRoleStatus && body.status !== undefined) {
    if (!['active', 'blocked'].includes(body.status)) throw new HttpError(400, '状态只能是 active 或 blocked。');
    updates.status = body.status;
  }

  if (!Object.keys(updates).length) {
    if (requireAny) throw new HttpError(400, '没有可更新的字段。');
    return updates;
  }
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

  const updates = pickUserUpdates(body, false, false);
  if (body.username !== undefined) {
    const username = cleanString(body.username);
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      throw new HttpError(400, '用户名需要 3-32 位，只能包含字母、数字、下划线、点或短横线。');
    }
    const usernameLower = username.toLowerCase();
    const existing = await findUserByUsername(collection, usernameLower);
    if (existing && existing.id !== user.id) throw new HttpError(409, '这个用户名已经被占用。');
    updates.username = username;
    updates.usernameLower = usernameLower;
  }
  if (!Object.keys(updates).length) throw new HttpError(400, '没有可更新的字段。');
  updates.updatedAt = new Date().toISOString();
  return updateUser(collection, user.id, updates);
}

async function redeemReward(collection, req, body) {
  const user = await requireSessionUser(collection, req, body);
  const rewardKey = cleanString(body.reward || body.item || body.type).toLowerCase();
  const reward = SHOP_REWARD_ITEMS[rewardKey];
  if (!reward) throw new HttpError(400, '请选择有效的兑换商品。');

  const stats = userLevelStats(user);
  if (stats.commentPoints < SHOP_REWARD_COST) {
    throw new HttpError(400, `积分不足，当前可用 ${stats.commentPoints} 分。`);
  }

  const now = new Date().toISOString();
  const redemption = {
    id: crypto.randomUUID(),
    item: rewardKey,
    itemLabel: reward.label,
    cost: SHOP_REWARD_COST,
    status: 'pending',
    createdAt: now,
  };

  if (collection) {
    await collection.updateOne(
      { id: user.id },
      {
        $inc: { shopSpentPoints: SHOP_REWARD_COST },
        $push: { shopRedemptions: { $each: [redemption], $slice: -20 } },
        $set: { updatedAt: now },
      }
    );
    const updated = await findUserById(collection, user.id);
    return { user: toPublicUser(updated || user), redemption };
  }

  user.shopSpentPoints = positiveInteger(user.shopSpentPoints) + SHOP_REWARD_COST;
  user.shopRedemptions = [...publicRedemptions(user.shopRedemptions), redemption].slice(-20);
  user.updatedAt = now;
  return { user: toPublicUser(user), redemption };
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

function toNotification(record) {
  return {
    id: record.id,
    type: record.type || 'system',
    title: record.title || '通知',
    body: record.body || '',
    link: record.link || '',
    actorName: record.actorName || '',
    readAt: record.readAt || null,
    createdAt: record.createdAt,
  };
}

async function saveNotification(collection, record) {
  if (collection) {
    try {
      await collection.insertOne(record);
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    return;
  }

  seedMemoryStore();
  if (record.dedupeKey && memoryStore.notifications.some((item) => item.dedupeKey === record.dedupeKey)) return;
  memoryStore.notifications.push(record);
}

function fieldValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function commentIdCandidates(comment) {
  return [
    comment?._id?.toString?.() || comment?._id,
    comment?.id,
    comment?.commentId,
    comment?.uid,
  ].filter(Boolean).map((value) => String(value));
}

function commentSnippet(comment) {
  return cleanString(fieldValue(comment, ['comment', 'content', 'text', 'message', 'html']))
    .replace(/<[^>]+>/g, '')
    .slice(0, 120);
}

async function createReplyNotificationsFromComments(commentCollection, notificationCollection, user) {
  if (!commentCollection || !user?.notifications?.siteReplies) return 0;

  const emailLower = normalizeEmail(user.email);
  const mailHash = emailMd5(emailLower);
  const ownComments = await commentCollection.find({
    $or: [
      { mail: emailLower },
      { email: emailLower },
      { mailMd5: mailHash },
      { mailMD5: mailHash },
      { emailHash: mailHash },
      { userId: user.id },
      { zeoraUserId: user.id },
      { uid: user.uid },
    ].filter((item) => Object.values(item)[0])
  }, { projection: { _id: 1, id: 1, commentId: 1, uid: 1 } }).limit(200).toArray();

  const ownIds = [...new Set(ownComments.flatMap(commentIdCandidates))];
  const replyQueries = [
    { atMail: emailLower },
    { toMail: emailLower },
    { replyMail: emailLower },
    { parentMail: emailLower },
    { targetEmail: emailLower },
  ];

  if (ownIds.length) {
    replyQueries.push(
      { pid: { $in: ownIds } },
      { rid: { $in: ownIds } },
      { parent: { $in: ownIds } },
      { parentId: { $in: ownIds } },
      { replyId: { $in: ownIds } }
    );
  }

  const replies = await commentCollection.find({ $or: replyQueries })
    .sort({ createdAt: -1, created: -1, insertedAt: -1 })
    .limit(80)
    .toArray();

  let created = 0;
  for (const reply of replies) {
    const replyMail = normalizeEmail(fieldValue(reply, ['mail', 'email']));
    if (replyMail && replyMail === emailLower) continue;

    const rawId = fieldValue(reply, ['id', 'commentId']) || reply._id?.toString?.() || reply._id;
    if (!rawId) continue;

    const actorName = cleanString(fieldValue(reply, ['nick', 'author', 'name', 'displayName'])) || '访客';
    const createdAt = fieldValue(reply, ['createdAt', 'created', 'insertedAt']) || new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      userId: user.id,
      type: 'reply',
      title: '有人回复了你的评论',
      body: commentSnippet(reply) || '打开评论区查看最新回复。',
      link: cleanString(fieldValue(reply, ['url', 'href', 'permalink', 'path'])) || '/#post-comment',
      actorName,
      dedupeKey: `reply:${String(rawId)}`,
      readAt: null,
      createdAt: new Date(createdAt).toString() === 'Invalid Date' ? new Date().toISOString() : new Date(createdAt).toISOString(),
    };
    await saveNotification(notificationCollection, record);
    created += 1;
  }
  return created;
}

async function listNotifications(notificationCollection, commentCollection, user) {
  await createReplyNotificationsFromComments(commentCollection, notificationCollection, user).catch(() => 0);

  let items;
  if (notificationCollection) {
    items = await notificationCollection.find({ userId: user.id }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(80)
      .toArray();
  } else {
    seedMemoryStore();
    items = memoryStore.notifications
      .filter((item) => item.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 80);
  }

  const notifications = items.map(toNotification);
  return {
    notifications,
    unread: notifications.filter((item) => !item.readAt).length,
  };
}

async function markNotifications(notificationCollection, user, body) {
  const now = new Date().toISOString();
  const ids = Array.isArray(body.ids) ? body.ids.map((id) => cleanString(id)).filter(Boolean) : [];
  if (!body.all && !ids.length) return listNotifications(notificationCollection, null, user);

  const filter = { userId: user.id, readAt: null };
  if (!body.all && ids.length) filter.id = { $in: ids };

  if (notificationCollection) {
    await notificationCollection.updateMany(filter, { $set: { readAt: now, updatedAt: now } });
  } else {
    seedMemoryStore();
    memoryStore.notifications.forEach((item) => {
      if (item.userId !== user.id || item.readAt) return;
      if (!body.all && ids.length && !ids.includes(item.id)) return;
      item.readAt = now;
      item.updatedAt = now;
    });
  }

  return listNotifications(notificationCollection, null, user);
}

async function activeNotificationRecipients(userCollection, body) {
  const target = cleanString(body.target || 'all').toLowerCase();
  if (target === 'all') {
    if (userCollection) {
      return userCollection.find({ status: { $ne: 'blocked' } }, { projection: { passwordHash: 0, salt: 0 } }).toArray();
    }
    seedMemoryStore();
    return memoryStore.users.filter((user) => user.status !== 'blocked');
  }

  const recipient = await findNotificationRecipient(userCollection, body.userId || body.uid || body.email || body.recipient);
  if (!recipient || recipient.status === 'blocked') throw new HttpError(404, '找不到要通知的用户。');
  return [recipient];
}

async function createAdminNotification(userCollection, notificationCollection, body, actor) {
  const type = cleanString(body.type || 'system').toLowerCase();
  if (!['reply', 'comment', 'friend', 'system'].includes(type)) throw new HttpError(400, '通知类型不正确。');

  const title = cleanString(body.title) || (type === 'friend' ? '友链通知' : type === 'comment' ? '评论通知' : '站点通知');
  const content = cleanString(body.body || body.content || body.message);
  if (!content) throw new HttpError(400, '通知内容不能为空。');
  if (title.length > 80) throw new HttpError(400, '通知标题不能超过 80 个字符。');
  if (content.length > 500) throw new HttpError(400, '通知内容不能超过 500 个字符。');
  const link = validateNotificationLink(body.link);

  const recipients = await activeNotificationRecipients(userCollection, body);
  const now = new Date().toISOString();
  const records = recipients.map((recipient) => ({
    id: crypto.randomUUID(),
    userId: recipient.id,
    type,
    title,
    body: content,
    link,
    actorName: actor?.displayName || actor?.username || '管理员',
    readAt: null,
    createdAt: now,
    updatedAt: now,
  }));

  for (const record of records) await saveNotification(notificationCollection, record);
  return {
    created: records.length,
    notifications: records.map(toNotification),
  };
}

function collectCommentIds(source, bucket = new Set(), depth = 0) {
  if (!source || depth > 4) return bucket;
  if (typeof source !== 'object') return bucket;

  for (const [key, value] of Object.entries(source)) {
    if (key === '_zeoraCommentAuth') continue;
    if (/^(_id|id|commentId|commentID|uid)$/.test(key) && value !== undefined && value !== null && value !== '') {
      bucket.add(String(value));
    }
    if (value && typeof value === 'object') collectCommentIds(value, bucket, depth + 1);
  }
  return bucket;
}

function objectIdCandidate(value) {
  if (!/^[a-f0-9]{24}$/i.test(String(value || ''))) return null;
  try {
    const { ObjectId } = require('mongodb');
    return new ObjectId(String(value));
  } catch (error) {
    return null;
  }
}

function commentUrlCandidates(body) {
  const comment = body.comment || {};
  return [
    body.path,
    body.pageUrl,
    comment.url,
    comment.path,
    comment.href,
    comment.permalink,
  ].map(cleanString).filter(Boolean);
}

function buildCommentAuthorUpdate(user) {
  const publicUser = toPublicUser(user);
  const displayName = publicUser.displayName || publicUser.username || makeUsernameFromEmail(publicUser.email);
  const profileHandle = publicUser.username || publicUser.uid || publicUser.id;
  const profileUrl = `/user-center/?user=${encodeURIComponent(profileHandle)}`;
  const mailHash = emailMd5(publicUser.email);
  return {
    nick: displayName,
    mail: publicUser.email,
    mailMd5: mailHash,
    mailMD5: mailHash,
    link: profileUrl,
    avatar: publicUser.avatarUrl || '',
    avatarUrl: publicUser.avatarUrl || '',
    userId: publicUser.id,
    zeoraUserId: publicUser.id,
    zeoraUid: publicUser.uid || '',
    badgeLabel: publicUser.badgeLabel || '',
    badgeColor: publicUser.badgeColor || '',
    role: publicUser.role || 'user',
    commentExperience: publicUser.commentExperience || 0,
    commentLevel: publicUser.commentLevel || 1,
    commentLevelLabel: publicUser.commentLevelLabel || 'Lv.1',
    commentNextLevel: publicUser.commentNextLevel || 2,
    commentProgress: publicUser.commentProgress || 0,
    commentNextRequired: publicUser.commentNextRequired || 1,
    commentToNext: publicUser.commentToNext || 1,
    updatedAt: new Date().toISOString(),
    _zeoraCommentAuth: {
      userId: publicUser.id,
      uid: publicUser.uid || '',
      avatarUrl: publicUser.avatarUrl || '',
      displayName,
      profileUrl,
      badgeColor: publicUser.badgeColor || '',
      commentLevel: publicUser.commentLevel || 1,
      commentLevelLabel: publicUser.commentLevelLabel || 'Lv.1',
    },
  };
}

async function bindCommentAuthor(userCollection, commentCollection, user, body) {
  if (!commentCollection) return { updated: false, reason: 'comment collection unavailable' };

  const comment = body.comment || {};
  const response = body.response || {};
  const idCandidates = [...collectCommentIds(response), ...collectCommentIds(comment)]
    .map(cleanString)
    .filter(Boolean);
  const queries = [];

  for (const id of [...new Set(idCandidates)]) {
    queries.push({ id }, { commentId: id }, { uid: id });
    const objectId = objectIdCandidate(id);
    if (objectId) queries.push({ _id: objectId });
  }

  const commentText = cleanString(fieldValue(comment, ['comment', 'content', 'text', 'message']));
  const urls = commentUrlCandidates(body);
  const ownerClauses = commentOwnerClauses(user);
  const fallbackClauses = [
    { $or: ownerClauses },
  ];
  if (commentText) fallbackClauses.push({ $or: [{ comment: commentText }, { content: commentText }, { text: commentText }, { message: commentText }] });
  if (urls.length) fallbackClauses.push({ $or: urls.flatMap((url) => [{ url }, { path: url }, { href: url }, { permalink: url }]) });
  queries.push({ $and: fallbackClauses });

  const query = { $or: queries };
  const target = await commentCollection.findOne(query, {
    sort: { createdAt: -1, created: -1, insertedAt: -1, updatedAt: -1 },
  });
  if (!target) return { updated: false, reason: 'comment not found' };

  await commentCollection.updateOne({ _id: target._id }, { $set: buildCommentAuthorUpdate(user) });
  const refreshedUser = await refreshUserCommentStats(userCollection, commentCollection, user);
  const update = buildCommentAuthorUpdate(refreshedUser);
  await commentCollection.updateOne({ _id: target._id }, { $set: update });
  return {
    updated: true,
    commentId: String(target._id || target.id || target.commentId || ''),
    avatarUrl: update.avatarUrl,
    user: toPublicUser(refreshedUser),
  };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = getRequestUrl(req);
  const action = url.searchParams.get('action') || actionFromPath(url) || 'health';
  const needsBody = !['GET', 'HEAD'].includes(req.method);
  const body = needsBody ? await readBody(req) : {};
  const collection = await getMongoCollection();
  const codeCollection = await getCodeCollection();
  const notificationCollection = await getNotificationCollection();
  const commentCollection = await getCommentCollection().catch(() => null);
  const storageMode = collection ? 'mongodb' : 'memory';
  const runtimeConfig = await readTwikooRuntimeConfig();

  if (action === 'health' && req.method === 'GET') {
    send(res, 200, {
      ok: true,
      storageMode,
      adminProtected: true,
      authMode: 'email-code',
      captcha: captchaStatus(runtimeConfig),
      site: siteMeta(runtimeConfig),
      collection: collection ? COLLECTION_NAME : null,
    });
    return;
  }

  if (action === 'me' && req.method === 'GET') {
    const user = await refreshUserCommentStats(collection, commentCollection, await requireSessionUser(collection, req, body));
    send(res, 200, { ok: true, user: toPublicUser(user) });
    return;
  }

  if (action === 'profile' && req.method === 'GET') {
    const user = await refreshUserCommentStats(collection, commentCollection, await findUserByPublicHandle(collection, url.searchParams.get('handle')));
    if (!user || user.status === 'blocked') throw new HttpError(404, '用户不存在。');
    send(res, 200, { ok: true, user: toProfileUser(user) });
    return;
  }

  if (action === 'profileIndex' && req.method === 'GET') {
    send(res, 200, { ok: true, users: await listPublicProfiles(collection, commentCollection) });
    return;
  }

  if (action === 'requestCode' && req.method === 'POST') {
    await verifyCaptchaIfNeeded(runtimeConfig, body);
    send(res, 200, { ok: true, code: await requestLoginCode(codeCollection, body) });
    return;
  }

  if (action === 'verifyCode' && req.method === 'POST') {
    send(res, 200, { ok: true, ...(await verifyLoginCode(collection, codeCollection, body)) });
    return;
  }

  if (action === 'registerWithCode' && req.method === 'POST') {
    send(res, 201, { ok: true, ...(await registerUserWithCode(collection, codeCollection, body)) });
    return;
  }

  if (action === 'resetPassword' && req.method === 'POST') {
    send(res, 200, { ok: true, ...(await resetPasswordWithCode(collection, codeCollection, body)) });
    return;
  }

  if (action === 'notifications' && (req.method === 'GET' || req.method === 'POST')) {
    const user = await requireSessionUser(collection, req, body);
    send(res, 200, { ok: true, ...(await listNotifications(notificationCollection, commentCollection, user)) });
    return;
  }

  if (action === 'markNotifications' && req.method === 'POST') {
    const user = await requireSessionUser(collection, req, body);
    send(res, 200, { ok: true, ...(await markNotifications(notificationCollection, user, body)) });
    return;
  }

  if (action === 'bindCommentAuthor' && req.method === 'POST') {
    const user = await requireSessionUser(collection, req, body);
    send(res, 200, { ok: true, ...(await bindCommentAuthor(collection, commentCollection, user, body)) });
    return;
  }

  if (action === 'listUsers' && (req.method === 'GET' || req.method === 'POST')) {
    await authorizeAdmin(collection, req, body, url);
    send(res, 200, { ok: true, users: await listUsers(collection, commentCollection), storageMode });
    return;
  }

  if (action === 'createNotification' && req.method === 'POST') {
    const admin = await authorizeAdmin(collection, req, body, url);
    send(res, 201, { ok: true, ...(await createAdminNotification(collection, notificationCollection, body, admin)) });
    return;
  }

  if (action === 'register' && req.method === 'POST') {
    await verifyCaptchaIfNeeded(runtimeConfig, body);
    const user = await registerUser(collection, body);
    send(res, 201, { ok: true, user, sessionToken: signSession({ ...user, emailLower: normalizeEmail(user.email) }) });
    return;
  }

  if (action === 'login' && req.method === 'POST') {
    await verifyCaptchaIfNeeded(runtimeConfig, body);
    send(res, 200, { ok: true, ...(await loginUser(collection, body, commentCollection)) });
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

  if (action === 'redeemReward' && req.method === 'POST') {
    send(res, 200, { ok: true, ...(await redeemReward(collection, req, body)) });
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

  throw new HttpError(404, '未知的用户中心 API 操作。');
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
