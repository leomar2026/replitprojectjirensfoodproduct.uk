const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { recordInventoryMovement, addAuditLog } = require('../utils/db-helpers');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('manager', 'admin'));

// ─── GET /api/admin/inventory/movements ──────────────────────────────────────
router.get('/movements', async (req, res) => {
    try {
        const limit  = Math.min(Number(req.query.limit  || 500), 2000);
        const offset = Number(req.query.offset || 0);

        const result = await pool.query(`
            SELECT im.*, p.category
            FROM   inventory_movements im
            LEFT   JOIN products p ON p.id = im.product_id
            ORDER  BY im.created_at DESC
            LIMIT  $1 OFFSET $2
        `, [limit, offset]);

        res.json(result.rows);
    } catch (err) {
        console.error('GET /inventory/movements error:', err);
        res.status(500).json({ error: 'Failed to load inventory movements.' });
    }
});

// ─── Shared POST handler ──────────────────────────────────────────────────────
// Valid movement_type values per endpoint:
const ALLOWED_TYPES = {
    'stock-in':   ['Stock In'],
    'stock-out':  ['Stock Out'],
    'adjustment': ['Adjustment', 'Positive Adjustment', 'Negative Adjustment'],
    'damage':     ['Damage'],
    'expired':    ['Expired']
};

async function handleMovement(req, res, endpointKey) {
    const { product_id, quantity, movement_type, notes, warehouse } = req.body;

    const allowed      = ALLOWED_TYPES[endpointKey];
    const resolvedType = (movement_type && allowed.includes(movement_type))
        ? movement_type
        : allowed[0];

    if (!product_id) return res.status(400).json({ error: 'product_id is required.' });
    const qty = Number(quantity);
    if (!qty || qty < 1) return res.status(400).json({ error: 'quantity must be >= 1.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { movement, quantityBefore, quantityAfter } = await recordInventoryMovement(client, {
            productId:       product_id,
            movementType:    resolvedType,
            quantity:        qty,
            notes:           notes || null,
            referenceType:   'Manual',
            referenceNumber: null,
            warehouse:       warehouse || null,
            createdBy:       req.session.username || req.session.fullName || 'System'
        });

        await addAuditLog(
            client,
            endpointKey.replace('-', '_'),
            'inventory_movement',
            String(movement.id),
            req.session.username,
            { product_id, movement_type: resolvedType, quantity: qty, quantity_before: quantityBefore, quantity_after: quantityAfter, notes }
        );

        await client.query('COMMIT');
        res.status(201).json({ message: 'Inventory movement recorded.', movement });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error(`POST /inventory/${endpointKey} error:`, err);
        res.status(500).json({ error: 'Failed to record inventory movement.' });
    } finally {
        client.release();
    }
}

router.post('/stock-in',   (req, res) => handleMovement(req, res, 'stock-in'));
router.post('/stock-out',  (req, res) => handleMovement(req, res, 'stock-out'));
router.post('/adjustment', (req, res) => handleMovement(req, res, 'adjustment'));
router.post('/damage',     (req, res) => handleMovement(req, res, 'damage'));
router.post('/expired',    (req, res) => handleMovement(req, res, 'expired'));

module.exports = router;
