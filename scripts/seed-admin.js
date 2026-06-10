require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('../db');

const ADMIN = {
    username: 'admin',
    email: 'admin@jirensfood.com',
    password: 'Admin@1234',
    role: 'admin',
    full_name: "Jiren's Admin"
};

async function seedAdmin() {
    console.log('Seeding admin user...');

    try {
        // Check if admin already exists
        const existing = await pool.query(
            'SELECT id, username FROM users WHERE username = $1',
            [ADMIN.username]
        );

        if (existing.rows.length > 0) {
            console.log(`Admin user '${ADMIN.username}' already exists (id: ${existing.rows[0].id}). Skipping.`);
            return;
        }

        const passwordHash = await bcrypt.hash(ADMIN.password, 12);

        const result = await pool.query(
            `INSERT INTO users (username, email, password, role, full_name)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, username, email, role`,
            [ADMIN.username, ADMIN.email, passwordHash, ADMIN.role, ADMIN.full_name]
        );

        const user = result.rows[0];
        console.log('Admin user created successfully:');
        console.log(`  ID:       ${user.id}`);
        console.log(`  Username: ${user.username}`);
        console.log(`  Email:    ${user.email}`);
        console.log(`  Role:     ${user.role}`);
        console.log(`  Password: ${ADMIN.password}  <-- Change this after first login!`);
    } catch (err) {
        console.error('Seed failed:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

seedAdmin();
