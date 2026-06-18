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

// GET /api/products — public, returns active + ecommerce-visible products
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, sku, category, pack_display, uom, price, promo_price,
                   description, image_filename, weight_kg, display_weight, stock_quantity,
                   reorder_level, is_active, ecommerce_visible, stock_display_status
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
