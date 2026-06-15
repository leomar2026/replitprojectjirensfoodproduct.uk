const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload, UPLOAD_DIR } = require('../middleware/upload');
const { nextSerialNumber, addAuditLog } = require('../utils/db-helpers');

const crypto = require('crypto');

const PRODUCT_IMG_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');
if (!fs.existsSync(PRODUCT_IMG_DIR)) fs.mkdirSync(PRODUCT_IMG_DIR, { recursive: true });

const productImgStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, PRODUCT_IMG_DIR),
    filename: (req, file, cb) => {
        const unique = `product-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
        cb(null, unique);
    }
});
const uploadProductImg = multer({
    storage: productImgStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/image\/(jpeg|jpg|png|webp)/.test(file.mimetype)) cb(null, true);
        else cb(new Error('Only JPG, PNG, WEBP images are allowed.'));
    }
});

function deleteProductFile(imageFilename) {
    if (!imageFilename || !imageFilename.startsWith('/uploads/products/')) return;
    try {
        const fp = path.join(__dirname, '..', 'public', imageFilename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (_) {}
}

const router = express.Router();

// All admin routes require authentication
router.use(requireAuth);

// ─────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────

// GET /api/admin/products — all products
router.get('/products', requireRole('manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/admin/products error:', err);
        res.status(500).json({ error: 'Failed to load products.' });
    }
});

// POST /api/admin/products — create product
router.post('/products', requireRole('admin'), async (req, res) => {
    const { name, sku, category, pack_display, uom, price, promo_price, cost_price,
            description, image_filename, weight_kg, display_weight, stock_quantity, reorder_level,
            ecommerce_visible } = req.body;

    if (!name || !sku || price == null) {
        return res.status(400).json({ error: 'Name, SKU, and price are required.' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO products (name, sku, category, pack_display, uom, price, promo_price,
                cost_price, description, image_filename, weight_kg, display_weight, stock_quantity,
                reorder_level, ecommerce_visible)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            RETURNING *
        `, [
            name, sku, category || 'Frozen Products', pack_display || '500g pack',
            uom || 'pack', Number(price), promo_price ? Number(promo_price) : null,
            Number(cost_price || 0), description || '', image_filename || '',
            Number(weight_kg || 0), display_weight || '',
            Number(stock_quantity || 0), Number(reorder_level || 0), ecommerce_visible !== false
        ]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'SKU already exists.' });
        console.error('POST /api/admin/products error:', err);
        res.status(500).json({ error: 'Failed to create product.' });
    }
});

// PUT /api/admin/products/:id — update product
router.put('/products/:id', requireRole('manager', 'admin'), async (req, res) => {
    const { id } = req.params;
    const { name, sku, category, pack_display, uom, price, promo_price, cost_price,
            description, image_filename, weight_kg, display_weight, stock_quantity, reorder_level,
            is_active, ecommerce_visible, stock_display_status, delivery_unit } = req.body;

    try {
        const result = await pool.query(`
            UPDATE products SET
                name = COALESCE($1, name),
                sku = COALESCE($2, sku),
                category = COALESCE($3, category),
                pack_display = COALESCE($4, pack_display),
                uom = COALESCE($5, uom),
                price = COALESCE($6, price),
                promo_price = $7,
                cost_price = COALESCE($8, cost_price),
                description = COALESCE($9, description),
                image_filename = COALESCE($10, image_filename),
                weight_kg = COALESCE($11, weight_kg),
                stock_quantity = COALESCE($12, stock_quantity),
                reorder_level = COALESCE($13, reorder_level),
                is_active = COALESCE($14, is_active),
                ecommerce_visible = COALESCE($15, ecommerce_visible),
                stock_display_status = $16,
                delivery_unit = COALESCE($18, delivery_unit),
                display_weight = $19
            WHERE id = $17
            RETURNING *
        `, [
            name || null, sku || null, category || null, pack_display || null, uom || null,
            price != null ? Number(price) : null,
            promo_price != null ? Number(promo_price) : null,
            cost_price != null ? Number(cost_price) : null,
            description !== undefined ? description : null,
            image_filename !== undefined ? image_filename : null,
            weight_kg != null ? Number(weight_kg) : null,
            stock_quantity != null ? Number(stock_quantity) : null,
            reorder_level != null ? Number(reorder_level) : null,
            is_active != null ? Boolean(is_active) : null,
            ecommerce_visible != null ? Boolean(ecommerce_visible) : null,
            stock_display_status || null,
            id,
            delivery_unit || null,
            display_weight !== undefined ? (display_weight || '') : null
        ]);
        if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('PUT /api/admin/products/:id error:', err);
        res.status(500).json({ error: 'Failed to update product.' });
    }
});

// GET /api/admin/products/images — list all images in the product image library
router.get('/products/images', requireRole('manager', 'admin'), (req, res) => {
    try {
        const files = fs.existsSync(PRODUCT_IMG_DIR)
            ? fs.readdirSync(PRODUCT_IMG_DIR).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort().reverse()
            : [];
        res.json(files.map((f) => `/uploads/products/${f}`));
    } catch (err) {
        res.status(500).json({ error: 'Failed to list images.' });
    }
});

