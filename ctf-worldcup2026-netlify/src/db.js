const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Thiếu DATABASE_URL trong biến môi trường (connection string Supabase Postgres, dùng Connection Pooling / port 6543).');
}

// Trong môi trường serverless (Netlify Functions), mỗi lần "nguội" (cold start)
// có thể tạo pool mới -> dùng max nhỏ để không làm cạn kết nối tới Supabase pooler.
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10000,
});

async function query(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

module.exports = { pool, query, queryOne };
