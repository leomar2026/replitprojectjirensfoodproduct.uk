const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { addAuditLog } = require('../utils/db-helpers');

function requireRole(...roles) {
    const levels = { admin: 3, manager: 2, cashier: 1 };
    const min = Math.min(...roles.map((r) => levels[r] || 0));
    return (req, res, next) => {
        if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated.' });
        if ((levels[req.session.role] || 0) < min) return res.status(403).json({ error: 'Insufficient permissions.' });
        next();
    };
}

// GET /api/admin/vendors
router.get('/', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const { search, status, page = 1, limit = 200 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);
        const conditions = [];
        const params = [];
        if (search) { params.push(`%${search}%`); const n = params.length; conditions.push(`(name ILIKE $${n} OR contact_person ILIKE $${n} OR phone ILIKE $${n} OR email ILIKE $${n} OR address ILIKE $${n})`); }
        if (status === 'active')   { conditions.push('active = TRUE'); }
        if (status === 'inactive') { conditions.push('active = FALSE'); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const countRes = await pool.query(`SELECT COUNT(*) FROM vendors ${where}`, params);
        const total = Number(countRes.rows[0].count);
        params.push(Number(limit)); params.push(offset);
        const dataRes = await pool.query(`SELECT * FROM vendors ${where} ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        res.json({ vendors: dataRes.rows, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
    } catch (err) {
        console.error('GET /vendors error:', err);
        res.status(500).json({ error: 'Failed to load vendors.' });
    }
});

// POST /api/admin/vendors
router.post('/', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { name, contact_person, phone, email, address, active = true } = req.body;
        if (!name) return res.status(400).json({ error: 'Vendor name is required.' });
        const result = await client.query(`
            INSERT INTO vendors (name, contact_person, phone, email, address, active)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
        `, [name.trim(), contact_person || null, phone || null, email || null, address || null, active]);
        await addAuditLog(client, 'vendor_created', 'vendor', String(result.rows[0].id),
            req.session.fullName || req.session.username, { name });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Vendor added.', vendor: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to add vendor.' });
    } finally {
        client.release();
    }
});

// PUT /api/admin/vendors/:id
router.put('/:id', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { name, contact_person, phone, email, address, active } = req.body;
        const result = await client.query(`
            UPDATE vendors SET name=$1, contact_person=$2, phone=$3, email=$4, address=$5,
                active=$6, updated_at=NOW()
            WHERE id=$7 RETURNING *
        `, [name, contact_person || null, phone || null, email || null, address || null, active !== false, req.params.id]);
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Vendor not found.' }); }
        await addAuditLog(client, 'vendor_updated', 'vendor', req.params.id,
            req.session.fullName || req.session.username, { name });
        await client.query('COMMIT');
        res.json({ message: 'Vendor updated.', vendor: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to update vendor.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/vendors/:id/toggle
router.patch('/:id/toggle', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'UPDATE vendors SET active = NOT active, updated_at=NOW() WHERE id=$1 RETURNING *',
            [req.params.id]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        await addAuditLog(client, 'vendor_toggled', 'vendor', req.params.id,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Toggled.', vendor: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to toggle vendor.' });
    } finally {
        client.release();
    }
});

// DELETE /api/admin/vendors/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('DELETE FROM vendors WHERE id=$1 RETURNING *', [req.params.id]);
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Vendor not found.' }); }
        await addAuditLog(client, 'vendor_deleted', 'vendor', req.params.id,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Vendor deleted.' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to delete vendor.' });
    } finally {
        client.release();
    }
});

module.exports = router;
