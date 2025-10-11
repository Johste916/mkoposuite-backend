// backend/src/utils/audit.js
"use strict";

/**
 * Lightweight, safe audit writer.
 * - Never references non-existent columns.
 * - Produces a human readable message when one isn’t supplied.
 * - Stores small request meta (ua, method, path, status, tenant ctx if available).
 * - Accepts optional entity/entityId/before/after/meta (they’re ignored by DB if
 *   those columns don’t exist – code won’t crash).
 */

let models = null;
try { models = require("../models"); } catch {}
const AuditLog = models?.AuditLog;

/* ------- helpers ------- */
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o?.[k]]));
const safeJson = (x) => {
  try { return JSON.stringify(x); } catch { return String(x ?? ""); }
};
const guessCategory = (path = "") => {
  const p = (path || "").toLowerCase();
  if (p.startsWith("/api/auth")) return "auth";
  if (p.startsWith("/api/users") || p.includes("/users")) return "users";
  if (p.includes("/loans")) return "loans";
  if (p.includes("/repay")) return "repayments";
  if (p.includes("/roles") || p.includes("/permissions")) return "permissions";
  if (p.includes("/branches")) return "branches";
  return "system";
};
const guessAction = (method = "", statusCode = 200, path = "") => {
  const m = (method || "").toUpperCase();
  if (m === "POST")   return "create";
  if (m === "PUT" || m === "PATCH") return "update";
  if (m === "DELETE") return "delete";
  if (m === "GET" && path.includes("/login") && statusCode >= 200 && statusCode < 300) return "login:success";
  if (m === "GET" && path.includes("/login") && statusCode >= 400) return "login:failed";
  return m.toLowerCase();
};
const humanFromReq = (req, fallback="") => {
  const method = req?.method || "";
  const path   = req?.originalUrl || req?.path || "";
  const status = resStatusGuess(req);
  return `${method} ${path} • ${status}`;
};
const resStatusGuess = (req) => {
  // If you attach res.locals.status in a response middleware, use that.
  return req?.res?.statusCode ?? 0;
};

async function writeAudit({
  req,
  category,
  action,
  entity,
  entityId,
  message,
  before = null,
  after  = null,
  meta   = null,
}) {
  try {
    if (!AuditLog?.create) return;

    const method = req?.method;
    const path   = req?.originalUrl || req?.path;
    const status = resStatusGuess(req);

    const final = {
      userId:   req?.user?.id || null,
      branchId: req?.user?.branchId || null,
      ip:       req?.ip || null,

      category: category || guessCategory(path),
      action:   action   || guessAction(method, status, path),

      // Store a friendly, short message (keep original string if caller supplied).
      message:  message || humanFromReq(req),

      // These keys will be silently ignored if the DB doesn’t have those columns.
      entity:   entity   || null,
      entityId: entityId || null,

      // Persist small meta (as TEXT when JSONB isn’t available; model ignores extras)
      // so the UI can render “Meta” panel even without before/after.
      // When meta is object, stringify it; when string, keep it.
      meta: typeof meta === "string" ? meta : safeJson(meta || {
        method, path, statusCode: status,
        ua: req?.headers?.["user-agent"],
        ctx: req?.tenant || req?.context || pick(req?.user, ["tenantId","branchId"]),
      }),

      // Keep these in memory; DB will drop if no columns exist.
      before: before ? safeJson(before) : null,
      after:  after  ? safeJson(after)  : null,
    };

    await AuditLog.create(final);
  } catch (e) {
    // Do not crash app on audit failure
    console.warn("writeAudit() skipped:", e?.message || e);
  }
}

module.exports = { writeAudit };
