// backend/src/middleware/roleMiddleware.js

/**
 * Role‐based access control middleware.
 *
 * @param {string|string[]} allowedRoles  A single role or array of roles that are permitted.
 *                                        If you pass an empty array (the default), any authenticated
 *                                        user is allowed.
 */
function authorize(allowedRoles = []) {
  // Normalize to array
  if (typeof allowedRoles === 'string') {
    allowedRoles = [allowedRoles];
  }

  return (req, res, next) => {
    // 1) Make sure we ran authMiddleware first and have req.user
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    // 2) If no roles are specified, allow any authenticated user
    if (allowedRoles.length === 0) {
      return next();
    }

    // 3) Otherwise check if user's role is in the allowed list
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient rights.' });
    }

    // 4) All good
    next();
  };
}

module.exports = authorize;
