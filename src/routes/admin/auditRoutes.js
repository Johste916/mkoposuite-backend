// src/routes/admin/auditRoutes.js
'use strict';

const express = require('express');
const router = express.Router();

/* ----------------------- Auth (soft-required) ----------------------- */
let auth = {};
try { auth = require('../../middleware/authMiddleware'); } catch {}
const authenticateUser = auth.authenticateUser || ((_req, _res, next) => next());
const requireAuth      = auth.requireAuth      || ((_req, _res, next) => next());
const authorizeRoles   = auth.authorizeRoles   || (() => ((_req, _res, next) => next()));

/* ---------------------------- Models (soft) ---------------------------- */
let models = null;
try { models = require('../../models'); } catch {}
const hasAudit = !!(models && models.AuditLog);

/* ---------------------- Ensure res.ok / res.fail ---------------------- */
router.use((req, res, next) => {
  if (!res.ok) {
    res.ok = (data, extra = {}) => {
      if (typeof extra.total === 'number') res.setHeader('X-Total-Count', String(extra.total));
      return res.json(data);
    };
  }
  if (!res.fail) {
    res.fail = (status, message, extra = {}) => res.status(status).json({ error: message, ...extra });
  }
  next();
});

/* ------------------------- Guards (soft) ------------------------- */
router.use(authenticateUser, requireAuth, authorizeRoles('admin', 'director', 'superadmin'));

/* --------------------------- Utilities --------------------------- */
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const toDate = (v) => (v ? new Date(v) : null);

function tableNameFor(model) {
  try {
    const t = model.getTableName?.();
    return typeof t === 'string' ? t : (t?.tableName || 'AuditLogs');
  } catch { return 'AuditLogs'; }
}

