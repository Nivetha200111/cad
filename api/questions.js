// GET /api/questions — returns the full question bank from Postgres (auto-seeds).
const { sql, init } = require('./_db');

module.exports = async (req, res) => {
  try {
    await init();
    const { rows } = await sql`SELECT id, topic, q, options, correct, explanation FROM questions ORDER BY id`;
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).json({ questions: rows });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
