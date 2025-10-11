// backend/src/utils/audit.js
'use strict';

/**
 * Rich, fault-tolerant audit helper.
 *
 * Backwards compatible with:
 *   writeAudit({ req, category?, action, message? })
 *
 * New, richer usage:
 *   logAudit({
 *     req,                       // Express req (for user, ip, ua, headers)
 *     userId?, branchId?,        // override if needed
 *     category = 'system',       // e.g. 'auth', 'users', 'loans', ...
 *     action,                    // e.g. 'create','update','delete','login:success'
 *     message = '',              // short human-readable message
 *     entity?, entityId?,        // what was acted on
 *     meta?,                     // any extra context (object)
 *     before?, after?,           // snapshots to store (auto-redacted)
 *     redactions?                // keys to redact (default common secrets)
 *   })
 */

let AuditLog;
try {
  ({ AuditLog } = require('../models'));
} catch { /* soft-no-op if models not wired */ }

/* ---------------------------- utilities ---------------------------- */
const DEFAULT_REDACTIONS = ['password', 'secret', 'token', 'accessToken', 'refreshToken', 'pin'];

function redact(obj, keys = DEFAULT_REDACTIONS) {
  try {
    if (obj == null || typeof obj !== 'object') return obj;
    const lower = new Set(keys.map(k => String(k).toLowerCase()));
    const walk = (v) => {
      if (v == null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(walk);
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = lower.has(k.toLowerCase()) ? '***' : walk(val);
      }
      return out;
    };
    return walk(obj);
  } catch {
    return null;
  }
}

function jsonDiff(before, after) {
  try {
    const b = before || {};
    const a = after || {};
    const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
    const changes = {};
    for (const k of keys) {
      const bv = JSON.stringify(b[k]);
      const av = JSON.stringify(a[k]);
      if (bv !== av) changes[k] = { from: b[k], to: a[k] };
    }
    return Object.keys(changes).length ? changes : null;
  } catch {
    return null;
  }
}

function pickBranchId(req, fallback) {
  const hdr = req?.headers?.['x-branch-id'];
  if (hdr != null && hdr !== '') return isNaN(Number(hdr)) ? String(hdr) : Number(hdr);
  if (req?.user?.branchId != null) return req.user.branchId;
  return fallback ?? null;
}

function pickIp(req) {
  return (
    req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    req?.ip ||
    req?.connection?.remoteAddress ||
    null
  );
}

/* ------------------------------ core ------------------------------ */
async function logAudit({
  req,
  userId,
  branchId,
  category = 'system',
  action,
  message = '',
  entity,
  entityId,
  meta,
  before,
  after,
  redactions = DEFAULT_REDACTIONS,
} = {}) {
  try {
    if (!AuditLog?.create) return; // soft no-op

    // resolve ids & request info
    const uid = userId ?? req?.user?.id ?? null;
    const bid = branchId ?? pickBranchId(req, null);
    const ip = pickIp(req);
    const userAgent = (req?.headers?.['user-agent'] || '').toString();

    // safe snapshots
    const safeBefore = redact(before, redactions);
    const safeAfter  = redact(after,  redactions);

    await AuditLog.create({
      userId: uid,
      branchId: bid,
      category,
      action,
      entity: entity ?? null,
      entityId: entityId != null ? String(entityId) : null,
      message,
      ip,
      userAgent,
      meta: meta ?? null,
      before: safeBefore ?? null,
      after: safeAfter ?? null,
      // 'reversed' defaults handled by model
    });
  } catch (e) {
    // Never break the main flow because of auditing
    // console.error('logAudit error:', e?.message || e);
  }
}

/* ----------------------- backward-compat alias ---------------------- */
/**
 * Minimal writer (keeps existing calls working).
 * Example kept from your code:
 *   await writeAudit({ req, category: 'system', action: 'something', message: '...' });
 */
async function writeAudit({ req, category = 'system', action, message = '' } = {}) {
  return logAudit({ req, category, action, message });
}

/* ------------------------------ exports ---------------------------- */
module.exports = {
  logAudit,
  writeAudit,     // alias (back-compat)
  redact,
  jsonDiff,
};