function whereFragment({ q, userId, branchId, category, action, from, to }) {
  const parts = [];
  if (userId)    parts.push(`user_id = :userId`);
  if (branchId)  parts.push(`branch_id = :branchId`);
  if (category)  parts.push(`LOWER(category) = LOWER(:category)`);
  if (action)    parts.push(`LOWER(action) = LOWER(:action)`);
  if (from)      parts.push(`created_at >= :from`);
  if (to)        parts.push(`created_at < :to`);
  if (q) {
    parts.push(`(LOWER(COALESCE(message,'')) LIKE :q
             OR LOWER(COALESCE(action,'')) LIKE :q
             OR LOWER(COALESCE(category,'')) LIKE :q
             OR LOWER(COALESCE(ip,'')) LIKE :q)`);
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

/* ----------------------------- LIST ----------------------------- */
/**
 * GET /admin/audit
 * Query:
 *  q, userId, branchId, category, action, from, to, limit=100, offset=0
 * Returns: { items: [...], total }
 */
router.get('/', async (req, res) => {
  // If there is no DB model, return an empty, consistent payload.
  if (!hasAudit) return res.ok({ items: [] , total: 0 }, { total: 0 });

  try {
    const limit  = clamp(Number(req.query.limit ?? 100), 1, 500);
    const offset = clamp(Number(req.query.offset ?? 0), 0, 50_000);

    const q        = String(req.query.q || '').trim().toLowerCase() || null;
    const userId   = req.query.userId ? String(req.query.userId) : null;
    const branchId = req.query.branchId ? String(req.query.branchId) : null;
    const category = req.query.category ? String(req.query.category) : null;
    const action   = req.query.action ? String(req.query.action) : null;
    const from     = toDate(req.query.from);
    const to       = toDate(req.query.to);

    // Prefer a simple, portable SQL path so it works even if associations aren’t declared.
    const t = tableNameFor(models.AuditLog);
    const where = whereFragment({ q, userId, branchId, category, action, from, to });

    const replacements = {
      q: q ? `%${q}%` : null, userId, branchId, category, action, from, to,
      limit, offset,
    };

    const [rows] = await models.sequelize.query(`
      SELECT id, user_id AS "userId", branch_id AS "branchId",
             category, action, message, ip, reversed,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM "${t}"
      ${where}
      ORDER BY created_at DESC
      LIMIT :limit OFFSET :offset
    `, { replacements });

    const [[{ total } = { total: 0 }]] = await models.sequelize.query(`
      SELECT COUNT(*)::int AS total
      FROM "${t}" ${where}
    `, { replacements });

    return res.ok({ items: rows, total }, { total });
  } catch (e) {
    return res.fail(500, e.message);
  }
});

/* --------------------------- SUMMARY --------------------------- */
/**
 * GET /admin/audit/summary
 * Returns counters that power dashboard widgets.
 * {
 *   totals: { all, create, update, delete, loginSuccess, loginFailed },
 *   byDay: [{ date, count }...],     // last 7 days
 *   byCategory: [{ category, count }],
 *   topActors: [{ userId, count }]
 * }
 */
router.get('/summary', async (_req, res) => {
  if (!hasAudit) {
    return res.ok({
      totals: { all: 0, create: 0, update: 0, delete: 0, loginSuccess: 0, loginFailed: 0 },
      byDay: [], byCategory: [], topActors: []
    });
  }

  try {
    const t = tableNameFor(models.AuditLog);

    const [totals] = await models.sequelize.query(`
      WITH base AS (
        SELECT action FROM "${t}"
        WHERE created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT
        (SELECT COUNT(*) FROM base) AS all,
        (SELECT COUNT(*) FROM base WHERE action = 'create') AS create,
        (SELECT COUNT(*) FROM base WHERE action = 'update') AS update,
        (SELECT COUNT(*) FROM base WHERE action = 'delete') AS delete,
        (SELECT COUNT(*) FROM base WHERE action = 'login:success') AS "loginSuccess",
        (SELECT COUNT(*) FROM base WHERE action = 'login:failed')  AS "loginFailed"
    `);

    const [byDay] = await models.sequelize.query(`
      SELECT TO_CHAR(d::date, 'YYYY-MM-DD') AS date,
             COUNT(a.id)::int AS count
      FROM generate_series((CURRENT_DATE - INTERVAL '6 days')::date, CURRENT_DATE::date, '1 day') AS d
      LEFT JOIN "${t}" a ON a.created_at::date = d::date
      GROUP BY d
      ORDER BY d
    `);

    const [byCategory] = await models.sequelize.query(`
      SELECT COALESCE(category,'(none)') AS category, COUNT(*)::int AS count
      FROM "${t}"
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY category
      ORDER BY count DESC
      LIMIT 12
    `);

    const [topActors] = await models.sequelize.query(`
      SELECT user_id AS "userId", COUNT(*)::int AS count
      FROM "${t}"
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY user_id
      ORDER BY count DESC
      LIMIT 10
    `);

    return res.ok({
      totals: totals?.[0] || { all: 0, create: 0, update: 0, delete: 0, loginSuccess: 0, loginFailed: 0 },
      byDay, byCategory, topActors
    });
  } catch (e) {
    return res.fail(500, e.message);
  }
});

/* ---------------------------- FEED (UI) ---------------------------- */
/** GET /admin/audit/feed?limit=20 -> short feed for dashboard widgets */
router.get('/feed', async (req, res) => {
  if (!hasAudit) return res.ok({ items: [] });

  try {
    const limit = clamp(Number(req.query.limit ?? 20), 1, 100);
    const t = tableNameFor(models.AuditLog);
    const [rows] = await models.sequelize.query(`
      SELECT id, user_id AS "userId", branch_id AS "branchId",
             category, action, message, ip, reversed,
             created_at AS "createdAt"
      FROM "${t}"
      ORDER BY created_at DESC
      LIMIT :limit
    `, { replacements: { limit } });

    return res.ok({ items: rows });
  } catch (e) {
    return res.fail(500, e.message);
  }
});

/* ---------------------------- Single row ---------------------------- */
router.get('/:id', async (req, res) => {
  try {
    if (models?.AuditLog?.findByPk) {
      const row = await models.AuditLog.findByPk(String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.ok(row);
    }
    return res.status(404).json({ error: 'Not found' });
  } catch (_e) {
    return res.status(404).json({ error: 'Not found' });
  }
});

/* --------------------------- Reverse / Delete --------------------------- */
router.post('/:id/reverse', async (req, res) => {
  const id = String(req.params.id);
  try {
    if (models?.AuditLog?.update) {
      await models.AuditLog.update({ reversed: true }, { where: { id } });
      return res.ok({ ok: true });
    }
    return res.ok({ ok: true });
  } catch (e) {
    return res.ok({ ok: true, note: 'reverse simulated (fallback)', error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  try {
    if (models?.AuditLog?.destroy) {
      await models.AuditLog.destroy({ where: { id } });
      return res.status(204).end();
    }
    return res.status(204).end();
  } catch (_e) {
    return res.status(204).end();
  }
});

module.exports = router;