// DELETE /api/admin/products/images/:filename — remove an image from the library
router.delete('/products/images/:filename', requireRole('manager', 'admin'), (req, res) => {
    const filename = path.basename(req.params.filename);
    if (!filename.match(/^product-[\d]+-[a-f0-9]+\.(jpg|jpeg|png|webp)$/i)) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    deleteProductFile(`/uploads/products/${filename}`);
    res.json({ message: 'Image removed.' });
});

// POST /api/admin/products/upload-image — pre-upload image before product is created
router.post('/products/upload-image', requireRole('manager', 'admin'), (req, res, next) => {
    uploadProductImg.single('image')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No image file provided.' });
        res.json({ imageUrl: `/uploads/products/${req.file.filename}` });
    });
});

// POST /api/admin/products/:id/image — upload / replace product image (saved to disk)
router.post('/products/:id/image', requireRole('manager', 'admin'), (req, res, next) => {
    uploadProductImg.single('image')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No image file provided.' });
        const { id } = req.params;
        const imageUrl = `/uploads/products/${req.file.filename}`;
        try {
            const existing = await pool.query('SELECT image_filename FROM products WHERE id=$1', [id]);
            if (!existing.rows.length) {
                deleteProductFile(imageUrl);
                return res.status(404).json({ error: 'Product not found.' });
            }
            deleteProductFile(existing.rows[0].image_filename);
            await pool.query('UPDATE products SET image_filename = $1 WHERE id = $2', [imageUrl, id]);
            res.json({ imageUrl });
        } catch (dbErr) {
            deleteProductFile(imageUrl);
            console.error('POST /api/admin/products/:id/image error:', dbErr);
            res.status(500).json({ error: 'Failed to save image.' });
        }
    });
});

// ─────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────

// GET /api/admin/orders — all orders
router.get('/orders', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*,
                json_agg(
                    json_build_object(
                        'id', oi.id,
                        'product_id', oi.product_id,
                        'product_name', oi.product_name,
                        'product_sku', oi.product_sku,
                        'quantity', oi.quantity,
                        'unit_price', oi.unit_price,
                        'weight_kg', oi.weight_kg,
                        'line_weight', oi.line_weight,
                        'line_total', oi.line_total
                    ) ORDER BY oi.id
                ) FILTER (WHERE oi.id IS NOT NULL) AS items,
                (SELECT row_to_json(pp)
                 FROM payment_proofs pp
                 WHERE pp.order_id = o.id
                 ORDER BY pp.id LIMIT 1) AS payment_proof
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            GROUP BY o.id
            ORDER BY o.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/admin/orders error:', err);
        res.status(500).json({ error: 'Failed to load orders.' });
    }
});

