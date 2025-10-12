'use strict';

/**
 * Audit trail middleware
 * - Attaches req.audit(payload) for safe, best-effort audit logging.
 * - Never throws if the audit util/model/table is missing.
 */

let logAudit = null;
try {
  // Prefer the named export { logAudit } from ../utils/audit
  const u = require('../utils/audit');
  if (typeof u?.logAudit === 'function') {
    logAudit = u.logAudit;
  }
} catch {
  // ignore; we'll fallback to a noop below
}

if (typeof logAudit !== 'function') {
  // No-op fallback so callers can always do req.audit(...)
  logAudit = async () => {};
}

function auditTrail() {
  return (req, _res, next) => {
    /**
     * req.audit({ action, details })
     *  - action: string identifier (e.g. "login_success")
     *  - details: object (optional) extra info
     *  - req is auto-injected so IP/user/tenant can be captured by utils/audit
     */
    req.audit = async (payload = {}) => {
      try {
        await logAudit({ req, ...payload });
      } catch {
        // swallow errors to avoid breaking requests on audit failures
      }
    };

    next();
  };
}

module.exports = auditTrail;
