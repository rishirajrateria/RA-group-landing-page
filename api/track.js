const redis = require('./_lib/redis');

const TYPES = new Set(['pageview', 'cta_hero', 'phone', 'email', 'map']);
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|screenshot|monitor|uptime/i;

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const dec = (v) => {
  try {
    return decodeURIComponent(String(v || ''));
  } catch {
    return String(v || '');
  }
};

function device(ua) {
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|android|iphone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function refHost(ref) {
  try {
    return ref ? new URL(ref).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end();
  }
  const ua = String(req.headers['user-agent'] || '');
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};
  if (BOT.test(ua) || !TYPES.has(body.e) || !redis.configured()) {
    res.statusCode = 204;
    return res.end();
  }
  const h = req.headers;
  const event = {
    t: Date.now(),
    e: body.e,
    l: clip(body.l, 40),
    v: clip(body.v, 40),
    p: clip(body.p, 80),
    ref: refHost(clip(body.r, 300)),
    c: clip(h['x-vercel-ip-country'], 2) || '??',
    r: clip(dec(h['x-vercel-ip-country-region']), 40),
    ci: clip(dec(h['x-vercel-ip-city']), 60),
    d: device(ua),
  };
  try {
    await redis.pipeline([
      ['LPUSH', redis.EVENTS_KEY, JSON.stringify(event)],
      ['LTRIM', redis.EVENTS_KEY, 0, redis.MAX_EVENTS - 1],
    ]);
  } catch (err) {
    console.error('track failed', err.message);
  }
  res.statusCode = 204;
  res.end();
};
