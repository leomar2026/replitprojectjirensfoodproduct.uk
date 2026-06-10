const ROLE_HIERARCHY = { admin: 3, manager: 2, cashier: 1 };

function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        const userRoleLevel = ROLE_HIERARCHY[req.session.role] || 0;
        const requiredLevel = Math.min(...roles.map(r => ROLE_HIERARCHY[r] || 99));
        if (userRoleLevel < requiredLevel) {
            return res.status(403).json({ error: 'Forbidden. Insufficient permissions.' });
        }
        next();
    };
}

module.exports = { requireAuth, requireRole };
