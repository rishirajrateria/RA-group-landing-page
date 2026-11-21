const auth = require('../_lib/auth');
const redis = require('../_lib/redis');

const CLICK_TYPES = ['cta_hero', 'phone', 'email', 'map'];

const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);
const dayKey = (t, offsetMin) => new Date(t + offsetMin * 60000).toISOString().slice(0, 10);

function bump(map, key, init) {
  if (!map.has(key)) map.set(key, init());
  return map.get(key);
}

const newRow = (c, ci) => ({ c, ci, views: 0, clicks: 0, cta_hero: 0, phone: 0, email: 0, map: 0, vs: new Set(), cs: new Set() });

function finishRows(map) {
  return [...map.values()]
    .map((r) => ({
      c: r.c, ci: r.ci, views: r.views, visitors: r.vs.size, clicks: r.clicks,
      cta_hero: r.cta_hero, phone: r.phone, email: r.email, map: r.map,
      ctr: r.vs.size ? r.cs.size / r.vs.size : 0,
    }))
    .sort((a, b) => b.views + b.clicks - (a.views + a.clicks));
}

const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

module.exports = async (req, res) => {
  if (!auth.isAuthed(req)) return auth.json(res, 401, { error: 'unauthorized' });
  if (!redis.configured()) return auth.json(res, 200, { configured: false });

  const q = req.query || {};
  const offset = num(q.tz, 0); // client's UTC offset in minutes
  let raw;
  try {
    raw = await redis.cmd(['LRANGE', redis.EVENTS_KEY, 0, redis.MAX_EVENTS - 1]);
  } catch (err) {
    return auth.json(res, 500, { error: 'Could not read analytics storage: ' + err.message });
  }
  const all = [];
  for (const s of raw) {
    try { all.push(JSON.parse(s)); } catch { /* skip corrupt row */ }
  }

  const from = num(q.from, 0);
  const to = num(q.to, Date.now());
  const inRange = all.filter((e) => e.t >= from && e.t <= to);

  // dropdown options come from the date range only, cities narrow by chosen country
  const cCount = new Map();
  const ciCount = new Map();
  for (const e of inRange) {
    cCount.set(e.c, (cCount.get(e.c) || 0) + 1);
    if (!q.country || e.c === q.country) {
      const k = e.c + '|' + (e.ci || '');
      ciCount.set(k, (ciCount.get(k) || 0) + 1);
    }
  }
  const options = {
    countries: [...cCount].map(([c, n]) => ({ c, n })).sort((a, b) => b.n - a.n),
    cities: [...ciCount].map(([k, n]) => { const [c, ci] = k.split('|'); return { c, ci, n }; }).sort((a, b) => b.n - a.n),
  };

  const ev = inRange.filter((e) =>
    (!q.country || e.c === q.country) &&
    (!q.city || (e.ci || '') === (q.city === '(unknown)' ? '' : q.city)) &&
    (!q.device || e.d === q.device) &&
    (!q.source || (q.source === 'direct' ? !e.ref : e.ref === q.source)));

  if (q.csv) {
    const head = ['time_iso', 'event', 'label', 'country', 'region', 'city', 'device', 'referrer', 'visitor_id', 'path'];
    const lines = [head.join(',')].concat(
      ev.map((e) => [new Date(e.t).toISOString(), e.e, e.l, e.c, e.r, e.ci, e.d, e.ref, e.v, e.p].map(csvCell).join(',')));
    res.statusCode = 200;
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="ra-group-analytics.csv"');
    res.setHeader('cache-control', 'no-store');
    return res.end(lines.join('\n'));
  }

  const visitors = new Set();
  const clickers = new Set();
  const byType = { pageview: 0, cta_hero: 0, phone: 0, email: 0, map: 0 };
  const mapLabels = {};
  const refs = new Map();
  const devices = { desktop: 0, mobile: 0, tablet: 0 };
  const days = new Map();
  const byCountry = new Map();
  const byCity = new Map();

  for (const e of ev) {
    const isView = e.e === 'pageview';
    visitors.add(e.v);
    if (!isView) clickers.add(e.v);
    byType[e.e] = (byType[e.e] || 0) + 1;
    if (e.e === 'map' && e.l) mapLabels[e.l] = (mapLabels[e.l] || 0) + 1;
    if (isView) {
      refs.set(e.ref || 'direct', (refs.get(e.ref || 'direct') || 0) + 1);
      devices[e.d] = (devices[e.d] || 0) + 1;
    }
    const day = bump(days, dayKey(e.t, offset), () => ({ views: 0, clicks: 0, vs: new Set() }));
    day.vs.add(e.v);
    isView ? day.views++ : day.clicks++;

    for (const [map, key, row] of [
      [byCountry, e.c, () => newRow(e.c, '')],
      [byCity, e.c + '|' + (e.ci || ''), () => newRow(e.c, e.ci || '(unknown)')],
    ]) {
      const r = bump(map, key, row);
      r.vs.add(e.v);
      if (isView) r.views++;
      else { r.clicks++; r.cs.add(e.v); if (CLICK_TYPES.includes(e.e)) r[e.e]++; }
    }
  }

  // continuous daily series (capped to the most recent 120 days)
  const series = [];
  if (ev.length) {
    const minT = ev.reduce((m, e) => Math.min(m, e.t), Infinity);
    const first = from ? Math.max(from, minT) : minT;
    const start = Math.max(first, to - 119 * 86400000);
    for (let t = start; t <= to + 1; t += 86400000) {
      const k = dayKey(t, offset);
      if (series.length && series[series.length - 1].d === k) continue;
      const d = days.get(k);
      series.push({ d: k, views: d ? d.views : 0, clicks: d ? d.clicks : 0, visitors: d ? d.vs.size : 0 });
    }
  }

  const clickTotal = CLICK_TYPES.reduce((n, k) => n + (byType[k] || 0), 0);
  auth.json(res, 200, {
    configured: true,
    totals: {
      views: byType.pageview,
      visitors: visitors.size,
      clicks: clickTotal,
      clickers: clickers.size,
      ctr: visitors.size ? clickers.size / visitors.size : 0,
    },
    byType, mapLabels, devices,
    sources: [...refs].map(([s, n]) => ({ s, n })).sort((a, b) => b.n - a.n).slice(0, 8),
    series,
    countries: finishRows(byCountry),
    cities: finishRows(byCity).slice(0, 200),
    options,
    recent: ev.slice(0, 200),
    capped: all.length >= redis.MAX_EVENTS,
  });
};
