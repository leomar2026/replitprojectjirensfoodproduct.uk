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

function promoFromRow(row) {
    return {
        id:                   row.id,
        name:                 row.name,
        type:                 row.type,
        minAmount:            Number(row.min_amount || 0),
        discountType:         row.discount_type,
        discountValue:        Number(row.discount_value || 0),
        requiredProductId:    row.required_product_id || '',
        requiredQuantity:     row.required_quantity || 1,
        freeProductId:        row.free_product_id || '',
        freeQuantity:         row.free_quantity || 1,
        category:             row.category || '',
        rewardType:           row.reward_type || 'selected_free',
        rewardValue:          Number(row.reward_value || 0),
        startDate:            row.start_date ? row.start_date.toISOString().slice(0, 10) : '',
        endDate:              row.end_date   ? row.end_date.toISOString().slice(0, 10)   : '',
        autoApply:            row.auto_apply,
        combine:              row.combine,
        maxUsagePerCustomer:  row.max_usage_per_customer || 0,
        maxTotalUsage:        row.max_total_usage || 0,
        usageCount:           row.usage_count || 0,
        active:               row.active
    };
}

// GET /api/admin/promotions
router.get('/', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM promotions ORDER BY id');
        res.json(result.rows.map(promoFromRow));
    } catch (err) {
        res.status(500).json({ error: 'Failed to load promotions.' });
    }
});

// POST /api/admin/promotions (create or update by id)
router.post('/', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {
            id, name, type = 'spend', minAmount = 0, discountType = 'free_delivery',
            discountValue = 0, requiredProductId, requiredQuantity = 1,
            freeProductId, freeQuantity = 1, category, rewardType = 'selected_free',
            rewardValue = 0, startDate, endDate, autoApply = true, combine = false,
            maxUsagePerCustomer = 0, maxTotalUsage = 0, active = true
        } = req.body;

        if (!name) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Promotion name is required.' }); }

        const toDateOrNull = (v) => (v && String(v).trim() ? v : null);
        const toIntOrNull  = (v) => (v && Number(v) ? Number(v) : null);

        let result;
        if (id) {
            result = await client.query(`
                UPDATE promotions SET
                    name=$1, type=$2, min_amount=$3, discount_type=$4, discount_value=$5,
                    required_product_id=$6, required_quantity=$7, free_product_id=$8, free_quantity=$9,
                    category=$10, reward_type=$11, reward_value=$12,
                    start_date=$13, end_date=$14, auto_apply=$15, combine=$16,
                    max_usage_per_customer=$17, max_total_usage=$18, active=$19, updated_at=NOW()
                WHERE id=$20 RETURNING *
            `, [name, type, Number(minAmount)||0, discountType, Number(discountValue)||0,
                toIntOrNull(requiredProductId), Number(requiredQuantity)||1,
                toIntOrNull(freeProductId), Number(freeQuantity)||1,
                category||null, rewardType, Number(rewardValue)||0,
                toDateOrNull(startDate), toDateOrNull(endDate),
                autoApply, combine, Number(maxUsagePerCustomer)||0, Number(maxTotalUsage)||0,
                active, id]);
        } else {
            result = await client.query(`
                INSERT INTO promotions
                    (name, type, min_amount, discount_type, discount_value,
                     required_product_id, required_quantity, free_product_id, free_quantity,
                     category, reward_type, reward_value, start_date, end_date,
                     auto_apply, combine, max_usage_per_customer, max_total_usage, active)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
                RETURNING *
            `, [name, type, Number(minAmount)||0, discountType, Number(discountValue)||0,
                toIntOrNull(requiredProductId), Number(requiredQuantity)||1,
                toIntOrNull(freeProductId), Number(freeQuantity)||1,
                category||null, rewardType, Number(rewardValue)||0,
                toDateOrNull(startDate), toDateOrNull(endDate),
                autoApply, combine, Number(maxUsagePerCustomer)||0, Number(maxTotalUsage)||0,
                active]);
        }

        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Promotion not found.' }); }

        await addAuditLog(client, id ? 'promotion_updated' : 'promotion_created', 'promotion',
            String(result.rows[0].id), req.session.fullName || req.session.username, { name });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Promotion saved.', promotion: promoFromRow(result.rows[0]) });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /promotions error:', err);
        res.status(500).json({ error: 'Failed to save promotion.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/promotions/:id/toggle
router.patch('/:id/toggle', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'UPDATE promotions SET active = NOT active, updated_at=NOW() WHERE id=$1 RETURNING *',
            [req.params.id]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        await addAuditLog(client, 'promotion_toggled', 'promotion', req.params.id,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Toggled.', promotion: promoFromRow(result.rows[0]) });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to toggle.' });
    } finally {
        client.release();
    }
});

// DELETE /api/admin/promotions/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('DELETE FROM promotions WHERE id=$1 RETURNING *', [req.params.id]);
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        await addAuditLog(client, 'promotion_deleted', 'promotion', req.params.id,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Deleted.' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to delete.' });
    } finally {
        client.release();
    }
});

module.exports = router;
