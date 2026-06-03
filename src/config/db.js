const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME || 'food_bot',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+05:30',
  charset: 'utf8mb4'
});

// Fix encoding on every connection
pool.on('connection', (conn) => {
  conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
});

pool.getConnection()
  .then(conn => {
    conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    console.log('✅ MySQL connected');
    conn.release();
  })
  .catch(err => console.error('❌ MySQL connection failed:', err.message));

module.exports = pool;
