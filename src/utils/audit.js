'use strict';

/**
 * Safe audit logger: exports both { logAudit, writeAudit }.
 *
 * - If an AuditLog model/table exists, it writes there.
 * - If models/table are missing, it becomes a NO-OP (never throws).
 * - Accepts either:
 *     logAudit({ req, action, details/meta, ... })
 *   or
 *     logAudit({ userId, tenantId, ip, ua, action, details/meta, ... })
 *
 * Compatible with existing code that does:
 *   const { logAudit } = require('../utils/audit');
 */

let db = null;
try { db = require('../models'); } catch {}
// try common naming variants
const AuditLog =
  db?.AuditLog ||
  db?.Audit ||
  db?.models?.AuditLog ||
  null;

/* ----------------- helpers ----------------- */
function pick(obj, ...keys) {
  const out = {};
  if (!obj) return out;
  keys.forEach(k => { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}

function safeJson(x) {
  if (x == null) return null;
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}

function guessCategory(path = '') {
  const p = (path || '').toLowerCase();
  if (p.startsWith('/api/auth')) return 'auth';
  if (p.includes('/users')) return 'users';
  if (p.includes('/loans')) return 'loans';
  if (p.includes('/repay')) return 'repayments';
  if (p.includes('/roles') || p.includes('/permissions')) return 'permissions';
  if (p.includes('/branches')) return 'branches';
  return 'system';
}

function guessAction(method = '', statusCode = 200, path = '') {
  const m = String(method || '').toUpperCase();
  if (m === 'POST') return 'create';
  if (m === 'PUT' || m === 'PATCH') return 'update';
  if (m === 'DELETE') return 'delete';
  if (m === 'GET' && path.includes('/login') && statusCode < 400) return 'login:success';
  if (m === 'GET' && path.includes('/login') && statusCode >= 400) return 'login:failed';
  return m.toLowerCase() || 'event';
}

function resStatusGuess(req) {
  return req?.res?.statusCode ?? 0;
}

function ipFromReq(req) {
  const xf = req?.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) {
    const first = xf.split(',')[0]?.trim();
    if (first) return first;
  }
  return req?.socket?.remoteAddress || req?.ip || null;
}

/* --------------- core writer --------------- */
async function writeAudit(input = {}) {
  try {
    if (!AuditLog || typeof AuditLog.create !== 'function') {
      // Dev/no-table mode — noop
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('[audit noop]', {
          action: input.action,
          userId: input.userId || input?.req?.user?.id || null,
        });
      }
      return;
    }

    const req = input.req || null;

    const method = input.method || req?.method || null;
    const path   = input.path   || req?.originalUrl || req?.url || null;
    const status = Number(input.statusCode ?? resStatusGuess(req));

    const userId =
      input.userId ??
      req?.user?.id ??
      req?.user?.userId ??
      null;

    // Try common places for tenant/branch
    const tenantId =
      input.tenantId ??
      req?.headers?.['x-tenant-id'] ??
      req?.user?.tenantId ??
      req?.tenant?.id ??
      null;

    const branchId =
      input.branchId ??
      req?.headers?.['x-branch-id'] ??
      req?.user?.branchId ??
      null;

    const ip  = input.ip  ?? ipFromReq(req);
    const ua  = input.ua  ?? req?.headers?.['user-agent'] ?? null;

    const category = input.category || guessCategory(path || '');
    const action   = String(input.action || guessAction(method, status, path)).slice(0, 128);

    const message  = input.message || (method && path ? `${method} ${path} • ${status || ''}`.trim() : null);

    // Prefer "details" if caller used it; alias to meta
    const meta = input.meta ?? input.details ?? {
      method, path, statusCode: status, ua,
      ctx: req?.tenant || req?.context || pick(req?.user || {}, 'tenantId', 'branchId')
    };

    const payload = {
      // common columns (include only those that exist)
      userId, tenantId, branchId,
      ip, ua, path, method,
      category, action, message,
      meta: safeJson(meta),
      before: safeJson(input.before ?? null),
      after:  safeJson(input.after  ?? null),
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
    };

    // only keep attributes the model actually has
    const attrs = AuditLog.rawAttributes ? Object.keys(AuditLog.rawAttributes) : Object.keys(payload);
    const safePayload = pick(payload, ...attrs);

    await AuditLog.create(safePayload);
  } catch (e) {
    // Never break request flow because of audit
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[audit error swallowed]', e?.message || e);
    }
  }
}

/**
 * Backward-compatible alias used throughout codebase.
 * Example:
 *   await logAudit({ req, action: 'login_success', details: {...} })
 */
async function logAudit(input = {}) {
  return writeAudit(input);
}

module.exports = { logAudit, writeAudit };
