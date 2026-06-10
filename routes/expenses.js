const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { nextSerialNumber, addAuditLog } = require('../utils/db-helpers');

function requireRole(...roles) {
    const levels = { admin: 3, manager: 2, cashier: 1 };
    const min = Math.min(...roles.map((r) => levels[r] || 0));
    return (req, res, next) => {
        if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated.' });
        if ((levels[req.session.role] || 0) < min) return res.status(403).json({ error: 'Insufficient permissions.' });
        next();
    };
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function periodToRange(period) {
    const today = new Date().toISOString().slice(0, 10);
    if (!period || period === 'all') return { from: null, to: null };
    if (period === 'daily') return { from: today, to: today };
    if (period === 'monthly') return { from: today.slice(0, 7) + '-01', to: today };
    if (period === 'yearly') return { from: today.slice(0, 4) + '-01-01', to: today };
    if (period === 'weekly') {
        const d = new Date();
        const day = d.getDay();
        const start = new Date(d);
        start.setDate(d.getDate() - day);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return {
            from: start.toISOString().slice(0, 10),
            to: end.toISOString().slice(0, 10)
        };
    }
    return { from: null, to: null };
}

// GET /api/admin/expenses
router.get('/', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const { period, category, vendor, payment, status, user, from, to,
                page = 1, limit = 100 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const conditions = [];
        const params = [];

        let fromDate = from || null;
        let toDate = to || null;
        if (!fromDate && !toDate && period) {
            const range = periodToRange(period);
            fromDate = range.from;
            toDate = range.to;
        }

        if (fromDate) { params.push(fromDate); conditions.push(`expense_date >= $${params.length}`); }
        if (toDate)   { params.push(toDate);   conditions.push(`expense_date <= $${params.length}`); }
        if (category) { params.push(category); conditions.push(`category = $${params.length}`); }
        if (vendor)   { params.push(`%${vendor}%`); conditions.push(`vendor ILIKE $${params.length}`); }
        if (payment)  { params.push(payment);  conditions.push(`payment_method = $${params.length}`); }
        if (status)   { params.push(status);   conditions.push(`status = $${params.length}`); }
        if (user)     { params.push(`%${user}%`); conditions.push(`created_by ILIKE $${params.length}`); }

        if (req.session.role === 'cashier') {
            params.push(req.session.fullName || req.session.username);
            conditions.push(`created_by = $${params.length}`);
        }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const countRes = await pool.query(`SELECT COUNT(*) FROM expenses ${where}`, params);
        const total = Number(countRes.rows[0].count);

        params.push(Number(limit));
        params.push(offset);
        const dataRes = await pool.query(
            `SELECT * FROM expenses ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        res.json({
            expenses: dataRes.rows,
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit))
        });
    } catch (err) {
        console.error('GET /expenses error:', err);
        res.status(500).json({ error: 'Failed to load expenses.' });
    }
});

// POST /api/admin/expenses
router.post('/', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const expenseNumber = await nextSerialNumber(client, 'EXP');
        const {
            expense_date, category, vendor, description, amount,
            payment_method, reference_number,
            attachment_name, attachment_type, attachment_data,
            remarks
        } = req.body;

        if (!amount || Number(amount) <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid expense amount.' });
        }

        const result = await client.query(`
            INSERT INTO expenses
              (expense_number, expense_date, category, vendor, description, amount,
               payment_method, reference_number,
               attachment_name, attachment_type, attachment_data,
               remarks, status, created_by, created_by_role)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Pending',$13,$14)
            RETURNING *
        `, [
            expenseNumber,
            expense_date || new Date().toISOString().slice(0, 10),
            category || 'Miscellaneous',
            vendor || null,
            description || null,
            Number(amount),
            payment_method || 'Cash',
            reference_number || null,
            attachment_name || null,
            attachment_type || null,
            attachment_data || null,
            remarks || null,
            req.session.fullName || req.session.username,
            req.session.role
        ]);

        await addAuditLog(client, 'expense_created', 'expense', expenseNumber,
            req.session.fullName || req.session.username, { amount, category });

        await client.query('COMMIT');
        res.status(201).json({ message: `Expense ${expenseNumber} submitted for approval.`, expense: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /expenses error:', err);
        res.status(500).json({ error: 'Failed to create expense.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/expenses/:expenseNumber/approve
router.patch('/:expenseNumber/approve', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`
            UPDATE expenses
            SET status = 'Approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
            WHERE expense_number = $2 AND status = 'Pending'
            RETURNING *
        `, [req.session.fullName || req.session.username, req.params.expenseNumber]);

        if (!result.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Expense not found or already processed.' });
        }

        await addAuditLog(client, 'expense_approved', 'expense', req.params.expenseNumber,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Expense approved.', expense: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('PATCH /expenses/approve error:', err);
        res.status(500).json({ error: 'Failed to approve expense.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/expenses/:expenseNumber/reject
router.patch('/:expenseNumber/reject', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`
            UPDATE expenses
            SET status = 'Rejected', rejected_by = $1, rejected_at = NOW(), updated_at = NOW()
            WHERE expense_number = $2 AND status = 'Pending'
            RETURNING *
        `, [req.session.fullName || req.session.username, req.params.expenseNumber]);

        if (!result.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Expense not found or already processed.' });
        }

        await addAuditLog(client, 'expense_rejected', 'expense', req.params.expenseNumber,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Expense rejected.', expense: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('PATCH /expenses/reject error:', err);
        res.status(500).json({ error: 'Failed to reject expense.' });
    } finally {
        client.release();
    }
});

// GET /api/admin/expense-categories
router.get('/categories', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM expense_categories ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load expense categories.' });
    }
});

// POST /api/admin/expense-categories
router.post('/categories', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { name, active = true } = req.body;
        if (!name) return res.status(400).json({ error: 'Category name is required.' });

        const result = await client.query(`
            INSERT INTO expense_categories (name, active)
            VALUES ($1, $2)
            ON CONFLICT (name) DO UPDATE SET active = EXCLUDED.active, updated_at = NOW()
            RETURNING *
        `, [name.trim(), active]);

        await addAuditLog(client, 'expense_category_saved', 'expense_category', name,
            req.session.fullName || req.session.username, { active });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Expense category saved.', category: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to save expense category.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/expense-categories/:id/toggle
router.patch('/categories/:id/toggle', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`
            UPDATE expense_categories SET active = NOT active, updated_at = NOW()
            WHERE id = $1 RETURNING *
        `, [req.params.id]);
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        await addAuditLog(client, 'expense_category_toggled', 'expense_category', String(req.params.id),
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Toggled.', category: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to toggle.' });
    } finally {
        client.release();
    }
});

module.exports = router;
