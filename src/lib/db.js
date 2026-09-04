const { Pool } = require("pg");

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return _pool;
}

let _migrated = false;

async function ensureSchema() {
  if (_migrated) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS treelife_scores (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(20)  NOT NULL,
      game_id       VARCHAR(30)  NOT NULL,
      score         INTEGER      NOT NULL DEFAULT 0,
      opponent_type VARCHAR(10)  NOT NULL DEFAULT 'bot',
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
  `);
  _migrated = true;
}

module.exports = { getPool, ensureSchema };
