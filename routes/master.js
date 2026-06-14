const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../db');
const { addAuditLog } = require('../utils/db-helpers');

// ── Banner file upload config ─────────────────────────────────────────────────
const BANNER_DIR = path.join(__dirname, '..', 'public', 'uploads', 'banners');
if (!fs.existsSync(BANNER_DIR)) fs.mkdirSync(BANNER_DIR, { recursive: true });

const bannerStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, BANNER_DIR),
    filename: (req, file, cb) => {
        const unique = `banner-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
        cb(null, unique);
    }
});
const BANNER_ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const bannerUpload = multer({
    storage: bannerStorage,
    fileFilter: (req, file, cb) => {
        if (!BANNER_ALLOWED_TYPES.includes(file.mimetype)) {
            return cb(new Error('Invalid file type. Allowed: JPG, PNG, WEBP.'));
        }
        cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

function deleteBannerFile(imageUrl) {
    if (!imageUrl || !imageUrl.startsWith('/uploads/banners/')) return;
    try {
        const filePath = path.join(__dirname, '..', 'public', imageUrl);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
}

function requireRole(...roles) {
    const levels = { admin: 3, manager: 2, cashier: 1 };
    const min = Math.min(...roles.map((r) => levels[r] || 0));
    return (req, res, next) => {
        if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated.' });
        if ((levels[req.session.role] || 0) < min) return res.status(403).json({ error: 'Insufficient permissions.' });
        next();
    };
}

// ─────────────────────────────────────────────
// CATEGORIES (product categories)
// ─────────────────────────────────────────────

// GET /api/admin/master/categories
router.get('/categories', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load categories.' });
    }
});

// POST /api/admin/master/categories
router.post('/categories', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { name, active = true } = req.body;
        if (!name) return res.status(400).json({ error: 'Category name is required.' });
        const result = await client.query(`
            INSERT INTO categories (name, active) VALUES ($1,$2)
            ON CONFLICT (name) DO UPDATE SET active = EXCLUDED.active, updated_at = NOW()
            RETURNING *
        `, [name.trim(), active]);
        await addAuditLog(client, 'category_saved', 'category', name,
            req.session.fullName || req.session.username, { active });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Category saved.', category: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to save category.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/master/categories/:id/toggle
router.patch('/categories/:id/toggle', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'UPDATE categories SET active = NOT active, updated_at=NOW() WHERE id=$1 RETURNING *',
            [req.params.id]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        await addAuditLog(client, 'category_toggled', 'category', req.params.id,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Toggled.', category: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to toggle.' });
    } finally {
        client.release();
    }
});

// PUT /api/admin/master/categories/:id (rename)
router.put('/categories/:id', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required.' });
        const result = await client.query(
            'UPDATE categories SET name=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
            [name.trim(), req.params.id]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        await addAuditLog(client, 'category_updated', 'category', req.params.id,
            req.session.fullName || req.session.username, { name });
        await client.query('COMMIT');
        res.json({ message: 'Category updated.', category: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to update category.' });
    } finally {
        client.release();
    }
});

// ─────────────────────────────────────────────
// UOM
// ─────────────────────────────────────────────

// GET /api/admin/master/uom
router.get('/uom', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM uom ORDER BY code');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load UOM.' });
    }
});

// POST /api/admin/master/uom
router.post('/uom', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { code, name, active = true } = req.body;
        if (!code) return res.status(400).json({ error: 'UOM code is required.' });
        const result = await client.query(`
            INSERT INTO uom (code, name, active) VALUES ($1,$2,$3)
            ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, active=EXCLUDED.active, updated_at=NOW()
            RETURNING *
        `, [code.trim(), name || code, active]);
        await addAuditLog(client, 'uom_saved', 'uom', code,
            req.session.fullName || req.session.username, { active });
        await client.query('COMMIT');
        res.status(201).json({ message: 'UOM saved.', uom: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to save UOM.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/master/uom/:id/toggle
router.patch('/uom/:id/toggle', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'UPDATE uom SET active = NOT active, updated_at=NOW() WHERE id=$1 RETURNING *',
            [req.params.id]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        await addAuditLog(client, 'uom_toggled', 'uom', req.params.id,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Toggled.', uom: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to toggle.' });
    } finally {
        client.release();
    }
});

// PUT /api/admin/master/uom/:id (update code/name)
router.put('/uom/:id', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { code, name } = req.body;
        if (!code) return res.status(400).json({ error: 'Code is required.' });
        const result = await client.query(
            'UPDATE uom SET code=$1, name=$2, updated_at=NOW() WHERE id=$3 RETURNING *',
            [code.trim(), name || code, req.params.id]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        await addAuditLog(client, 'uom_updated', 'uom', req.params.id,
            req.session.fullName || req.session.username, { code, name });
        await client.query('COMMIT');
        res.json({ message: 'UOM updated.', uom: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to update UOM.' });
    } finally {
        client.release();
    }
});

// ─────────────────────────────────────────────
// TAX / VAT SETTINGS
// ─────────────────────────────────────────────

// GET /api/admin/master/settings/tax
router.get('/settings/tax', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tax_settings WHERE id = 1');
        res.json(result.rows[0] || { id: 1, name: 'VAT', rate: 15, active: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load tax settings.' });
    }
});

// PUT /api/admin/master/settings/tax
router.put('/settings/tax', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { name = 'VAT', rate, active = true } = req.body;
        const result = await client.query(`
            INSERT INTO tax_settings (id, name, rate, active, updated_by)
            VALUES (1, $1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET name=$1, rate=$2, active=$3, updated_by=$4, updated_at=NOW()
            RETURNING *
        `, [name, Number(rate) || 0, active, req.session.fullName || req.session.username]);
        await addAuditLog(client, 'tax_settings_updated', 'tax_settings', '1',
            req.session.fullName || req.session.username, { name, rate, active });
        await client.query('COMMIT');
        res.json({ message: 'Tax settings saved.', tax: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to save tax settings.' });
    } finally {
        client.release();
    }
});

// ─────────────────────────────────────────────
// CURRENCY SETTINGS
// ─────────────────────────────────────────────

// GET /api/admin/master/settings/currency
router.get('/settings/currency', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM currency_settings ORDER BY is_default DESC, code');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load currency settings.' });
    }
});

// POST /api/admin/master/settings/currency (upsert by code)
router.post('/settings/currency', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { code, name, symbol, exchange_rate, is_default, active, decimal_places, display_format } = req.body;
        if (!code || !name || !symbol) return res.status(400).json({ error: 'Code, name, and symbol are required.' });
        if (is_default) await client.query('UPDATE currency_settings SET is_default=FALSE');
        const result = await client.query(`
            INSERT INTO currency_settings (code, name, symbol, exchange_rate, is_default, active, decimal_places, display_format)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (code) DO UPDATE SET
                name=$2, symbol=$3, exchange_rate=$4, is_default=$5, active=$6,
                decimal_places=$7, display_format=$8, updated_at=NOW()
            RETURNING *
        `, [code.toUpperCase(), name, symbol, Number(exchange_rate) || 1, is_default || false, active !== false,
            Number(decimal_places) || 2, display_format || 'symbol-before']);
        await addAuditLog(client, 'currency_saved', 'currency', code,
            req.session.fullName || req.session.username, { name, is_default });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Currency saved.', currency: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to save currency.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/master/settings/currency/:code/default
router.patch('/settings/currency/:code/default', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE currency_settings SET is_default=FALSE');
        const result = await client.query(
            'UPDATE currency_settings SET is_default=TRUE, active=TRUE, updated_at=NOW() WHERE code=$1 RETURNING *',
            [req.params.code.toUpperCase()]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Currency not found.' }); }
        await addAuditLog(client, 'currency_default_set', 'currency', req.params.code,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Default currency set.', currency: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to set default currency.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/master/settings/currency/:code/toggle
router.patch('/settings/currency/:code/toggle', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const check = await client.query('SELECT * FROM currency_settings WHERE code=$1', [req.params.code.toUpperCase()]);
        if (!check.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        if (check.rows[0].is_default) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cannot deactivate default currency.' }); }
        const result = await client.query(
            'UPDATE currency_settings SET active = NOT active, updated_at=NOW() WHERE code=$1 RETURNING *',
            [req.params.code.toUpperCase()]
        );
        await addAuditLog(client, 'currency_toggled', 'currency', req.params.code,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Toggled.', currency: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to toggle currency.' });
    } finally {
        client.release();
    }
});

// ─────────────────────────────────────────────
// DELIVERY FEE RULES
// ─────────────────────────────────────────────

// GET /api/admin/master/settings/delivery-fee
router.get('/settings/delivery-fee', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM delivery_fee_rules ORDER BY min_weight');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load delivery fee rules.' });
    }
});

// POST /api/admin/master/settings/delivery-fee (upsert by min+max weight)
router.post('/settings/delivery-fee', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { min_weight = 0, max_weight = 0, fee = 0, currency = 'GBP', active = true, fee_type = 'KG', contact_required = false } = req.body;
        const validFeeType = ['KG', 'PACK'].includes(String(fee_type).toUpperCase()) ? String(fee_type).toUpperCase() : 'KG';
        const isPack = validFeeType === 'PACK';
        if (!isPack && (Number(max_weight) <= 0)) return res.status(400).json({ error: 'Invalid weight range.' });
        const existing = await client.query(
            'SELECT id FROM delivery_fee_rules WHERE min_weight=$1 AND max_weight=$2 AND fee_type=$3',
            [Number(min_weight), Number(max_weight), validFeeType]
        );
        let result;
        if (existing.rows.length) {
            result = await client.query(
                'UPDATE delivery_fee_rules SET fee=$1, currency=$2, active=$3, fee_type=$4, contact_required=$5, updated_at=NOW() WHERE id=$6 RETURNING *',
                [Number(fee) || 0, currency, active, validFeeType, !!contact_required, existing.rows[0].id]
            );
        } else {
            result = await client.query(
                'INSERT INTO delivery_fee_rules (min_weight, max_weight, fee, currency, active, fee_type, contact_required) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
                [Number(min_weight), Number(max_weight), Number(fee) || 0, currency, active, validFeeType, !!contact_required]
            );
        }
        await addAuditLog(client, 'delivery_fee_saved', 'delivery_fee_rule', String(result.rows[0].id),
            req.session.fullName || req.session.username, { min_weight, max_weight, fee, fee_type: validFeeType });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Delivery fee rule saved.', rule: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to save delivery fee rule.' });
    } finally {
        client.release();
    }
});

// PUT /api/admin/master/settings/delivery-fee/:id  (update existing rule by id)
router.put('/settings/delivery-fee/:id', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { min_weight = 0, max_weight = 0, fee = 0, currency = 'GBP', active = true, fee_type = 'KG', contact_required = false } = req.body;
        const validFeeType = ['KG', 'PACK'].includes(String(fee_type).toUpperCase()) ? String(fee_type).toUpperCase() : 'KG';
        const result = await client.query(
            'UPDATE delivery_fee_rules SET min_weight=$1, max_weight=$2, fee=$3, currency=$4, active=$5, fee_type=$6, contact_required=$7, updated_at=NOW() WHERE id=$8 RETURNING *',
            [Number(min_weight), Number(max_weight), Number(fee) || 0, currency, active, validFeeType, !!contact_required, req.params.id]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Rule not found.' }); }
        await addAuditLog(client, 'delivery_fee_updated', 'delivery_fee_rule', req.params.id,
            req.session.fullName || req.session.username, { min_weight, max_weight, fee, fee_type: validFeeType });
        await client.query('COMMIT');
        res.json({ message: 'Delivery fee rule updated.', rule: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to update delivery fee rule.' });
    } finally {
        client.release();
    }
});

// PATCH /api/admin/master/settings/delivery-fee/:id/toggle
router.patch('/settings/delivery-fee/:id/toggle', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'UPDATE delivery_fee_rules SET active = NOT active, updated_at=NOW() WHERE id=$1 RETURNING *',
            [req.params.id]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        await addAuditLog(client, 'delivery_fee_toggled', 'delivery_fee_rule', req.params.id,
            req.session.fullName || req.session.username, {});
        await client.query('COMMIT');
        res.json({ message: 'Toggled.', rule: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to toggle.' });
    } finally {
        client.release();
    }
});

// DELETE /api/admin/master/settings/delivery-fee/:id
router.delete('/settings/delivery-fee/:id', requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('DELETE FROM delivery_fee_rules WHERE id=$1 RETURNING *', [req.params.id]);
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
        await addAuditLog(client, 'delivery_fee_deleted', 'delivery_fee_rule', req.params.id,
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

// ─────────────────────────────────────────────
// BANK DETAILS
// ─────────────────────────────────────────────

// GET /api/admin/master/settings/bank
router.get('/settings/bank', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bank_details WHERE id = 1');
        res.json(result.rows[0] || { id: 1, bank_name: '', account_name: '', account_number: '', qr_code_image: '', active: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load bank details.' });
    }
});

// POST /api/admin/master/settings/bank
router.post('/settings/bank', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { bank_name, account_name, account_number, qr_code_image, active = true } = req.body;
        const result = await client.query(`
            INSERT INTO bank_details (id, bank_name, account_name, account_number, qr_code_image, active, updated_by)
            VALUES (1, $1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
                bank_name=$1, account_name=$2, account_number=$3, qr_code_image=$4,
                active=$5, updated_by=$6, updated_at=NOW()
            RETURNING *
        `, [bank_name || null, account_name || null, account_number || null,
            qr_code_image || null, active, req.session.fullName || req.session.username]);
        await addAuditLog(client, 'bank_details_updated', 'bank_details', '1',
            req.session.fullName || req.session.username, { bank_name, account_name });
        await client.query('COMMIT');
        res.json({ message: 'Bank details saved.', bank: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to save bank details.' });
    } finally {
        client.release();
    }
});

// ─── NUMBER SERIES ────────────────────────────────────────────────────────────

// GET /api/admin/master/number-series
router.get('/number-series', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM number_series ORDER BY id');
        res.json(result.rows.map((s) => ({
            id: s.id, documentType: s.document_type, prefix: s.prefix,
            nextNumber: Number(s.next_number), padding: Number(s.padding), active: s.is_active
        })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to load number series.' });
    }
});

// POST /api/admin/master/number-series (upsert by document_type)
router.post('/number-series', requireRole('manager', 'admin'), async (req, res) => {
    try {
        const { documentType, prefix, nextNumber = 1, padding = 6, active = true } = req.body;
        if (!documentType || !prefix) return res.status(400).json({ error: 'Document type and prefix are required.' });
        const result = await pool.query(`
            INSERT INTO number_series (document_type, prefix, next_number, padding, is_active, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (document_type) DO UPDATE SET
                prefix=$2, next_number=$3, padding=$4, is_active=$5, updated_at=NOW()
            RETURNING *
        `, [String(documentType).toUpperCase(), String(prefix).toUpperCase(), Number(nextNumber) || 1, Number(padding) || 6, active]);
        const s = result.rows[0];
        res.status(201).json({ message: 'Number series saved.', series: { id: s.id, documentType: s.document_type, prefix: s.prefix, nextNumber: Number(s.next_number), padding: Number(s.padding), active: s.is_active } });
    } catch (err) {
        console.error('POST /number-series error:', err);
        res.status(500).json({ error: 'Failed to save number series.' });
    }
});

// PATCH /api/admin/master/number-series/:id/toggle
router.patch('/number-series/:id/toggle', requireRole('manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE number_series SET is_active = NOT is_active, updated_at=NOW() WHERE id=$1 RETURNING *',
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Number series not found.' });
        const s = result.rows[0];
        res.json({ message: 'Toggled.', series: { id: s.id, documentType: s.document_type, prefix: s.prefix, nextNumber: Number(s.next_number), padding: Number(s.padding), active: s.is_active } });
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle number series.' });
    }
});

// GET /api/admin/master/settings/app-settings
router.get('/settings/app-settings', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT key, value FROM app_settings');
        const settings = {};
        result.rows.forEach((r) => { settings[r.key] = r.value; });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load app settings.' });
    }
});

// POST /api/admin/master/settings/app-settings
router.post('/settings/app-settings', requireRole('manager', 'admin'), async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'Key is required.' });
        await pool.query(
            'INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
            [key, value || '']
        );
        res.json({ message: 'Setting saved.', key, value });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save app setting.' });
    }
});

// ── Homepage Banners ──────────────────────────────────────────────────────────

// GET /api/admin/master/banners
router.get('/banners', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM homepage_banners ORDER BY display_order ASC, id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load banners.' });
    }
});

// POST /api/admin/master/banners/reorder  (must come before /:id routes)
router.post('/banners/reorder', requireRole('manager', 'admin'), async (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Invalid order data.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const item of order) {
            await client.query('UPDATE homepage_banners SET display_order=$1, updated_at=NOW() WHERE id=$2', [item.display_order, item.id]);
        }
        await client.query('COMMIT');
        res.json({ message: 'Banners reordered.' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to reorder banners.' });
    } finally {
        client.release();
    }
});

// POST /api/admin/master/banners  (add new — accepts multipart/form-data with image file)
router.post('/banners', requireRole('manager', 'admin'), (req, res, next) => {
    bannerUpload.single('image')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {
    try {
        let image_url = req.body.image_url || null;
        if (req.file) {
            image_url = `/uploads/banners/${req.file.filename}`;
        }
        if (!image_url) {
            return res.status(400).json({ error: 'Image is required.' });
        }
        const name = req.body.name || null;
        const active = req.body.active !== 'false' && req.body.active !== false;
        const countResult = await pool.query('SELECT COUNT(*) FROM homepage_banners');
        if (Number(countResult.rows[0].count) >= 5) {
            if (req.file) deleteBannerFile(image_url);
            return res.status(400).json({ error: 'Maximum 5 banners allowed.' });
        }
        const order = Number(countResult.rows[0].count) + 1;
        const result = await pool.query(
            'INSERT INTO homepage_banners (image_url, name, display_order, active) VALUES ($1,$2,$3,$4) RETURNING *',
            [image_url, name || `Banner ${order}`, order, active]
        );
        res.status(201).json({ banner: result.rows[0] });
    } catch (err) {
        if (req.file) deleteBannerFile(`/uploads/banners/${req.file.filename}`);
        res.status(500).json({ error: 'Failed to add banner.' });
    }
});

// POST /api/admin/master/banners/:id/update  (replace image / rename — multipart/form-data)
router.post('/banners/:id/update', requireRole('manager', 'admin'), (req, res, next) => {
    bannerUpload.single('image')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {
    try {
        const existing = await pool.query('SELECT image_url FROM homepage_banners WHERE id=$1', [req.params.id]);
        if (!existing.rows.length) {
            if (req.file) deleteBannerFile(`/uploads/banners/${req.file.filename}`);
            return res.status(404).json({ error: 'Banner not found.' });
        }
        const updates = [];
        const values = [];
        let i = 1;
        if (req.file) {
            const newUrl = `/uploads/banners/${req.file.filename}`;
            updates.push(`image_url=$${i++}`);
            values.push(newUrl);
            deleteBannerFile(existing.rows[0].image_url);
        } else if (req.body.image_url) {
            updates.push(`image_url=$${i++}`);
            values.push(req.body.image_url);
        }
        if (req.body.name) { updates.push(`name=$${i++}`); values.push(req.body.name); }
        if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
        updates.push('updated_at=NOW()');
        values.push(req.params.id);
        const result = await pool.query(
            `UPDATE homepage_banners SET ${updates.join(', ')} WHERE id=$${i} RETURNING *`,
            values
        );
        res.json({ banner: result.rows[0] });
    } catch (err) {
        if (req.file) deleteBannerFile(`/uploads/banners/${req.file.filename}`);
        res.status(500).json({ error: 'Failed to update banner.' });
    }
});

// PATCH /api/admin/master/banners/:id/toggle
router.patch('/banners/:id/toggle', requireRole('manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE homepage_banners SET active=NOT active, updated_at=NOW() WHERE id=$1 RETURNING *',
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Banner not found.' });
        res.json({ banner: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle banner.' });
    }
});

// DELETE /api/admin/master/banners/:id
router.delete('/banners/:id', requireRole('manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM homepage_banners WHERE id=$1 RETURNING id, image_url', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Banner not found.' });
        deleteBannerFile(result.rows[0].image_url);
        res.json({ message: 'Banner removed.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove banner.' });
    }
});

// ─────────────────────────────────────────────
// WHAT'S NEW ADS
// ─────────────────────────────────────────────

// GET /api/admin/master/whats-new
router.get('/whats-new', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM whats_new_ads ORDER BY display_order ASC, id ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Failed to load What\'s New ads.' }); }
});

// POST /api/admin/master/whats-new
router.post('/whats-new', requireRole('manager', 'admin'), async (req, res) => {
    const { title, description, media_type, image_url, video_url, button_text, button_link, display_order, active } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required.' });
    try {
        const maxOrder = await pool.query('SELECT COALESCE(MAX(display_order),0) AS m FROM whats_new_ads');
        const order = display_order != null ? Number(display_order) : Number(maxOrder.rows[0].m) + 1;
        const result = await pool.query(
            `INSERT INTO whats_new_ads (title,description,media_type,image_url,video_url,button_text,button_link,display_order,active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [title, description || '', media_type || 'image', image_url || '', video_url || '',
             button_text || '', button_link || '#shop', order, active !== false]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed to create What\'s New ad.' }); }
});

