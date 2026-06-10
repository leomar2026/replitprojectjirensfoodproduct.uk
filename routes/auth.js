const express   = require('express');
const bcrypt    = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { pool }  = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Strict rate limit for login — 10 failed attempts per 15 min per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    const ip = req.ip || req.socket?.remoteAddress || null;

    try {
        const result = await pool.query(
            'SELECT id, username, email, password, role, full_name, is_active FROM users WHERE username = $1',
            [username.trim().toLowerCase()]
        );

        const user = result.rows[0];

        if (!user) {
            console.warn(`[AUTH] Failed login — unknown user "${username}" from ${ip}`);
            await pool.query(
                `INSERT INTO audit_logs (action, entity_type, entity_id, user_name, details, ip_address)
                 VALUES ('login_failed', 'user', $1, $1, $2, $3)`,
                [username.trim().toLowerCase(), JSON.stringify({ reason: 'Unknown username' }), ip]
            );
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        if (!user.is_active) {
            console.warn(`[AUTH] Failed login — disabled account "${username}" from ${ip}`);
            await pool.query(
                `INSERT INTO audit_logs (action, entity_type, entity_id, user_name, details, user_id, user_role, ip_address)
                 VALUES ('login_failed', 'user', $1, $1, $2, $3, $4, $5)`,
                [user.username, JSON.stringify({ reason: 'Account disabled' }), user.id, user.role, ip]
            );
            return res.status(403).json({ error: 'Account is disabled. Contact an administrator.' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            console.warn(`[AUTH] Failed login — wrong password for "${username}" from ${ip}`);
            await pool.query(
                `INSERT INTO audit_logs (action, entity_type, entity_id, user_name, details, user_id, user_role, ip_address)
                 VALUES ('login_failed', 'user', $1, $1, $2, $3, $4, $5)`,
                [user.username, JSON.stringify({ reason: 'Wrong password' }), user.id, user.role, ip]
            );
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        req.session.userId   = user.id;
        req.session.username = user.username;
        req.session.role     = user.role;
        req.session.fullName = user.full_name;

        await pool.query(
            `INSERT INTO audit_logs (action, entity_type, entity_id, user_name, details, user_id, user_role, ip_address)
             VALUES ('login', 'user', $1, $1, $2, $3, $4, $5)`,
            [user.username, JSON.stringify({ full_name: user.full_name }), user.id, user.role, ip]
        );

        res.json({
            message: 'Login successful.',
            user: {
                id:       user.id,
                username: user.username,
                email:    user.email,
                role:     user.role,
                fullName: user.full_name
            }
        });
    } catch (err) {
        console.error('[AUTH] Login error:', err);
        res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed.' });
        }
        res.clearCookie('jirens.sid');
        res.json({ message: 'Logged out successfully.' });
    });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, email, role, full_name, is_active, created_at FROM users WHERE id = $1',
            [req.session.userId]
        );

        const user = result.rows[0];
        if (!user) {
            req.session.destroy(() => {});
            return res.status(401).json({ error: 'Session invalid. Please log in again.' });
        }

        res.json({
            id:        user.id,
            username:  user.username,
            email:     user.email,
            role:      user.role,
            fullName:  user.full_name,
            isActive:  user.is_active,
            createdAt: user.created_at
        });
    } catch (err) {
        console.error('[AUTH] /me error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
