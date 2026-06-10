const express = require('express');
const router = express.Router();
const { pool } = require('../db');

function requireRole(...roles) {
    const levels = { admin: 3, manager: 2, cashier: 1 };
    const min = Math.min(...roles.map((r) => levels[r] || 0));
    return (req, res, next) => {
        if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated.' });
        if ((levels[req.session.role] || 0) < min) return res.status(403).json({ error: 'Insufficient permissions.' });
        next();
    };
}

function periodDates(period) {
    const today = new Date().toISOString().slice(0, 10);
    if (!period || period === 'all') return { from: null, to: null };
    if (period === 'daily') return { from: today, to: today };
    if (period === 'monthly') return { from: today.slice(0, 7) + '-01', to: today };
    if (period === 'yearly') return { from: today.slice(0, 4) + '-01-01', to: today };
    if (period === 'weekly') {
        const d = new Date();
        const start = new Date(d); start.setDate(d.getDate() - d.getDay());
        const end = new Date(start); end.setDate(start.getDate() + 6);
        return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
    }
    return { from: null, to: null };
}

// ─────────────────────────────────────────────
// GET /api/admin/reports/sales
// ─────────────────────────────────────────────
router.get('/sales', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const { period, from: qFrom, to: qTo, source, customer, payment, status,
                page = 1, limit = 200 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        let { from, to } = periodDates(period);
        if (qFrom) from = qFrom;
        if (qTo)   to   = qTo;

        const conditions = [];
        const params = [];

        if (from) { params.push(from); conditions.push(`st.created_at::date >= $${params.length}`); }
        if (to)   { params.push(to);   conditions.push(`st.created_at::date <= $${params.length}`); }

        if (source) {
            params.push(source);
            conditions.push(`
                CASE
                    WHEN st.transaction_type = 'POS Sale' THEN 'Walk-in Sales / POS'
                    WHEN st.transaction_type = 'Online Order' THEN 'Online Sales'
                    ELSE st.transaction_type
                END = $${params.length}
            `);
        }
        if (customer) { params.push(`%${customer}%`); conditions.push(`st.customer_name ILIKE $${params.length}`); }
        if (payment)  { params.push(payment); conditions.push(`st.payment_method = $${params.length}`); }
        if (status)   { params.push(status);  conditions.push(`st.status = $${params.length}`); }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const countRes = await pool.query(`SELECT COUNT(*) FROM sales_transactions st ${where}`, params);
        const total = Number(countRes.rows[0].count);

        params.push(Number(limit)); params.push(offset);
        const dataRes = await pool.query(`
            SELECT
                st.transaction_number,
                st.invoice_number,
                st.receipt_number,
                st.transaction_type,
                st.customer_name,
                st.payment_method,
                st.payment_reference,
                st.subtotal,
                st.vat_amount,
                st.delivery_fee,
                st.total_amount,
                st.status,
                st.created_by,
                st.created_at,
                COALESCE(
                    (SELECT STRING_AGG(
                        sti.quantity || 'x ' || sti.product_name || ' @ ' || sti.unit_price,
                        ', '
                        ORDER BY sti.id
                    ) FROM sales_transaction_items sti WHERE sti.transaction_id = st.id),
                    ''
                ) AS items_summary,
                COALESCE(
                    (SELECT SUM(
                        p.weight_kg * sti.quantity
                    ) FROM sales_transaction_items sti
                    LEFT JOIN products p ON p.id = sti.product_id
                    WHERE sti.transaction_id = st.id),
                    0
                ) AS total_weight
            FROM sales_transactions st
            ${where}
            ORDER BY st.created_at DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        // Aggregate stats (all matching, not just this page)
        const statsRes = await pool.query(`
            SELECT
                COALESCE(SUM(subtotal), 0)      AS sales_total,
                COALESCE(SUM(vat_amount), 0)    AS vat_total,
                COALESCE(SUM(delivery_fee), 0)  AS delivery_fee_total,
                COALESCE(SUM(total_amount), 0)  AS grand_total,
                COUNT(*) AS transaction_count
            FROM sales_transactions st ${where}
        `, params.slice(0, params.length - 2));

        // Approved expenses for profit/loss
        const expenseRes = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) AS approved_total
            FROM expenses WHERE status = 'Approved'
        `);

        const stats = statsRes.rows[0];
        const approvedExpenses = Number(expenseRes.rows[0].approved_total);
        const grandTotal = Number(stats.grand_total);

        // Map to frontend salesRecords format
        const salesRecords = dataRes.rows.map((row) => ({
            id:            row.transaction_number,
            invoiceNumber: row.invoice_number || '',
            type:          row.transaction_type === 'POS Sale' ? 'POS walk-in' : 'Online order',
            customer:      row.customer_name,
            items:         row.items_summary,
            totalWeight:   Number(row.total_weight || 0),
            subtotal:      Number(row.subtotal || 0),
            vat:           Number(row.vat_amount || 0),
            tax:           Number(row.vat_amount || 0),
            deliveryFee:    Number(row.delivery_fee || 0),
            discountAmount: Math.max(0, parseFloat(((Number(row.subtotal||0) + Number(row.vat_amount||0) + Number(row.delivery_fee||0)) - Number(row.total_amount||0)).toFixed(2))),
            payment:       row.payment_method,
            reference:     row.payment_reference || '',
            status:        row.status,
            total:         Number(row.total_amount || 0),
            date:          row.created_at,
            createdAt:     row.created_at,
            createdBy:     row.created_by
        }));

        res.json({
            salesRecords,
            stats: {
                salesTotal:       Number(stats.sales_total),
                vatTotal:         Number(stats.vat_total),
                grandTotal,
                deliveryFeeTotal: Number(stats.delivery_fee_total || 0),
                discountTotal:    0,
                approvedExpenses,
                profitLoss:       grandTotal - approvedExpenses,
                transactionCount: Number(stats.transaction_count)
            },
            total,
            page:  Number(page),
            pages: Math.ceil(total / Number(limit))
        });
    } catch (err) {
        console.error('GET /reports/sales error:', err);
        res.status(500).json({ error: 'Failed to load sales report.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/admin/reports/inventory
// ─────────────────────────────────────────────
router.get('/inventory', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const { from, to, product_id, category, type: movType, page = 1, limit = 200 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const movConditions = [];
        const movParams = [];
        if (from)       { movParams.push(from);       movConditions.push(`im.created_at::date >= $${movParams.length}`); }
        if (to)         { movParams.push(to);         movConditions.push(`im.created_at::date <= $${movParams.length}`); }
        if (product_id) { movParams.push(product_id); movConditions.push(`im.product_id = $${movParams.length}`); }
        if (movType)    { movParams.push(movType);    movConditions.push(`im.movement_type = $${movParams.length}`); }
        const movWhere = movConditions.length ? 'WHERE ' + movConditions.join(' AND ') : '';

        // Inventory summary per product
        const prodConditions = [];
        const prodParams = [];
        if (category) { prodParams.push(category); prodConditions.push(`p.category = $${prodParams.length}`); }
        if (product_id) { prodParams.push(product_id); prodConditions.push(`p.id = $${prodParams.length}`); }
        const prodWhere = prodConditions.length ? 'WHERE ' + prodConditions.join(' AND ') : '';

        const productsRes = await pool.query(
            `SELECT p.id, p.name, p.sku, p.category, p.uom, p.stock_quantity, p.reorder_level
             FROM products p ${prodWhere} ORDER BY p.name`,
            prodParams
        );

        // Aggregate movements per product
        const movAggRes = await pool.query(`
            SELECT
                product_id,
                COALESCE(SUM(CASE WHEN movement_type = 'Stock In' THEN quantity ELSE 0 END), 0) AS stock_in,
                COALESCE(SUM(CASE WHEN movement_type IN ('Positive Adjustment','Negative Adjustment') THEN
                    CASE WHEN movement_type = 'Positive Adjustment' THEN quantity ELSE -quantity END ELSE 0 END), 0) AS adjustment,
                COALESCE(SUM(CASE WHEN movement_type = 'Damage' THEN quantity ELSE 0 END), 0) AS damage,
                COALESCE(SUM(CASE WHEN movement_type = 'Expired' THEN quantity ELSE 0 END), 0) AS expired,
                COALESCE(SUM(CASE WHEN movement_type IN ('Sales Deduction','Stock Out') THEN quantity ELSE 0 END), 0) AS sales_deduction
            FROM inventory_movements im
            GROUP BY product_id
        `);
        const movMap = {};
        movAggRes.rows.forEach((r) => { movMap[r.product_id] = r; });

        const rows = productsRes.rows.map((p) => {
            const m = movMap[p.id] || { stock_in: 0, adjustment: 0, damage: 0, expired: 0, sales_deduction: 0 };
            const currentStock = Number(p.stock_quantity);
            const reorderLevel = Number(p.reorder_level || 0);
            const status = currentStock <= 0 ? 'Out of Stock'
                         : currentStock <= reorderLevel ? 'Low Stock'
                         : 'Available';
            return {
                product: { id: p.id, name: p.name, sku: p.sku, category: p.category, uom: p.uom, reorderLevel },
                openingStock:    0,
                stockIn:         Number(m.stock_in),
                adjustment:      Number(m.adjustment),
                damage:          Number(m.damage),
                expired:         Number(m.expired),
                salesDeduction:  Number(m.sales_deduction),
                currentStock,
                status
            };
        });

        // Movement history for this filter (paginated)
        const countRes = await pool.query(
            `SELECT COUNT(*) FROM inventory_movements im ${movWhere}`, movParams
        );
        const total = Number(countRes.rows[0].count);

        const histParams = [...movParams, Number(limit), offset];
        const histRes = await pool.query(`
            SELECT im.*, p.category AS product_category
            FROM inventory_movements im
            LEFT JOIN products p ON p.id = im.product_id
            ${movWhere}
            ORDER BY im.created_at DESC
            LIMIT $${histParams.length - 1} OFFSET $${histParams.length}
        `, histParams);

        const summary = {
            totalProducts:      rows.length,
            totalAvailableStock: rows.reduce((s, r) => s + r.currentStock, 0),
            lowStockItems:      rows.filter((r) => r.status === 'Low Stock').length,
            outOfStockItems:    rows.filter((r) => r.status === 'Out of Stock').length,
            damagedStock:       rows.reduce((s, r) => s + r.damage, 0),
            expiredStock:       rows.reduce((s, r) => s + r.expired, 0)
        };

        res.json({
            rows,
            summary,
            history: histRes.rows,
            total,
            page:  Number(page),
            pages: Math.ceil(total / Number(limit))
        });
    } catch (err) {
        console.error('GET /reports/inventory error:', err);
        res.status(500).json({ error: 'Failed to load inventory report.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/admin/reports/expenses
// ─────────────────────────────────────────────
router.get('/expenses', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const { period, from: qFrom, to: qTo, category, vendor, payment, status, user,
                page = 1, limit = 200 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        let { from, to } = periodDates(period);
        if (qFrom) from = qFrom;
        if (qTo)   to   = qTo;

        const conditions = [];
        const params = [];
        if (from) { params.push(from); conditions.push(`expense_date >= $${params.length}`); }
        if (to)   { params.push(to);   conditions.push(`expense_date <= $${params.length}`); }
        if (category) { params.push(category); conditions.push(`category = $${params.length}`); }
        if (vendor)   { params.push(`%${vendor}%`); conditions.push(`vendor ILIKE $${params.length}`); }
        if (payment)  { params.push(payment); conditions.push(`payment_method = $${params.length}`); }
        if (status)   { params.push(status);  conditions.push(`status = $${params.length}`); }
        if (user)     { params.push(`%${user}%`); conditions.push(`created_by ILIKE $${params.length}`); }
        if (req.session.role === 'cashier') {
            params.push(req.session.fullName || req.session.username);
            conditions.push(`created_by = $${params.length}`);
        }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const countRes = await pool.query(`SELECT COUNT(*) FROM expenses ${where}`, params);
        const total = Number(countRes.rows[0].count);

        const statsRes = await pool.query(
            `SELECT COALESCE(SUM(amount),0) AS total_amount, COUNT(*) AS count FROM expenses ${where}`, params
        );

        params.push(Number(limit)); params.push(offset);
        const dataRes = await pool.query(
            `SELECT * FROM expenses ${where} ORDER BY expense_date DESC, created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
            params
        );

        res.json({
            expenses: dataRes.rows,
            stats: {
                totalAmount:  Number(statsRes.rows[0].total_amount),
                count:        Number(statsRes.rows[0].count)
            },
            total,
            page:  Number(page),
            pages: Math.ceil(total / Number(limit))
        });
    } catch (err) {
        console.error('GET /reports/expenses error:', err);
        res.status(500).json({ error: 'Failed to load expense report.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/admin/reports/orders
// ─────────────────────────────────────────────
router.get('/orders', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const { period, from: qFrom, to: qTo, order_status, payment_status,
                page = 1, limit = 200 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        let { from, to } = periodDates(period);
        if (qFrom) from = qFrom;
        if (qTo)   to   = qTo;

        const conditions = [];
        const params = [];
        if (from)           { params.push(from);           conditions.push(`o.created_at::date >= $${params.length}`); }
        if (to)             { params.push(to);             conditions.push(`o.created_at::date <= $${params.length}`); }
        if (order_status)   { params.push(order_status);   conditions.push(`o.order_status = $${params.length}`); }
        if (payment_status) { params.push(payment_status); conditions.push(`o.payment_status = $${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const countRes = await pool.query(`SELECT COUNT(*) FROM orders o ${where}`, params);
        const total = Number(countRes.rows[0].count);

        const statsRes = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE order_status != 'Cancelled') AS active_orders,
                COUNT(*) FILTER (WHERE payment_status = 'Verified') AS verified,
                COUNT(*) FILTER (WHERE order_status = 'Confirmed') AS confirmed,
                COUNT(*) FILTER (WHERE order_status = 'Cancelled') AS cancelled
            FROM orders o ${where}
        `, params);

        params.push(Number(limit)); params.push(offset);
        const dataRes = await pool.query(`
            SELECT o.*, COALESCE(
                (SELECT STRING_AGG(p.name || ' x' || oi.quantity, ', ' ORDER BY oi.id)
                 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id),
                ''
            ) AS items_summary
            FROM orders o ${where}
            ORDER BY o.created_at DESC
            LIMIT $${params.length-1} OFFSET $${params.length}
        `, params);

        res.json({
            orders: dataRes.rows,
            stats: {
                total:       Number(statsRes.rows[0].active_orders),
                verified:    Number(statsRes.rows[0].verified),
                confirmed:   Number(statsRes.rows[0].confirmed),
                cancelled:   Number(statsRes.rows[0].cancelled)
            },
            total,
            page:  Number(page),
            pages: Math.ceil(total / Number(limit))
        });
    } catch (err) {
        console.error('GET /reports/orders error:', err);
        res.status(500).json({ error: 'Failed to load orders report.' });
    }
});

module.exports = router;
