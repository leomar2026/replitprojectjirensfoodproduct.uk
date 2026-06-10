const express = require('express');
const bcrypt   = require('bcrypt');
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Transactional tables (deleted on cleanup) ─────────────────────────────────
// Master data (products, users, categories, uom, vendors, delivery_fee_rules,
// bank_details, promotions, tax_settings, currency_settings, expense_categories,
// number_series) is NEVER touched by cleanup.

// GET /api/admin/maintenance/counts
router.get('/counts', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM orders)                  AS orders,
                (SELECT COUNT(*) FROM order_items)             AS order_items,
                (SELECT COUNT(*) FROM sales_transactions)      AS sales_transactions,
                (SELECT COUNT(*) FROM sales_transaction_items) AS sales_transaction_items,
                (SELECT COUNT(*) FROM inventory_movements)     AS inventory_movements,
                (SELECT COUNT(*) FROM payment_proofs)          AS payment_proofs,
                (SELECT COUNT(*) FROM expenses)                AS expenses
        `);
        const row = result.rows[0];
        const counts = {
            orders:               Number(row.orders),
            orderItems:           Number(row.order_items),
            salesTransactions:    Number(row.sales_transactions),
            salesTransactionItems:Number(row.sales_transaction_items),
            inventoryMovements:   Number(row.inventory_movements),
            paymentProofs:        Number(row.payment_proofs),
            expenses:             Number(row.expenses),
        };
        counts.total = Object.values(counts).reduce((s, v) => s + v, 0);
        res.json(counts);
    } catch (err) {
        console.error('GET /maintenance/counts error:', err);
        res.status(500).json({ error: 'Failed to fetch counts.' });
    }
});

// POST /api/admin/maintenance/cleanup
// Body: { password: string, resetSeries: boolean }
router.post('/cleanup', requireRole('admin'), async (req, res) => {
    const { password, resetSeries } = req.body;
    if (!password) return res.status(400).json({ error: 'Admin password is required.' });

    const client = await pool.connect();
    try {
        // Verify admin password
        const userRes = await client.query(
            'SELECT password FROM users WHERE id = $1 AND role = $2',
            [req.session.userId, 'admin']
        );
        if (!userRes.rows.length) {
            client.release();
            return res.status(403).json({ error: 'Admin user not found.' });
        }
        const match = await bcrypt.compare(password, userRes.rows[0].password);
        if (!match) {
            client.release();
            return res.status(403).json({ error: 'Incorrect admin password.' });
        }

        await client.query('BEGIN');

        // Snapshot counts before deletion
        const beforeRes = await client.query(`
            SELECT
                (SELECT COUNT(*) FROM orders)                  AS orders,
                (SELECT COUNT(*) FROM order_items)             AS order_items,
                (SELECT COUNT(*) FROM sales_transactions)      AS sales_transactions,
                (SELECT COUNT(*) FROM sales_transaction_items) AS sales_transaction_items,
                (SELECT COUNT(*) FROM inventory_movements)     AS inventory_movements,
                (SELECT COUNT(*) FROM payment_proofs)          AS payment_proofs,
                (SELECT COUNT(*) FROM expenses)                AS expenses
        `);
        const before = beforeRes.rows[0];
        const recordsDeleted =
            Number(before.orders) +
            Number(before.order_items) +
            Number(before.sales_transactions) +
            Number(before.sales_transaction_items) +
            Number(before.inventory_movements) +
            Number(before.payment_proofs) +
            Number(before.expenses);

        // Delete transactional data (FK order matters)
        await client.query('DELETE FROM sales_transaction_items');
        await client.query('DELETE FROM sales_transactions');
        await client.query('DELETE FROM order_items');
        await client.query('DELETE FROM payment_proofs');
        await client.query('DELETE FROM orders');
        await client.query('DELETE FROM inventory_movements');
        await client.query('DELETE FROM expenses');

        // Optionally reset number series back to 1
        if (resetSeries) {
            await client.query(`UPDATE number_series SET next_number = 1, updated_at = NOW()`);
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_logs
                (action, entity_type, entity_id, user_name, details, user_id, user_role, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                'maintenance_cleanup',
                'system',
                null,
                req.session.username || 'admin',
                JSON.stringify({ recordsDeleted, resetSeries: !!resetSeries, countsBefore: before }),
                req.session.userId,
                'admin',
                req.ip || null
            ]
        );

        await client.query('COMMIT');
        client.release();

        res.json({
            message: 'Cleanup completed.',
            recordsDeleted,
            resetSeries: !!resetSeries,
            countsBefore: before
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        console.error('POST /maintenance/cleanup error:', err);
        res.status(500).json({ error: 'Cleanup failed. No data was deleted.' });
    }
});

module.exports = router;
