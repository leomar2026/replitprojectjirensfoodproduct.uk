const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { nextSerialNumber, addAuditLog, recordInventoryMovement } = require('../utils/db-helpers');

async function getVatSettings(client) {
    try {
        const result = await client.query('SELECT rate, active FROM tax_settings WHERE id = 1');
        if (result.rows.length) {
            const { rate, active } = result.rows[0];
            if (active === false || active === 'false') return { rate: 0, active: false };
            return { rate: parseFloat(rate || 0), active: true };
        }
    } catch (_) {}
    return { rate: 0, active: false };
}

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/admin/pos/sales ─────────────────────────────────────────────────
router.get('/sales', async (req, res) => {
    try {
        const limit  = Math.min(Number(req.query.limit  || 200), 1000);
        const offset = Number(req.query.offset || 0);

        const result = await pool.query(`
            SELECT st.*,
                json_agg(
                    json_build_object(
                        'id',           sti.id,
                        'product_id',   sti.product_id,
                        'product_name', sti.product_name,
                        'product_sku',  sti.product_sku,
                        'quantity',     sti.quantity,
                        'unit_price',   sti.unit_price,
                        'line_total',   sti.line_total
                    ) ORDER BY sti.id
                ) FILTER (WHERE sti.id IS NOT NULL) AS items
            FROM   sales_transactions st
            LEFT JOIN sales_transaction_items sti ON sti.transaction_id = st.id
            WHERE  st.transaction_type = 'POS Sale'
            GROUP  BY st.id
            ORDER  BY st.created_at DESC
            LIMIT  $1 OFFSET $2
        `, [limit, offset]);

        res.json(result.rows);
    } catch (err) {
        console.error('GET /pos/sales error:', err);
        res.status(500).json({ error: 'Failed to load POS sales.' });
    }
});

// ─── POST /api/admin/pos/sales ────────────────────────────────────────────────
router.post('/sales', requireRole('manager', 'admin', 'cashier'), async (req, res) => {
    const { payment_method, payment_reference, items } = req.body;

    if (!payment_method) return res.status(400).json({ error: 'payment_method is required.' });
    if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: 'At least one item is required.' });
    }
    if (payment_method !== 'Cash' && !payment_reference) {
        return res.status(400).json({ error: 'Payment reference is required for non-cash payments.' });
    }

    // Duplicate submission guard — block identical sale from same user within 30 seconds
    const dupCheck = await pool.query(`
        SELECT id FROM sales_transactions
        WHERE transaction_type = 'POS Sale'
          AND created_by = $1
          AND payment_method = $2
          AND created_at > NOW() - INTERVAL '30 seconds'
        LIMIT 1
    `, [req.session.username || 'System', payment_method]);
    if (dupCheck.rows.length) {
        return res.status(409).json({ error: 'Duplicate submission detected. Please wait before retrying.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Validate items and fetch products
        let subtotal = 0;
        const lineItems = [];

        for (const item of items) {
            if (!item.product_id || !item.quantity || item.quantity < 1) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Each item needs product_id and quantity >= 1.' });
            }

            const productResult = await client.query(
                'SELECT id, name, sku, price, stock_quantity, is_active FROM products WHERE id = $1',
                [item.product_id]
            );
            const product = productResult.rows[0];
            if (!product || !product.is_active) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Product not available: ${item.product_id}` });
            }

            const qty       = Number(item.quantity);
            const unitPrice = item.unit_price != null ? Number(item.unit_price) : Number(product.price);
            const lineTotal = parseFloat((unitPrice * qty).toFixed(2));
            subtotal       += lineTotal;
            lineItems.push({ product, qty, unitPrice, lineTotal });
        }

        const vatSettings = await getVatSettings(client);
        const vatAmount   = parseFloat((subtotal * vatSettings.rate / 100).toFixed(2));
        const totalAmount = parseFloat((subtotal + vatAmount).toFixed(2));

        // Generate transaction number
        const transactionNumber = await nextSerialNumber(client, 'POS');
        const receiptNumber     = await nextSerialNumber(client, 'RECEIPT');

        // Insert sales_transaction
        const txResult = await client.query(`
            INSERT INTO sales_transactions
                (transaction_number, receipt_number, transaction_type,
                 customer_name, payment_method, payment_reference,
                 subtotal, vat_amount, total_amount, status, created_by)
            VALUES ($1,$2,'POS Sale','Walk-in customer',$3,$4,$5,$6,$7,'Completed',$8)
            RETURNING *
        `, [
            transactionNumber, receiptNumber,
            payment_method, payment_reference || null,
            subtotal, vatAmount, totalAmount,
            req.session.username || 'System'
        ]);
        const transaction = txResult.rows[0];

        // Insert items and deduct stock
        for (const line of lineItems) {
            await client.query(`
                INSERT INTO sales_transaction_items
                    (transaction_id, product_id, product_name, product_sku, quantity, unit_price, line_total)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
            `, [transaction.id, line.product.id, line.product.name, line.product.sku,
                line.qty, line.unitPrice, line.lineTotal]);

            // Deduct stock + record movement (uses FOR UPDATE lock inside helper)
            await recordInventoryMovement(client, {
                productId:       line.product.id,
                movementType:    'Sales Deduction',
                quantity:        line.qty,
                notes:           `POS sale ${transactionNumber}`,
                referenceType:   'POS Sale',
                referenceNumber: transactionNumber,
                createdBy:       req.session.username || 'System'
            });
        }

        await addAuditLog(client, 'pos_sale', 'sales_transaction', transactionNumber,
            req.session.username, {
                transaction_number: transactionNumber,
                receipt_number: receiptNumber,
                total_amount: totalAmount,
                payment_method,
                items: lineItems.map(l => ({ product: l.product.name, qty: l.qty, price: l.unitPrice }))
            },
            { userId: req.session.userId, userRole: req.session.role, ipAddress: req.ip });

        await client.query('COMMIT');

        res.status(201).json({
            message:           'POS sale recorded.',
            transactionNumber,
            receiptNumber,
            subtotal,
            vatAmount,
            totalAmount,
            transaction
        });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
        console.error('POST /pos/sales error:', err);
        res.status(500).json({ error: 'Failed to record POS sale.' });
    } finally {
        client.release();
    }
});

module.exports = router;
