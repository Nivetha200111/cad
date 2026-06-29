// Shared DB helper: lazy table creation + one-shot question seeding.
// Files prefixed with "_" are not exposed as routes by Vercel.

// @vercel/postgres expects POSTGRES_URL. Vercel's Neon integration sometimes
// only sets DATABASE_URL (or the *_NON_POOLING / *_PRISMA_URL variants), so map
// whichever exists before the client initializes.
if (!process.env.POSTGRES_URL) {
  const cs = process.env.POSTGRES_PRISMA_URL
    || process.env.DATABASE_URL
    || process.env.POSTGRES_URL_NON_POOLING
    || process.env.DATABASE_URL_UNPOOLED;
  if (cs) process.env.POSTGRES_URL = cs;
}

const { sql } = require('@vercel/postgres');
const seed = require('./_seed.json');

async function init() {
  if (globalThis.__cadInit) return;
  await sql`CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    topic TEXT NOT NULL,
    q TEXT NOT NULL,
    options JSONB NOT NULL,
    correct JSONB NOT NULL,
    explanation TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS attempts (
    id SERIAL PRIMARY KEY,
    player TEXT NOT NULL,
    quiz INT NOT NULL,
    pct INT NOT NULL,
    correct INT NOT NULL,
    total INT NOT NULL,
    per_topic JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attempts_player ON attempts (player)`;

  const { rows } = await sql`SELECT COUNT(*)::int AS n FROM questions`;
  if (rows[0].n === 0) {
    // bulk insert all questions in a single statement
    await sql`
      INSERT INTO questions (topic, q, options, correct, explanation)
      SELECT x.topic, x.q, x.options, x.correct, x.explanation
      FROM jsonb_to_recordset(${JSON.stringify(seed)}::jsonb)
        AS x(topic text, q text, options jsonb, correct jsonb, explanation text)
    `;
  }
  globalThis.__cadInit = true;
}

module.exports = { sql, init };
