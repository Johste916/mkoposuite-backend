// backend/src/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

// Extract "Bearer <token>" safely (case-insensitive)
function getBearerToken(header) {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) return null;
  return token.trim();
}

// Authenticate every protected request
function authenticateUser(req, res, next) {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization token' });
    }

    const secret = process.env.JWT_SECRET || process.env.JWT_KEY;
    if (!secret) {
      console.error('JWT secret is not set (JWT_SECRET or JWT_KEY).');
      return res.status(500).json({ error: 'Server misconfigured: JWT secret missing' });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (e) {
      console.warn('JWT verify failed:', e.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = payload;
    return next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

// Role-based guard (use AFTER authenticateUser)
function authorizeRoles(...roles) {
  const allow = roles.map((r) => String(r).toLowerCase());
  return (req, res, next) => {
    const current = (req.user?.role || '').toLowerCase();
    if (!current) return res.status(401).json({ error: 'Unauthorized' });
    if (allow.length && !allow.includes(current)) {
      return res.status(403).json({ error: 'Access denied: insufficient role' });
    }
    next();
  };
}

module.exports = {
  authenticateUser,
  authorizeRoles,
};
