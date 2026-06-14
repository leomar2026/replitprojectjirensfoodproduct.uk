require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const pgSession    = require('connect-pg-simple')(session);
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const { pool, testConnection } = require('./db');

const authRoutes      = require('./routes/auth');
const productRoutes   = require('./routes/products');
const orderRoutes     = require('./routes/orders');
const adminRoutes     = require('./routes/admin');
const inventoryRoutes = require('./routes/inventory');
const posRoutes       = require('./routes/pos');
const expenseRoutes   = require('./routes/expenses');
const vendorRoutes    = require('./routes/vendors');
const masterRoutes    = require('./routes/master');
const promotionRoutes = require('./routes/promotions');
const reportRoutes    = require('./routes/reports');
const userRoutes        = require('./routes/users');
const maintenanceRoutes = require('./routes/maintenance');

const app    = express();
const PORT   = process.env.PORT || 5000;
const HOST   = '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false,
    frameguard: false
}));

// ── Request logger (4xx/5xx) ───────────────────────────────────────────────────
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        if (res.statusCode >= 400) {
            console.log(`[${res.statusCode}] ${req.method} ${req.path} (${Date.now() - start}ms) session_role=${req.session?.role || 'none'}`);
        }
    });
    next();
});

// ── Block sensitive file paths before anything else ────────────────────────────
const SENSITIVE_PATH = /\.(env|git|sql|md|sh|bak|backup|log|ini|cfg|conf|pem|key|crt)$/i;
const SENSITIVE_FILES = new Set([
    '/ecosystem.config.js',
    '/package-lock.json',
    '/package.json',
    '/db.js',
    '/.gitignore'
]);
app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    if (
        SENSITIVE_PATH.test(p) ||
        SENSITIVE_FILES.has(p) ||
        p.startsWith('/.git') ||
        p.startsWith('/.env') ||
        p.includes('/.git/') ||
        p.startsWith('/database/') ||
        p.startsWith('/routes/') ||
        p.startsWith('/middleware/') ||
        p.startsWith('/utils/') ||
        p.startsWith('/scripts/')
    ) {
        console.log(`[BLOCKED] ${req.method} ${req.path}`);
        return res.status(403).end();
    }
    next();
});

// ── Body size limits ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── CORS ───────────────────────────────────────────────────────────────────────
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
    origin: corsOrigin && corsOrigin !== 'true' ? corsOrigin : true,
    credentials: true
}));

// ── General API rate limiter (500 req / 15 min per IP) ─────────────────────────
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', generalLimiter);

// ── Session ────────────────────────────────────────────────────────────────────
app.use(session({
    store: new pgSession({
        pool,
        tableName: 'session',
        createTableIfMissing: false
    }),
    name: 'jirens.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 8 * 60 * 60 * 1000
    }
}));

// ── Public data endpoints (no auth required) ───────────────────────────────────
app.get('/api/banners', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, image_url, name, display_order, active FROM homepage_banners ORDER BY display_order ASC, id ASC'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load banners.' });
    }
});

app.get('/api/orders/today-count', async (req, res) => {
    try {
        const [countResult, settingsResult] = await Promise.all([
            pool.query(
                `SELECT COUNT(*) FROM orders WHERE created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day' AND LOWER(COALESCE(order_status,'')) != 'cancelled'`
            ),
            pool.query(
                "SELECT key, value FROM app_settings WHERE key IN ('daily_order_limit','daily_limit_enabled','daily_limit_message')"
            )
        ]);
        const s = {};
        settingsResult.rows.forEach(r => { s[r.key] = r.value; });
        const count  = parseInt(countResult.rows[0].count, 10);
        const limit  = Math.max(1, parseInt(s.daily_order_limit || '15', 10) || 15);
        const enabled = s.daily_limit_enabled !== 'false';
        const message = s.daily_limit_message || 'Maximum order limit for today has been reached. Please try to place your order tomorrow.';
        res.json({ count, limit, enabled, limitReached: enabled && count >= limit, message });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load order count.' });
    }
});

app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT key, value FROM app_settings WHERE key LIKE 'site_%' OR key LIKE 'banner_%' OR key LIKE 'footer_%' OR key LIKE 'ice_pack_%' OR key LIKE 'daily_%' OR key LIKE 'delivery_%' OR key='whats_new_layout' OR key='section_order' OR key='large_order_contact_message' OR key='site_service' OR key='pickup_enabled' OR key='delivery_enabled'"
        );
        const settings = {};
        result.rows.forEach(r => { settings[r.key] = r.value; });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load settings.' });
    }
});

app.get('/api/whats-new', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, title, description, media_type, image_url, video_url, button_text, button_link, display_order, active FROM whats_new_ads ORDER BY display_order ASC, id ASC'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load What\'s New.' });
    }
});

// ── Public checkout settings (no auth) ────────────────────────────────────────
app.get('/api/public/checkout-settings', async (req, res) => {
    try {
        const [taxResult, delivResult, promoResult] = await Promise.all([
            pool.query('SELECT name, rate, active FROM tax_settings WHERE id = 1'),
            pool.query('SELECT id, min_weight, max_weight, fee, currency, active, fee_type, contact_required FROM delivery_fee_rules ORDER BY min_weight'),
            pool.query("SELECT id, name, type, discount_type, discount_value, min_amount, active FROM promotions WHERE active = true")
        ]);
        const tax = taxResult.rows[0] || { name: 'VAT', rate: 0, active: false };
        res.json({
            tax: { name: tax.name, rate: Number(tax.rate), active: tax.active },
            deliveryFeeRules: delivResult.rows,
            promotions: promoResult.rows
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load checkout settings.' });
    }
});

// ── API routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',             authRoutes);
app.use('/api/products',         productRoutes);
app.use('/api/orders',           orderRoutes);
app.use('/api/admin',            adminRoutes);
app.use('/api/admin/inventory',  inventoryRoutes);
app.use('/api/admin/pos',        posRoutes);
app.use('/api/admin/expenses',   expenseRoutes);
app.use('/api/admin/vendors',    vendorRoutes);
app.use('/api/admin/master',     masterRoutes);
app.use('/api/admin/promotions', promotionRoutes);
app.use('/api/admin/reports',    reportRoutes);
app.use('/api/admin/users',       userRoutes);
app.use('/api/admin/maintenance', maintenanceRoutes);

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    const dbOk = await testConnection();
    res.json({
        status: 'ok',
        app: "Jiren's Food Product",
        version: '3.0.0',
        timestamp: new Date().toISOString(),
        database: dbOk ? 'connected' : 'unavailable'
    });
});

// ── Static frontend — no-cache for HTML ───────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// ── SPA fallback ───────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Production error handler (no stack trace leaks) ───────────────────────────
app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    if (isProd) {
        res.status(err.status || 500).json({ error: 'An unexpected error occurred.' });
    } else {
        res.status(err.status || 500).json({ error: err.message, stack: err.stack });
    }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, async () => {
    console.log(`Server running at http://${HOST}:${PORT} [${process.env.NODE_ENV || 'development'}]`);
    const dbOk = await testConnection();
    console.log(dbOk ? 'Database connected.' : 'WARNING: Database connection failed.');
    if (dbOk) {
        pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date DATE').catch(() => {});
        pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255)').catch(() => {});
    }
});
