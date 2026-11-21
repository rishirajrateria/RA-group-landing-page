// Minimal Upstash Redis REST client (works with the Vercel Marketplace Upstash/KV integration).
const cfg = () => ({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

exports.configured = () => {
  const { url, token } = cfg();
  return Boolean(url && token);
};

async function call(path, body) {
  const { url, token } = cfg();
  const r = await fetch(url + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('Redis HTTP ' + r.status);
  return r.json();
}

exports.cmd = async (args) => {
  const j = await call('', args);
  if (j.error) throw new Error(j.error);
  return j.result;
};

exports.pipeline = async (cmds) => {
  const j = await call('/pipeline', cmds);
  return j.map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
};

exports.EVENTS_KEY = 'ra:events';
exports.MAX_EVENTS = 20000;
