const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// GET /api/delivery-fees — public, returns active delivery fee rules
router.get('/delivery-fees', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, min_weight, max_weight, fee, currency, active, fee_type, contact_required FROM delivery_fee_rules WHERE active = true ORDER BY fee_type, min_weight ASC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/delivery-fees error:', err);
        res.status(500).json({ error: 'Failed to load delivery fee rules.' });
    }
});

// GET /api/products/:id/stock — public, returns current stock quantity for cart validation
router.get('/:id/stock', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT id, stock_quantity, reorder_level, stock_display_status FROM products WHERE id = $1 AND is_active = true',
            [id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
        const p = result.rows[0];
        const qty = Number(p.stock_quantity || 0);
        const reorder = Number(p.reorder_level || 0);
        let effectiveStatus;
        if (qty <= 0 || p.stock_display_status === 'Out of Stock') {
            effectiveStatus = 'Out of Stock';
        } else if (reorder > 0 && qty <= reorder) {
            effectiveStatus = 'Low Stock';
        } else {
            effectiveStatus = 'Available';
        }
        res.json({ id: p.id, stock_quantity: qty, effective_status: effectiveStatus });
    } catch (err) {
        console.error('GET /api/products/:id/stock error:', err);
        res.status(500).json({ error: 'Failed to check stock.' });
    }
});

// GET /api/products — public, returns active + ecommerce-visible products
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, sku, category, pack_display, uom, price, promo_price,
                   description, image_filename, weight_kg, display_weight, stock_quantity,
                   reorder_level, is_active, ecommerce_visible, stock_display_status,
                   CASE
                     WHEN stock_quantity <= 0 OR stock_display_status = 'Out of Stock' THEN 'Out of Stock'
                     WHEN reorder_level > 0 AND stock_quantity <= reorder_level THEN 'Low Stock'
                     ELSE 'Available'
                   END AS effective_status
            FROM products
            WHERE is_active = true AND ecommerce_visible = true
            ORDER BY id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/products error:', err);
        res.status(500).json({ error: 'Failed to load products.' });
    }
});

module.exports = router;
