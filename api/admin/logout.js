const auth = require('../_lib/auth');

module.exports = (req, res) => {
  res.setHeader('set-cookie', auth.clearCookie());
  auth.json(res, 200, { ok: true });
};