// PUT /api/admin/master/whats-new/:id
router.put('/whats-new/:id', requireRole('manager', 'admin'), async (req, res) => {
    const { title, description, media_type, image_url, video_url, button_text, button_link, display_order, active } = req.body;
    try {
        const result = await pool.query(
            `UPDATE whats_new_ads SET
                title=COALESCE($1,title), description=COALESCE($2,description), media_type=COALESCE($3,media_type),
                image_url=COALESCE($4,image_url), video_url=COALESCE($5,video_url),
                button_text=COALESCE($6,button_text), button_link=COALESCE($7,button_link),
                display_order=COALESCE($8,display_order), active=COALESCE($9,active), updated_at=NOW()
             WHERE id=$10 RETURNING *`,
            [title||null, description||null, media_type||null, image_url||null, video_url||null,
             button_text||null, button_link||null, display_order!=null?Number(display_order):null,
             active!=null?Boolean(active):null, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed to update What\'s New ad.' }); }
});

// PATCH /api/admin/master/whats-new/:id/toggle
router.patch('/whats-new/:id/toggle', requireRole('manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE whats_new_ads SET active=NOT active, updated_at=NOW() WHERE id=$1 RETURNING *',
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed to toggle.' }); }
});

// POST /api/admin/master/whats-new/reorder
router.post('/whats-new/reorder', requireRole('manager', 'admin'), async (req, res) => {
    const { order } = req.body; // [{ id, display_order }]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required.' });
    try {
        await Promise.all(order.map(({ id, display_order }) =>
            pool.query('UPDATE whats_new_ads SET display_order=$1, updated_at=NOW() WHERE id=$2', [display_order, id])
        ));
        res.json({ message: 'Reordered.' });
    } catch (err) { res.status(500).json({ error: 'Failed to reorder.' }); }
});

