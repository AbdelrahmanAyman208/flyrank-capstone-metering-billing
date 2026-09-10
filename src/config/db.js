/**
 * Database connection pool.
 * 
 * Uses a single Pool instance shared across the entire app.
 * Connection string comes from DATABASE_URL env var — never hardcoded.
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Sensible defaults for a single-server app
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log connection errors (but never log the connection string — it contains the password)
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

module.exports = pool;
