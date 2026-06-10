require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool } = require('../db');

const MIGRATIONS = [
    path.join(__dirname, '..', 'database', 'migrations.sql'),
    path.join(__dirname, '..', 'database', 'migrations_phase4.sql'),
    path.join(__dirname, '..', 'database', 'migrations_ice_pack.sql'),
    path.join(__dirname, '..', 'database', 'migrations_phase5.sql'),
    path.join(__dirname, '..', 'database', 'migrations_phase6.sql')
];

async function migrate() {
    console.log('Running database migrations...');

    for (const sqlPath of MIGRATIONS) {
        if (!fs.existsSync(sqlPath)) {
            console.log(`Skipping (not found): ${path.basename(sqlPath)}`);
            continue;
        }
        console.log(`Applying: ${path.basename(sqlPath)}`);
        const sql = fs.readFileSync(sqlPath, 'utf8');
        try {
            await pool.query(sql);
            console.log(`  \u2713 ${path.basename(sqlPath)}`);
        } catch (err) {
            if (err.message.includes('already exists')) {
                console.log(`  \u2713 ${path.basename(sqlPath)} (schema already up to date)`);
            } else {
                console.error(`  \u2717 ${path.basename(sqlPath)}: ${err.message}`);
                process.exit(1);
            }
        }
    }

    console.log('All migrations complete.');
    await pool.end();
}

migrate();
