'use strict';

let AuditLog;
try { ({ AuditLog } = require('../models')); } catch {}

/* ---------------------------- small helpers ---------------------------- */
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
  } catch { return null; }
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

/**
 * logAudit – rich writer that only persists columns that exist on the model.
 * You can safely pass extra props; they'll be ignored if not in the schema.
 */
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
    if (!AuditLog?.create) return; // soft no-op if model not available

    const attrs = (AuditLog?.rawAttributes && Object.keys(AuditLog.rawAttributes)) || [];
    const allow = new Set(attrs);

    const data = {
      userId:   userId ?? req?.user?.id ?? null,
      branchId: branchId ?? pickBranchId(req, null),
      category,
      action,
      message,
      ip: pickIp(req),
    };

    // optional fields only if your model has them
    if (allow.has('userAgent')) data.userAgent = (req?.headers?.['user-agent'] || '').toString();
    if (allow.has('entity'))     data.entity = entity ?? null;
    if (allow.has('entityId'))   data.entityId = entityId != null ? String(entityId) : null;
    if (allow.has('meta'))       data.meta = meta ?? null;
    if (allow.has('before'))     data.before = redact(before, redactions);
    if (allow.has('after'))      data.after = redact(after, redactions);

    // guard unknown keys (avoid SQL column errors)
    const payload = {};
    for (const k of Object.keys(data)) if (allow.has(k)) payload[k] = data[k];

    // Always keep required basics even if rawAttributes missing (common keys)
    if (allow.has('category')) payload.category = data.category;
    if (allow.has('action'))   payload.action   = data.action;
    if (allow.has('message'))  payload.message  = data.message;
    if (allow.has('ip'))       payload.ip       = data.ip;
    if (allow.has('userId'))   payload.userId   = data.userId ?? null;
    if (allow.has('branchId')) payload.branchId = data.branchId ?? null;

    await AuditLog.create(payload);
  } catch {
    // Never break primary flow for audit issues.
  }
}

/** Back-compat alias matching your existing calls. */
async function writeAudit({ req, category = 'system', action, message = '' } = {}) {
  return logAudit({ req, category, action, message });
}

module.exports = { logAudit, writeAudit, redact };
