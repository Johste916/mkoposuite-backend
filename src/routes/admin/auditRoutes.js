'use strict';

const express = require('express');
const router = express.Router();
const { Op, fn, col, where: sqlWhere, literal } = require('sequelize');

/* --------- Auth (soft) ---------- */
let auth = {};
try { auth = require('../../middleware/authMiddleware'); } catch {}
const authenticateUser = auth.authenticateUser || ((_req, _res, next) => next());
const requireAuth      = auth.requireAuth      || ((_req, _res, next) => next());
const authorizeRoles   = auth.authorizeRoles   || (() => ((_req, _res, next) => next()));

/* --------- Models (soft) -------- */
let models = null;
try { models = require('../../models'); } catch {}
const AuditLog = models?.AuditLog;
const User     = models?.User;
const Branch   = models?.Branch;

router.use(authenticateUser, requireAuth, authorizeRoles('admin', 'director', 'super_admin', 'system_admin', 'developer'));

/* --------------- helpers --------------- */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const toDate = (v) => (v ? new Date(v) : null);
const likeOp = (models?.sequelize?.getDialect?.() === 'postgres' ? Op.iLike : Op.like);

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
  const term = (q || '').toString().trim();
  if (term) {
    const pat = `%${term}%`;
    where[Op.or] = [
      sqlWhere(fn('LOWER', fn('COALESCE', col('message'), '')), likeOp, pat.toLowerCase()),
      { action:   { [likeOp]: pat } },
      { category: { [likeOp]: pat } },
      { ip:       { [likeOp]: pat } },
    ];
  }
  return where;
}

/* ---------------------- LIST ---------------------- */
/** GET /admin/audit?q=&userId=&branchId=&category=&action=&from=&to=&limit=&offset= */
router.get('/', async (req, res) => {
  if (!AuditLog?.findAndCountAll) return res.json({ items: [], total: 0 });

  try {
    const limit  = clamp(Number(req.query.limit ?? 100), 1, 500);
    const offset = clamp(Number(req.query.offset ?? 0), 0, 50_000);

    const where = buildWhere(req.query);

    const rows = await AuditLog.findAndCountAll({
      where,
      include: [
        User   ? { model: User,   attributes: ['id', 'name', 'email'], required: false } : null,
        Branch ? { model: Branch, attributes: ['id', 'name'], required: false } : null,
      ].filter(Boolean),
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return res.json({ items: rows.rows, total: rows.count });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to fetch audit logs' });
  }
});

/* -------------------- SUMMARY (portable) -------------------- */
/** GET /admin/audit/summary */
router.get('/summary', async (_req, res) => {
  if (!AuditLog?.findAll) {
    return res.json({
      totals: { all: 0, create: 0, update: 0, delete: 0, loginSuccess: 0, loginFailed: 0 },
      byDay: [], byCategory: [], topActors: []
    });
  }

  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    // totals by action
    const allRows = await AuditLog.findAll({ where: { createdAt: { [Op.gte]: since } }, attributes: ['action'] });
    const countBy = (a) => allRows.filter(r => (r.action || '') === a).length;
    const totals = {
      all: allRows.length,
      create: countBy('create'),
      update: countBy('update'),
      delete: countBy('delete'),
      loginSuccess: countBy('login:success'),
      loginFailed: countBy('login:failed'),
    };

    // last 7 days by day
    const seven = new Date(Date.now() - 6 * 24 * 3600 * 1000);
    const recent = await AuditLog.findAll({
      where: { createdAt: { [Op.gte]: seven } },
      attributes: ['id', 'createdAt'],
      order: [['createdAt', 'ASC']],
    });
    const byDayMap = new Map();
    for (let i = 0; i < 7; i++) {
      const d = new Date(seven.getFullYear(), seven.getMonth(), seven.getDate() + i);
      const key = d.toISOString().slice(0,10);
      byDayMap.set(key, 0);
    }
    recent.forEach(r => {
      const key = new Date(r.createdAt).toISOString().slice(0,10);
      byDayMap.set(key, (byDayMap.get(key) || 0) + 1);
    });
    const byDay = [...byDayMap.entries()].map(([date, count]) => ({ date, count }));

    // by category
    const cats = await AuditLog.findAll({
      where: { createdAt: { [Op.gte]: since } },
      attributes: ['category', [fn('COUNT', col('id')), 'count']],
      group: ['category'],
      order: [[literal('count'), 'DESC']],
      limit: 12,
      raw: true,
    });
    const byCategory = cats.map(c => ({ category: c.category || '(none)', count: Number(c.count) || 0 }));

    // top actors
    const actors = await AuditLog.findAll({
      where: { createdAt: { [Op.gte]: since } },
      attributes: ['userId', [fn('COUNT', col('id')), 'count']],
      group: ['userId'],
      order: [[literal('count'), 'DESC']],
      limit: 10,
      raw: true,
    });
    const topActors = actors.map(a => ({ userId: a.userId, count: Number(a.count) || 0 }));

    return res.json({ totals, byDay, byCategory, topActors });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to build summary' });
  }
});

/* -------------------- FEED (latest N) -------------------- */
/** GET /admin/audit/feed?limit=20 */
router.get('/feed', async (req, res) => {
  if (!AuditLog?.findAll) return res.json({ items: [] });

  try {
    const limit = clamp(Number(req.query.limit ?? 20), 1, 100);
    const items = await AuditLog.findAll({
      order: [['createdAt', 'DESC']],
      limit,
      attributes: ['id', 'userId', 'branchId', 'category', 'action', 'message', 'ip', 'reversed', 'createdAt'],
    });
    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to load feed' });
  }
});

/* -------------------- STREAM (SSE) -------------------- */
/** GET /admin/audit/stream – lightweight SSE that polls every 5s */
router.get('/stream', async (req, res) => {
  if (!AuditLog?.findAll) return res.status(400).json({ error: 'AuditLog not available' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  let closed = false;
  req.on('close', () => { closed = true; });

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // initial push
  try {
    const items = await AuditLog.findAll({
      order: [['createdAt', 'DESC']],
      limit: 20,
      attributes: ['id', 'userId', 'branchId', 'category', 'action', 'message', 'ip', 'createdAt'],
    });
    send('init', { items });
  } catch {
    send('error', { message: 'init failed' });
  }

  // poll every 5s for latest
  let lastTs = Date.now();
  const timer = setInterval(async () => {
    if (closed) { clearInterval(timer); return; }
    try {
      const since = new Date(lastTs - 1000);
      const items = await AuditLog.findAll({
        where: { createdAt: { [Op.gt]: since } },
        order: [['createdAt', 'ASC']],
        attributes: ['id', 'userId', 'branchId', 'category', 'action', 'message', 'ip', 'createdAt'],
      });
      if (items.length) {
        lastTs = Date.now();
        send('append', { items });
      } else {
        // heartbeat
        res.write(': keep-alive\n\n');
      }
    } catch {
      // silent
    }
  }, 5000);
});

module.exports = router;
