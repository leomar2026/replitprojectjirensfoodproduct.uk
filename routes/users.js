const express = require('express');
const bcrypt  = require('bcrypt');
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function auditMeta(req) {
    return {
        userId:    req.session.userId   || null,
        userRole:  req.session.role     || null,
        ipAddress: req.ip               || null
    };
}

// GET /api/admin/users — list manager/cashier users
router.get('/', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, role, full_name, is_active
             FROM users WHERE role IN ('manager', 'cashier')
             ORDER BY username`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/admin/users error:', err);
        res.status(500).json({ error: 'Failed to load users.' });
    }
});

// POST /api/admin/users — create manager/cashier user
router.post('/', requireRole('admin'), async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !['manager', 'cashier'].includes(role)) {
        return res.status(400).json({ error: 'Username, password, and valid role (manager/cashier) are required.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existing = await client.query(
            'SELECT id FROM users WHERE username = $1',
            [username.trim().toLowerCase()]
        );
        if (existing.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'That username already exists.' });
        }
        const passwordHash = await bcrypt.hash(password, 12);
        const cleanUsername = username.trim().toLowerCase();
        const placeholderEmail = `${cleanUsername}@jirensfood.internal`;
        const result = await client.query(
            `INSERT INTO users (username, email, password, role, full_name, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             RETURNING id, username, role, full_name, is_active`,
            [cleanUsername, placeholderEmail, passwordHash, role, username.trim()]
        );
        const meta = auditMeta(req);
        await client.query(
            `INSERT INTO audit_logs (action, entity_type, entity_id, user_name, details, user_id, user_role, ip_address)
             VALUES ('user_created', 'user', $1, $2, $3, $4, $5, $6)`,
            [String(result.rows[0].id), req.session.username,
             JSON.stringify({ created_username: username.trim().toLowerCase(), role }),
             meta.userId, meta.userRole, meta.ipAddress]
        );
        await client.query('COMMIT');
        res.status(201).json({ message: 'User created.', user: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/admin/users error:', err);
        res.status(500).json({ error: 'Failed to create user.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/users/:id/toggle — toggle active status
router.patch('/:id/toggle', requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE users SET is_active = NOT is_active
             WHERE id = $1 AND role IN ('manager', 'cashier')
             RETURNING id, username, role, is_active`,
            [req.params.id]
        );
        if (!result.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found.' });
        }
        const toggled = result.rows[0];
        const meta = auditMeta(req);
        await client.query(
            `INSERT INTO audit_logs (action, entity_type, entity_id, user_name, details, user_id, user_role, ip_address)
             VALUES ($1, 'user', $2, $3, $4, $5, $6, $7)`,
            [
                toggled.is_active ? 'user_enabled' : 'user_disabled',
                String(toggled.id), req.session.username,
                JSON.stringify({ affected_username: toggled.username, role: toggled.role, is_active: toggled.is_active }),
                meta.userId, meta.userRole, meta.ipAddress
            ]
        );
        await client.query('COMMIT');
        res.json({ message: 'Toggled.', user: toggled });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('PATCH /api/admin/users/:id/toggle error:', err);
        res.status(500).json({ error: 'Failed to toggle user.' });
    } finally {
        client.release();
    }
});

// DELETE /api/admin/users/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `DELETE FROM users WHERE id=$1 AND role IN ('manager','cashier') RETURNING id, username, role`,
            [req.params.id]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found.' }); }
        const meta = { userId: req.session.userId || null, userRole: req.session.role || null, ipAddress: req.ip || null };
        await client.query(
            `INSERT INTO audit_logs (action, entity_type, entity_id, user_name, details, user_id, user_role, ip_address)
             VALUES ('user_deleted', 'user', $1, $2, $3, $4, $5, $6)`,
            [String(result.rows[0].id), req.session.username,
             JSON.stringify({ deleted_username: result.rows[0].username, role: result.rows[0].role }),
             meta.userId, meta.userRole, meta.ipAddress]
        );
        await client.query('COMMIT');
        res.json({ message: 'User deleted.' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to delete user.' });
    } finally {
        client.release();
    }
});

module.exports = router;
