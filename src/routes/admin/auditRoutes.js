// backend/src/routes/admin/auditRoutes.js
"use strict";

const express = require("express");
const router = express.Router();
const { Op, literal } = require("sequelize");

/* ---- Auth (soft) ---- */
let auth = {};
try { auth = require("../../middleware/authMiddleware"); } catch {}
const authenticateUser = auth.authenticateUser || ((_req, _res, next) => next());
const requireAuth      = auth.requireAuth      || ((_req, _res, next) => next());
const authorizeRoles   = auth.authorizeRoles   || (() => ((_req, _res, next) => next()));

/* ---- Models (soft) ---- */
let models = null;
try { models = require("../../models"); } catch {}
const sequelize = models?.sequelize;
const AuditLog  = models?.AuditLog;

router.use(
  authenticateUser,
  requireAuth,
  authorizeRoles("admin", "director", "super_admin", "system_admin", "developer")
);

/* ---- helpers ---- */
const clamp  = (n, a, b) => Math.max(a, Math.min(b, n));
const toDate = (v) => (v ? new Date(v) : null);
const likeOp = (sequelize?.getDialect?.() === "postgres" ? Op.iLike : Op.like);

function buildWhere(qs = {}) {
  const { q, userId, branchId, category, action, from, to } = qs;
  const where = {};
  if (userId)   where.userId   = userId;
  if (branchId) where.branchId = branchId;
  if (category) where.category = String(category);
  if (action)   where.action   = String(action);
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = toDate(from);
    if (to)   where.createdAt[Op.lte] = toDate(to);
  }
  const term = (q || "").toString().trim();
  if (term) {
    const pat = `%${term}%`;
    where[Op.or] = [
      { category: { [likeOp]: pat } },
      { action:   { [likeOp]: pat } },
      { ip:       { [likeOp]: pat } },
      { message:  { [likeOp]: pat } },
    ];
  }
  return where;
}

/* =========================================================
   LIST — with computed user/branch names via SQL subqueries
   (no fragile association aliases required)
   ========================================================= */
router.get("/", async (req, res) => {
  if (!AuditLog?.findAndCountAll || !sequelize) return res.json({ items: [], total: 0 });

  try {
    const limit  = clamp(Number(req.query.limit ?? 100), 1, 500);
    const offset = clamp(Number(req.query.offset ?? 0), 0, 50_000);
    const where  = buildWhere(req.query);

    // Basic fetch first
    const list = await AuditLog.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit, offset,
      raw: true,
      attributes: [
        "id", "userId", "branchId", "category", "action", "message", "ip", "reversed", "createdAt",
        // optional columns if exist (ignored by Sequelize if not there)
        "entity", "entityId", "meta"
      ].filter(Boolean)
    });

    const rows = list.rows;

    // Enrich names with one batched query to avoid N+1
    const userIds   = [...new Set(rows.map(r => r.userId).filter(Boolean))];
    const branchIds = [...new Set(rows.map(r => r.branchId).filter(Boolean))];

    let usersById = new Map();
    let branchesById = new Map();

    try {
      if (userIds.length) {
        const [uRows] = await sequelize.query(`
          SELECT id, COALESCE(name, '') AS name, COALESCE(email, '') AS email
          FROM "Users"
          WHERE id = ANY(:ids)
        `, { replacements: { ids: userIds } });
        usersById = new Map(uRows.map(u => [String(u.id), { name: u.name, email: u.email }]));
      }
    } catch {}
    try {
      if (branchIds.length) {
        const [bRows] = await sequelize.query(`
          SELECT id, name
          FROM branches
          WHERE id = ANY(:ids)
        `, { replacements: { ids: branchIds } });
        branchesById = new Map(bRows.map(b => [String(b.id), { name: b.name }]));
      }
    } catch {}

    const enriched = rows.map(r => ({
      ...r,
      userName:   usersById.get(String(r.userId))?.name   || null,
      userEmail:  usersById.get(String(r.userId))?.email  || null,
      branchName: branchesById.get(String(r.branchId))?.name || null,
    }));

    return res.json({ items: enriched, total: list.count });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to fetch audit logs" });
  }
});

/* ========= SUMMARY ========= */
router.get("/summary", async (_req, res) => {
  if (!AuditLog?.findAll) {
    return res.json({
      totals: { all: 0, create: 0, update: 0, delete: 0, loginSuccess: 0, loginFailed: 0 },
      byDay: [], byCategory: [], topActors: []
    });
  }
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const allRows = await AuditLog.findAll({
      where: { createdAt: { [Op.gte]: since } },
      attributes: ["action"],
      raw: true,
    });
    const count = (a) => allRows.filter(r => (r.action || "") === a).length;
    const totals = {
      all: allRows.length,
      create: count("create"),
      update: count("update"),
      delete: count("delete"),
      loginSuccess: count("login:success"),
      loginFailed: count("login:failed"),
    };

    const byCategory = await AuditLog.findAll({
      where: { createdAt: { [Op.gte]: since } },
      attributes: ["category", [literal("COUNT(id)"), "count"]],
      group: ["category"],
      order: [[literal("count"), "DESC"]],
      raw: true,
    }).then(rows => rows.map(r => ({ category: r.category || "(none)", count: Number(r.count) || 0 })));

    return res.json({ totals, byDay: [], byCategory, topActors: [] });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to build summary" });
  }
});

/* ========= FEED ========= */
router.get("/feed", async (req, res) => {
  if (!AuditLog?.findAll) return res.json({ items: [] });
  try {
    const limit = clamp(Number(req.query.limit ?? 20), 1, 100);
    const items = await AuditLog.findAll({
      order: [["createdAt", "DESC"]],
      limit,
      attributes: ["id","userId","branchId","category","action","message","ip","reversed","createdAt"],
      raw: true,
    });
    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to load feed" });
  }
});

/* ========= STREAM (SSE) ========= */
router.get("/stream", async (req, res) => {
  if (!AuditLog?.findAll) return res.status(400).json({ error: "AuditLog not available" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  let closed = false;
  req.on("close", () => { closed = true; });

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const items = await AuditLog.findAll({
      order: [["createdAt", "DESC"]],
      limit: 20,
      attributes: ["id","userId","branchId","category","action","message","ip","reversed","createdAt"],
      raw: true,
    });
    send("init", { items });
  } catch {
    send("error", { message: "init failed" });
  }

  let lastTs = Date.now();
  const timer = setInterval(async () => {
    if (closed) { clearInterval(timer); return; }
    try {
      const since = new Date(lastTs - 1000);
      const items = await AuditLog.findAll({
        where: { createdAt: { [Op.gt]: since } },
        order: [["createdAt", "ASC"]],
        attributes: ["id","userId","branchId","category","action","message","ip","reversed","createdAt"],
        raw: true,
      });
      if (items.length) {
        lastTs = Date.now();
        send("append", { items });
      } else {
        res.write(": keep-alive\n\n");
      }
    } catch {}
  }, 5000);
});

module.exports = router;
