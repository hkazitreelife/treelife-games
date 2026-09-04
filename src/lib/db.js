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
      user_id       TEXT,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
  `);

  // Create users table for NextAuth
  await pool.query(`
    CREATE TABLE IF NOT EXISTS treelife_users (
      id            TEXT PRIMARY KEY,
      name          VARCHAR(255),
      email         VARCHAR(255) UNIQUE,
      image         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Add user_id column to treelife_scores if not exists (for existing tables)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE treelife_scores ADD COLUMN IF NOT EXISTS user_id TEXT;
    EXCEPTION WHEN duplicate_column THEN null;
    END $$;
  `);

  _migrated = true;
}

module.exports = { getPool, ensureSchema };
