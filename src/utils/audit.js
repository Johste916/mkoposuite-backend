// backend/src/utils/audit.js
let AuditLog;
try { ({ AuditLog } = require('../models')); } catch {}

const MAX_MSG = 280;

/** Make a short, human string and a structured details object. */
function buildEvent({ req, category='system', action, message, entity=null, entityId=null, details=null }) {
  const ctx = {
    // Light context (safe to keep)
    ip: req?.ip || null,
    ua: req?.headers?.['user-agent'] || null,
    method: req?.method || null,
    path: req?.originalUrl || req?.url || null,
    tenantId: req?.headers?.['x-tenant-id'] || req?.user?.tenantId || null,
    branchId: req?.headers?.['x-branch-id'] || req?.user?.branchId || null,
  };

  // Prefer a clean one-line message; fall back to action + entity
  let msg = (message || '').trim();
  if (!msg) {
    const ent = entity ? `${entity}${entityId ? `#${entityId}` : ''}` : '';
    msg = [category, action, ent].filter(Boolean).join(' • ');
  }
  if (msg.length > MAX_MSG) msg = msg.slice(0, MAX_MSG - 1) + '…';

  // Keep all “raw” bits in details (JSON), never in message
  const safeDetails =
    details && typeof details === 'object'
      ? details
      : details
      ? { note: String(details) }
      : {};

  // Attach the request body in a tiny/filtered way (don’t log secrets)
  const body = (() => {
    const b = req?.body && typeof req.body === 'object' ? { ...req.body } : null;
    if (!b) return null;
    for (const k of Object.keys(b)) {
      if (/pass(word)?|secret|token|otp/i.test(k)) b[k] = '***';
    }
    // If super large, truncate stringified body
    try {
      const s = JSON.stringify(b);
      if (s.length > 4000) return { _truncated: true };
    } catch {}
    return b;
  })();

  const mergedDetails = { ...safeDetails, meta: ctx, ...(body ? { body } : {}) };

  return {
    userId: req?.user?.id || null,
    branchId: req?.user?.branchId || null,
    category,
    action,
    message: msg,
    entity: entity || null,
    entityId: entityId != null ? String(entityId) : null,
    details: mergedDetails,
    ip: ctx.ip,
  };
}

async function writeAudit({ req, category='system', action, message='', entity=null, entityId=null, details=null }) {
  try {
    if (!AuditLog?.create || !req) return;
    const row = buildEvent({ req, category, action, message, entity, entityId, details });
    await AuditLog.create(row);
  } catch (e) {
    // do not crash business flow on audit failure
    // console.error('writeAudit error:', e);
  }
}

module.exports = { writeAudit };
