const auth = require('../_lib/auth');
const redis = require('../_lib/redis');

const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 15 * 60;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return auth.json(res, 405, { error: 'method' });
  if (!auth.authConfigured()) {
    return auth.json(res, 503, { error: 'Admin login is not configured yet. Set ADMIN_USER, ADMIN_PASSWORD_HASH and SESSION_SECRET in Vercel.' });
  }

  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const key = 'ra:rl:' + ip;
  if (redis.configured()) {
    try {
      const [n] = await redis.pipeline([['INCR', key], ['EXPIRE', key, WINDOW_SECONDS, 'NX']]);
      if (n > MAX_ATTEMPTS) return auth.json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    } catch (err) {
      console.error('rate limit failed', err.message);
    }
  }

  const { username, password } = auth.readBody(req);
  if (!auth.checkCredentials(username, password)) {
    return auth.json(res, 401, { error: 'Wrong username or password.' });
  }
  if (redis.configured()) redis.cmd(['DEL', key]).catch(() => {});
  res.setHeader('set-cookie', auth.sessionCookie(process.env.ADMIN_USER));
  auth.json(res, 200, { ok: true });
};
