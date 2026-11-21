const crypto = require('crypto');

const COOKIE = 'ra_admin';
const TTL_SECONDS = 60 * 60 * 24 * 7;

const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (data) =>
  crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(data).digest('base64url');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ADMIN_PASSWORD_HASH format: "<saltHex>:<scryptHex>" (see scripts/hash-password.js)
exports.hashPassword = (password, saltHex) => {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex');
  return salt + ':' + hash;
};

exports.authConfigured = () =>
  Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD_HASH && process.env.SESSION_SECRET);

exports.checkCredentials = (user, password) => {
  const [salt, hash] = String(process.env.ADMIN_PASSWORD_HASH || ':').split(':');
  // always run scrypt so timing doesn't reveal whether the username matched
  const candidate = exports.hashPassword(String(password || ''), salt || '00').split(':')[1];
  const userOk = safeEqual(user || '', process.env.ADMIN_USER || '');
  const passOk = safeEqual(candidate, hash || '');
  return userOk && passOk;
};

exports.sessionCookie = (user) => {
  const payload = b64(JSON.stringify({ u: user, exp: Date.now() + TTL_SECONDS * 1000 }));
  const token = payload + '.' + sign(payload);
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL_SECONDS}`;
};

exports.clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

exports.isAuthed = (req) => {
  if (!exports.authConfigured()) return false;
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return false;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return u === process.env.ADMIN_USER && exp > Date.now();
  } catch {
    return false;
  }
};

exports.json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

exports.readBody = (req) => {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  try {
    return JSON.parse(b || '{}');
  } catch {
    return {};
  }
};
