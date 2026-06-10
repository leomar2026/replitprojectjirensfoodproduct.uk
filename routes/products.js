const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// GET /api/products — public, returns active + ecommerce-visible products
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, sku, category, pack_display, uom, price, promo_price,
                   description, image_filename, weight_kg, stock_quantity,
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
