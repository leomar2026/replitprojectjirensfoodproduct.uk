require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
});

async function testConnection() {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        return true;
    } catch (err) {
        console.error('Database connection failed:', err.message);
        return false;
    }
}

module.exports = { pool, testConnection };
