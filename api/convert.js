/*
 * LaTeX → 한글(HWP) 수식 변환 API
 * POST /api/convert  { "latex": "..." }  → { "result": "..." }
 * GET  /api/convert?latex=...            → { "result": "..." }
 */
const converter = require('../src/converter.js');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  let latex;

  if (req.method === 'GET') {
    latex = req.query.latex;
  } else if (req.method === 'POST') {
    latex = req.body && req.body.latex;
  } else {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!latex || typeof latex !== 'string') {
    return res.status(400).json({ error: '`latex` 필드가 필요합니다.' });
  }

  const result = converter.convert(latex);
  return res.status(200).json({ result });
};