// GET /api/admin/orders/:orderNumber/proof — serve payment proof file
router.get('/orders/:orderNumber/proof', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pp.* FROM payment_proofs pp
            JOIN orders o ON o.id = pp.order_id
            WHERE o.order_number = $1
            ORDER BY pp.id LIMIT 1
        `, [req.params.orderNumber]);

        if (!result.rows.length) return res.status(404).json({ error: 'Proof not found.' });

        const proof = result.rows[0];
        const filePath = path.join(__dirname, '..', proof.upload_path);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Proof file not found on disk.' });

        res.setHeader('Content-Type', proof.file_type);
        res.setHeader('Content-Disposition', `inline; filename="${proof.original_name}"`);
        fs.createReadStream(filePath).pipe(res);
    } catch (err) {
        console.error('GET proof error:', err);
        res.status(500).json({ error: 'Failed to retrieve proof.' });
    }
});

// POST /api/admin/orders/:orderNumber/verify-payment
router.post('/orders/:orderNumber/verify-payment', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query(`
            UPDATE orders SET
                payment_status = 'Verified',
                payment_verified_by = $1,
                payment_verified_at = NOW()
            WHERE order_number = $2
              AND order_status NOT IN ('Confirmed', 'Cancelled')
              AND payment_status != 'Verified'
            RETURNING order_number, payment_status, order_status
        `, [req.session.username, req.params.orderNumber]);

        if (!result.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Order not found or already verified/cancelled.' });
        }

        await addAuditLog(client, 'payment_verified', 'order', req.params.orderNumber,
            req.session.username, { order_number: req.params.orderNumber },
            { userId: req.session.userId, userRole: req.session.role, ipAddress: req.ip });

        await client.query('COMMIT');
        res.json({ message: 'Payment verified.', order: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('verify-payment error:', err);
        res.status(500).json({ error: 'Failed to verify payment.' });
    } finally {
        client.release();
    }
});

// POST /api/admin/orders/:orderNumber/confirm
router.post('/orders/:orderNumber/confirm', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Update order status
        const orderResult = await client.query(`
            UPDATE orders SET
                order_status = 'Confirmed',
                payment_status = 'Paid',
                confirmed_by = $1,
                confirmed_at = NOW()
            WHERE order_number = $2
              AND payment_status = 'Verified'
              AND order_status NOT IN ('Confirmed', 'Cancelled')
            RETURNING id, order_number, order_status, payment_status,
                      customer_name, payment_method, payment_method_display,
                      payment_reference, subtotal, vat_amount, total_amount
        `, [req.session.username, req.params.orderNumber]);

        if (!orderResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Order not found or payment not yet verified.' });
        }

        const order = orderResult.rows[0];

        // Get order items
        const itemsResult = await client.query(
            'SELECT * FROM order_items WHERE order_id = $1',
            [order.id]
        );

        // Generate invoice number and record sales_transaction
        const invoiceNumber = await nextSerialNumber(client, 'INVOICE');

        await client.query(`
            UPDATE orders SET invoice_number = $1 WHERE id = $2
        `, [invoiceNumber, order.id]);

        // Fetch delivery_fee for this order
        const deliveryRes = await client.query(
            'SELECT delivery_fee FROM orders WHERE id = $1', [order.id]
        );
        const deliveryFee = Number(deliveryRes.rows[0]?.delivery_fee || 0);

        const txResult = await client.query(`
            INSERT INTO sales_transactions
                (transaction_number, invoice_number, transaction_type,
                 source_reference, customer_name, payment_method, payment_reference,
                 subtotal, vat_amount, delivery_fee, total_amount, status, created_by)
            VALUES ($1,$2,'Online Order',$3,$4,$5,$6,$7,$8,$9,$10,'Completed',$11)
            RETURNING id, transaction_number
        `, [
            order.order_number, invoiceNumber,
            order.order_number, order.customer_name,
            order.payment_method, order.payment_reference || null,
            order.subtotal, order.vat_amount, deliveryFee, order.total_amount,
            req.session.username
        ]);
        const transaction = txResult.rows[0];

        for (const item of itemsResult.rows) {
            await client.query(`
                INSERT INTO sales_transaction_items
                    (transaction_id, product_id, product_name, product_sku, quantity, unit_price, line_total)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
            `, [transaction.id, item.product_id, item.product_name, item.product_sku,
                item.quantity, item.unit_price, item.line_total]);
        }

        await addAuditLog(client, 'order_confirmed', 'order', order.order_number,
            req.session.username, {
                order_number: order.order_number,
                invoice_number: invoiceNumber,
                transaction_number: transaction.transaction_number
            },
            { userId: req.session.userId, userRole: req.session.role, ipAddress: req.ip });

        await client.query('COMMIT');
        res.json({ message: 'Order confirmed.', order: { order_number: order.order_number, order_status: order.order_status, payment_status: order.payment_status, invoice_number: invoiceNumber } });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('confirm error:', err);
        res.status(500).json({ error: 'Failed to confirm order.' });
    } finally {
        client.release();
    }
});

// POST /api/admin/orders/:orderNumber/cancel
router.post('/orders/:orderNumber/cancel', requireRole('admin'), async (req, res) => {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'Cancellation reason is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const orderResult = await client.query(`
            UPDATE orders SET
                order_status = 'Cancelled',
                payment_status = 'Cancelled',
                cancel_reason = $1
            WHERE order_number = $2
              AND order_status != 'Cancelled'
            RETURNING id, order_number, order_status
        `, [reason.trim(), req.params.orderNumber]);

        if (!orderResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Order not found or already cancelled.' });
        }

        const order = orderResult.rows[0];

        // Get items with their current stock BEFORE restoration
        const itemsResult = await client.query(`
            SELECT oi.*, p.stock_quantity AS current_stock
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = $1
        `, [order.id]);

        // Restore stock and record movements
        for (const item of itemsResult.rows) {
            if (!item.product_id) continue;

            const stockBefore = Number(item.current_stock || 0);
            const stockAfter  = stockBefore + Number(item.quantity);

            await client.query(
                'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
                [stockAfter, item.product_id]
            );

            await client.query(`
                INSERT INTO inventory_movements
                    (product_id, product_name, product_sku, movement_type,
                     quantity, quantity_before, quantity_after,
                     reference_type, reference_number, notes, created_by)
                VALUES ($1,$2,$3,'Stock Return',$4,$5,$6,'Order Cancellation',$7,$8,$9)
            `, [
                item.product_id, item.product_name, item.product_sku,
                item.quantity, stockBefore, stockAfter,
                order.order_number,
                `Stock returned: cancelled order ${order.order_number}`,
                req.session.username || 'System'
            ]);
        }

        await addAuditLog(client, 'order_cancelled', 'order', order.order_number,
            req.session.username, { order_number: order.order_number, reason: reason.trim() },
            { userId: req.session.userId, userRole: req.session.role, ipAddress: req.ip });

        await client.query('COMMIT');
        res.json({ message: 'Order cancelled.', order: orderResult.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('cancel error:', err);
        res.status(500).json({ error: 'Failed to cancel order.' });
    } finally {
        client.release();
    }
});

module.exports = router;
