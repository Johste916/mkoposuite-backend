// backend/src/middleware/authorize.js
"use strict";

/**
 * Back-compat authorization shim.
 * - Default export is a middleware factory identical to `allow(...)`.
 * - Also exposes helpers: { allow, requireRole, authorizeAny, authorizeAll, authorizeRole, permit }.
 *
 * Works with patterns like:
 *   const authorize = require('../middleware/authorize');
 *   router.get('/admin', authorize('admin.view'), handler);
 *   router.post('/x', authorize(['a.b', 'c.d']), handler);
 *   router.get('/owner', authorize.authorizeRole(['owner','admin']), handler);
 */

const { allow, requireRole } = require("./permissions");

/** Main factory (same as allow) */
function authorize(actionOrList, opts) {
  return allow(actionOrList, opts);
}

/** Shortcuts / aliases */
const authorizeAny = (actions) => allow(actions, { mode: "any" });
const authorizeAll = (actions) => allow(actions, { mode: "all" });
function authorizeRole(roles) {
  const list = Array.isArray(roles) ? roles : [roles];
  return requireRole(list);
}
const permit = authorize; // alias for older code

// Export the callable function with extra properties for maximum compatibility
module.exports = Object.assign(authorize, {
  authorize,
  permit,
  allow,
  requireRole,
  authorizeAny,
  authorizeAll,
  authorizeRole,
});
