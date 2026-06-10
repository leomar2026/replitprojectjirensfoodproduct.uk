const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { pool } = require('../db');
const { upload, UPLOAD_DIR } = require('../middleware/upload');
const { addAuditLog } = require('../utils/db-helpers');

const router = express.Router();

// DB-driven VAT — reads from tax_settings table; falls back to 0 if inactive or not found
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

// DB-driven delivery fee — falls back to hardcoded tiers if no active KG rules exist
async function calcDeliveryFeeFromDb(totalWeightKg, fulfillmentMethod, client) {
    if (fulfillmentMethod === 'pickup') return 0;
    const weight = Number(totalWeightKg || 0);
    if (weight <= 0) return 0;
    try {
        const result = await client.query(
            `SELECT min_weight, max_weight, fee
             FROM delivery_fee_rules
             WHERE active = true AND (fee_type = 'KG' OR fee_type IS NULL)
             ORDER BY max_weight ASC`
        );
        if (result.rows.length) {
            const rule =
                result.rows.find(r => weight >= Number(r.min_weight) && weight <= Number(r.max_weight)) ||
                result.rows.find(r => weight <= Number(r.max_weight)) ||
                result.rows[result.rows.length - 1];
            return Number(rule?.fee || 0);
        }
    } catch (_) {}
    // Hardcoded fallback
    if (weight <= 2)  return 3.65;
    if (weight <= 20) return 5.55;
    return 11.95;
}

async function getIcePackSettings(client) {
    try {
        const result = await client.query(
            "SELECT key, value FROM app_settings WHERE key LIKE 'ice_pack_%'"
        );
        const s = {};
        result.rows.forEach(r => { s[r.key] = r.value; });
        return {
            enabled:       s.ice_pack_enabled !== 'false',
            weightKg:      parseFloat(s.ice_pack_weight_kg     || '0.5') || 0.5,
            packsPerPiece: Math.max(1, parseInt(s.ice_pack_packs_per_piece || '2', 10) || 2),
            minQty:        Math.max(0, parseInt(s.ice_pack_min_qty          || '1', 10) || 1),
        };
    } catch (_) {
        return { enabled: true, weightKg: 0.5, packsPerPiece: 2, minQty: 1 };
    }
}

function calcIcePack(totalFrozenPacks, settings, fulfillmentMethod) {
    if (fulfillmentMethod !== 'delivery' || !settings.enabled || totalFrozenPacks <= 0) {
        return { requiredQty: 0, totalWeight: 0 };
    }
    const rawQty     = Math.ceil(totalFrozenPacks / Math.max(1, settings.packsPerPiece));
    const requiredQty = Math.max(rawQty, settings.minQty);
    return {
        requiredQty,
        totalWeight: parseFloat((requiredQty * settings.weightKg).toFixed(3))
    };
}

function generateOrderNumber(nextId) {
    return `ORDER-${String(nextId).padStart(6, '0')}`;
}

async function getDailyLimitSettings(client) {
    try {
        const result = await client.query(
            "SELECT key, value FROM app_settings WHERE key IN ('daily_order_limit','daily_limit_enabled','daily_limit_message')"
        );
        const s = {};
        result.rows.forEach(r => { s[r.key] = r.value; });
        return {
            enabled: s.daily_limit_enabled !== 'false',
            limit: Math.max(1, parseInt(s.daily_order_limit || '15', 10) || 15),
            message: s.daily_limit_message || 'Maximum order limit for today has been reached. Please try to place your order tomorrow.'
        };
    } catch (_) {
        return { enabled: true, limit: 15, message: 'Maximum order limit for today has been reached. Please try to place your order tomorrow.' };
    }
}