// DELETE /api/admin/master/whats-new/:id
router.delete('/whats-new/:id', requireRole('manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM whats_new_ads WHERE id=$1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found.' });
        res.json({ message: 'Removed.' });
    } catch (err) { res.status(500).json({ error: 'Failed to remove.' }); }
});

// GET /api/admin/master/settings/packaging
router.get('/settings/packaging', requireRole('cashier', 'manager', 'admin'), async (req, res) => {
    try {
        const result = await pool.query("SELECT key, value FROM app_settings WHERE key IN ('packaging_enabled','packaging_rules')");
        const s = {};
        result.rows.forEach(r => { s[r.key] = r.value; });
        let rules = [];
        try { rules = JSON.parse(s.packaging_rules || '[]'); } catch (_) {}
        if (!Array.isArray(rules) || !rules.length) {
            rules = [
                { minPcs: 1, maxPcs: 2,   weightKg: 0.700 },
                { minPcs: 3, maxPcs: null, weightKg: 1.000 }
            ];
        }
        res.json({ enabled: s.packaging_enabled !== 'false', rules });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load packaging settings.' });
    }
});

// POST /api/admin/master/settings/packaging
router.post('/settings/packaging', requireRole('manager', 'admin'), async (req, res) => {
    const { enabled, rules } = req.body;
    try {
        const upsert = (key, val) => pool.query(
            'INSERT INTO app_settings (key,value,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
            [key, String(val)]
        );
        const updates = [];
        if (enabled !== undefined) updates.push(upsert('packaging_enabled', enabled));
        if (rules   !== undefined) updates.push(upsert('packaging_rules', JSON.stringify(rules)));
        if (!updates.length) return res.status(400).json({ error: 'No valid settings provided.' });
        await Promise.all(updates);
        res.json({ message: 'Packaging settings saved.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save packaging settings.' });
    }
});

// POST /api/admin/master/settings/website  (save website content settings)
router.post('/settings/website', requireRole('manager', 'admin'), async (req, res) => {
    const allowed = ['site_title','site_hero','site_about','site_phone','site_whatsapp','site_email','site_service','site_messenger','site_logo','banner_transition','banner_speed','banner_show_arrows','banner_show_dots','whats_new_layout','section_order','site_address','site_facebook','site_instagram','site_tiktok','site_twitter','site_youtube','footer_tagline','footer_copyright','pickup_enabled','delivery_enabled','daily_order_limit','daily_limit_enabled','daily_limit_message','delivery_days','delivery_buffer_days','delivery_notice','delivery_blocked_dates','delivery_holiday_dates'];
    try {
        const updates = Object.entries(req.body)
            .filter(([k]) => allowed.includes(k))
            .map(([k, v]) => pool.query(
                'INSERT INTO app_settings (key,value,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
                [k, String(v)]
            ));
        if (!updates.length) return res.status(400).json({ error: 'No valid settings to save.' });
        await Promise.all(updates);
        res.json({ message: 'Website settings saved.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save website settings.' });
    }
});

module.exports = router;
