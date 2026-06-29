// /api/attempts
//   POST  { player, quiz, pct, correct, total, perTopic }  -> save an attempt
//   GET   ?player=NAME   -> that player's attempts
//   GET   (no player)    -> leaderboard (best score per player)
const { sql, init } = require('./_db');

module.exports = async (req, res) => {
  try {
    await init();

    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
      b = b || {};
      const player = String(b.player || '').trim().slice(0, 80);
      if (!player) return res.status(400).json({ error: 'player required' });
      const { rows } = await sql`
        INSERT INTO attempts (player, quiz, pct, correct, total, per_topic, missed)
        VALUES (${player}, ${b.quiz | 0}, ${b.pct | 0}, ${b.correct | 0}, ${b.total | 0}, ${JSON.stringify(b.perTopic || {})}, ${JSON.stringify(b.missed || [])})
        RETURNING id, created_at`;
      return res.status(201).json({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
    }

    if (req.method === 'GET') {
      const player = String((req.query && req.query.player) || '').trim();
      if (player) {
        const { rows } = await sql`
          SELECT id, quiz, pct, correct, total, per_topic, missed, created_at
          FROM attempts WHERE player = ${player}
          ORDER BY created_at DESC LIMIT 300`;
        return res.status(200).json({ attempts: rows });
      }
      const { rows } = await sql`
        SELECT player, MAX(pct) AS best, COUNT(*)::int AS attempts, MAX(created_at) AS last_seen
        FROM attempts GROUP BY player
        ORDER BY best DESC, attempts DESC LIMIT 50`;
      return res.status(200).json({ leaderboard: rows });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