// POST /api/orders — customer checkout
router.post('/', upload.single('payment_proof'), async (req, res) => {
    const {
        customer_name, customer_phone, fulfillment_method,
        delivery_address, delivery_city, delivery_area,
        payment_method, payment_reference, notes,
        items, idempotency_key, delivery_date
    } = req.body;

    if (!customer_name || !customer_phone) {
        return res.status(400).json({ error: 'Customer name and phone are required.' });
    }

    let cartItems;
    try {
        cartItems = JSON.parse(items || '[]');
    } catch {
        return res.status(400).json({ error: 'Invalid items format.' });
    }

    if (!Array.isArray(cartItems) || !cartItems.length) {
        return res.status(400).json({ error: 'Order must contain at least one item.' });
    }

    if (payment_method === 'bank_transfer' && !req.file) {
        return res.status(400).json({ error: 'Payment proof is required for Bank Transfer payments.' });
    }

    // ── Idempotency check ─────────────────────────────────────────────────────
    if (idempotency_key) {
        const existing = await pool.query(
            'SELECT order_number, id FROM orders WHERE idempotency_key = $1 LIMIT 1',
            [idempotency_key]
        );
        if (existing.rows.length) {
            if (req.file) {
                try { fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename)); } catch {}
            }
            const ord = existing.rows[0];
            return res.status(200).json({
                message: 'Order already placed.',
                orderNumber: ord.order_number,
                orderId: ord.id,
                duplicate: true
            });
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ── Daily order limit check (serialized with advisory lock) ──────────
        await client.query('SELECT pg_advisory_xact_lock(9876543210)');
        const limitSettings = await getDailyLimitSettings(client);
        if (limitSettings.enabled) {
            const countResult = await client.query(
                `SELECT COUNT(*) FROM orders
                 WHERE created_at >= CURRENT_DATE
                   AND created_at < CURRENT_DATE + INTERVAL '1 day'
                   AND LOWER(COALESCE(order_status,'')) != 'cancelled'`
            );
            const todayCount = parseInt(countResult.rows[0].count, 10);
            if (todayCount >= limitSettings.limit) {
                await client.query('ROLLBACK');
                if (req.file) try { fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename)); } catch {}
                return res.status(429).json({ error: limitSettings.message, dailyLimitReached: true });
            }
        }

        let subtotal    = 0;
        let totalFrozenPacks = 0;
        const productWeightTotal = { value: 0 };
        const lineItems = [];

        for (const item of cartItems) {
            if (!item.product_id || !item.quantity || item.quantity < 1) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Invalid item: product_id and quantity >= 1 required.' });
            }

            const productResult = await client.query(
                'SELECT id, name, sku, price, weight_kg, stock_quantity, is_active FROM products WHERE id = $1 FOR UPDATE',
                [item.product_id]
            );
            const product = productResult.rows[0];

            if (!product || !product.is_active) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Product not available: ${item.product_id}` });
            }

            if (Number(product.stock_quantity) < Number(item.quantity)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Insufficient stock for ${product.name}.` });
            }

            const qty        = Number(item.quantity);
            const unitPrice  = Number(product.price);
            const weightKg   = Number(product.weight_kg);
            const lineWeight = weightKg * qty;
            const lineTotal  = unitPrice * qty;

            subtotal                   += lineTotal;
            productWeightTotal.value   += lineWeight;
            totalFrozenPacks           += qty;
            lineItems.push({ product, qty, unitPrice, weightKg, lineWeight, lineTotal });
        }

        // ── Ice pack calculation ─────────────────────────────────────────────
        const iceSettings  = await getIcePackSettings(client);
        const icePack      = calcIcePack(totalFrozenPacks, iceSettings, fulfillment_method || 'pickup');
        const productWeight = parseFloat(productWeightTotal.value.toFixed(3));
        const totalDeliveryWeight = parseFloat((productWeight + icePack.totalWeight).toFixed(3));

        // ── Delivery fee (DB-driven, uses total delivery weight) ─────────────
        const deliveryFee = await calcDeliveryFeeFromDb(totalDeliveryWeight, fulfillment_method || 'pickup', client);

        const vatSettings = await getVatSettings(client);
        const vatAmount   = parseFloat((subtotal * vatSettings.rate / 100).toFixed(2));
        const vatRate     = vatSettings.active ? vatSettings.rate : 0;
        const totalAmount = parseFloat((subtotal + vatAmount + deliveryFee).toFixed(2));
        const paymentMethodDisplay = payment_method === 'bank_transfer' ? 'Bank Transfer' : 'Cash on Delivery';

        const seqResult  = await client.query("SELECT nextval('orders_id_seq') AS next_id");
        const nextId     = seqResult.rows[0].next_id;
        const orderNumber = generateOrderNumber(nextId);

        await client.query(`
            INSERT INTO orders (
                id, order_number, idempotency_key,
                customer_name, customer_phone,
                fulfillment_method, delivery_date,
                delivery_address, delivery_city, delivery_area,
                payment_method, payment_method_display, payment_reference,
                subtotal, vat_rate, vat_amount,
                total_weight, delivery_fee, total_amount, notes,
                total_frozen_packs, packs_per_ice_pack, required_ice_pack_qty,
                ice_pack_weight_per_piece, ice_pack_total_weight,
                product_weight_total, total_delivery_weight
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,
                $8,$9,$10,$11,$12,$13,
                $14,$15,$16,$17,$18,$19,$20,
                $21,$22,$23,$24,$25,$26,$27
            )
        `, [
            nextId, orderNumber, idempotency_key || null,
            customer_name.trim(), customer_phone.trim(),
            fulfillment_method || 'pickup',
            delivery_date || null,
            delivery_address || null, delivery_city || null, delivery_area || null,
            payment_method || 'cash_on_delivery', paymentMethodDisplay,
            payment_reference || null,
            subtotal, vatRate, vatAmount,
            totalDeliveryWeight, deliveryFee, totalAmount,
            notes || null,
            totalFrozenPacks, iceSettings.packsPerPiece, icePack.requiredQty,
            iceSettings.weightKg, icePack.totalWeight,
            productWeight, totalDeliveryWeight
        ]);

        for (const line of lineItems) {
            await client.query(`
                INSERT INTO order_items
                    (order_id, product_id, product_name, product_sku, quantity, unit_price, weight_kg, line_weight, line_total)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            `, [nextId, line.product.id, line.product.name, line.product.sku,
                line.qty, line.unitPrice, line.weightKg, line.lineWeight, line.lineTotal]);

            const stockBefore = Number(line.product.stock_quantity);
            const stockAfter  = stockBefore - line.qty;

            await client.query(
                'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
                [stockAfter, line.product.id]
            );

            await client.query(`
                INSERT INTO inventory_movements
                    (product_id, product_name, product_sku, movement_type,
                     quantity, quantity_before, quantity_after,
                     reference_type, reference_number, notes, created_by)
                VALUES ($1,$2,$3,'Sales Deduction',$4,$5,$6,'Online Order',$7,$8,'System')
            `, [
                line.product.id, line.product.name, line.product.sku,
                line.qty, stockBefore, stockAfter,
                orderNumber, `Order placement: ${orderNumber}`
            ]);
        }

        if (req.file) {
            await client.query(`
                INSERT INTO payment_proofs
                    (order_id, filename, original_name, file_type, file_size, upload_path)
                VALUES ($1,$2,$3,$4,$5,$6)
            `, [nextId, req.file.filename, req.file.originalname,
                req.file.mimetype, req.file.size,
                path.join('uploads', 'proofs', req.file.filename)]);
        }

        await addAuditLog(client, 'order_placed', 'order', orderNumber, 'Customer', {
            order_number: orderNumber,
            customer_name: customer_name.trim(),
            total_amount: totalAmount,
            payment_method,
            ice_pack_qty: icePack.requiredQty,
            ice_pack_weight: icePack.totalWeight,
            has_idempotency_key: !!idempotency_key
        });

        await client.query('COMMIT');
        res.status(201).json({ message: 'Order placed successfully.', orderNumber, orderId: nextId });
    } catch (err) {
        await client.query('ROLLBACK');
        if (req.file) {
            try { fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename)); } catch {}
        }
        console.error('POST /api/orders error:', err);
        res.status(500).json({ error: 'Failed to place order. Please try again.' });
    } finally {
        client.release();
    }
});

module.exports = router;
