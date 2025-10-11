'use strict';

const express = require('express');
const router = express.Router();
const { Sequelize } = require('sequelize');

let auth = {};
try { auth = require('../../middleware/authMiddleware'); } catch {}
const authenticateUser = auth.authenticateUser || ((_req,_res,next)=>next());
const requireAuth      = auth.requireAuth      || ((_req,_res,next)=>next());
const authorizeRoles   = auth.authorizeRoles   || (()=>((_req,_res,next)=>next()));

let models = null;
try { models = require('../../models'); } catch {}
const hasAudit = !!(models && models.AuditLog);

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const toDate = (v) => (v ? new Date(v) : null);

router.use(authenticateUser, requireAuth, authorizeRoles('admin','director','super_admin','system_admin','developer'));

/* ---------- LIST ---------- */
router.get('/', async (req, res) => {
  if (!hasAudit) return res.json({ items: [], total: 0 });

  const { q, userId, branchId, category, action, from, to } = req.query;
  const limit  = clamp(Number(req.query.limit ?? 100), 1, 500);
  const offset = clamp(Number(req.query.offset ?? 0), 0, 50_000);

  const where = {};
  if (userId)   where.user_id   = userId;
  if (branchId) where.branch_id = branchId;
  if (category) where.category  = category;
  if (action)   where.action    = action;
  if (from || to) where.created_at = {};
  if (from) where.created_at[Sequelize.Op.gte] = toDate(from);
  if (to)   where.created_at[Sequelize.Op.lte] = toDate(to);

  // text search
  const likeQ = q ? `%${String(q).toLowerCase()}%` : null;

  const sqlBase = `
    FROM "${models.AuditLog.getTableName()}" a
    LEFT JOIN "Users" u   ON a.user_id = u.id
    LEFT JOIN "branches" b ON a.branch_id = b.id
    WHERE 1=1
      ${where.user_id   ? 'AND a.user_id = :userId' : ''}
      ${where.branch_id ? 'AND a.branch_id = :branchId' : ''}
      ${where.category  ? 'AND LOWER(a.category) = LOWER(:category)' : ''}
      ${where.action    ? 'AND LOWER(a.action)   = LOWER(:action)'   : ''}
      ${where.created_at?.[Sequelize.Op.gte] ? 'AND a.created_at >= :from' : ''}
      ${where.created_at?.[Sequelize.Op.lte] ? 'AND a.created_at <= :to'   : ''}
      ${likeQ ? `AND (
        LOWER(COALESCE(a.message,'')) LIKE :q OR
        LOWER(COALESCE(a.category,'')) LIKE :q OR
        LOWER(COALESCE(a.action,''))   LIKE :q OR
        LOWER(COALESCE(a.entity,''))   LIKE :q OR
        LOWER(COALESCE(u.name,''))     LIKE :q OR
        LOWER(COALESCE(b.name,''))     LIKE :q
      )` : ''}
  `;

  const replacements = {
    userId, branchId, category, action,
    from: toDate(from), to: toDate(to), q: likeQ,
    limit, offset,
  };

  try {
    const [rows] = await models.sequelize.query(`
      SELECT a.id, a.user_id   AS "userId", a.branch_id AS "branchId",
             a.category, a.action, a.entity, a.entity_id AS "entityId",
             a.message, a.ip, a.user_agent AS "userAgent",
             a.before, a.after, a.meta, a.reversed,
             a.created_at AS "createdAt",
             COALESCE(u.name,'')  AS "userName",
             COALESCE(u.email,'') AS "userEmail",
             COALESCE(b.name,'')  AS "branchName"
      ${sqlBase}
      ORDER BY a.created_at DESC
      LIMIT :limit OFFSET :offset
    `, { replacements });

    const [[{ total } = { total: 0 }]] = await models.sequelize.query(
      `SELECT COUNT(*)::int AS total ${sqlBase}`, { replacements }
    );

    res.json({ items: rows, total });
  } catch (e) {
    console.error('audit list error:', e);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

/* ---------- SUMMARY ---------- */
router.get('/summary', async (_req, res) => {
  if (!hasAudit) {
    return res.json({
      totals: { all: 0, create: 0, update: 0, delete: 0, loginSuccess: 0, loginFailed: 0 },
      byDay: [], byCategory: [], topActors: []
    });
  }
  try {
    const t = models.AuditLog.getTableName();

    const [totals] = await models.sequelize.query(`
      WITH base AS (SELECT action FROM "${t}" WHERE created_at >= NOW() - INTERVAL '30 days')
      SELECT
        (SELECT COUNT(*) FROM base) AS all,
        (SELECT COUNT(*) FROM base WHERE action = 'create') AS create,
        (SELECT COUNT(*) FROM base WHERE action = 'update') AS update,
        (SELECT COUNT(*) FROM base WHERE action = 'delete') AS delete,
        (SELECT COUNT(*) FROM base WHERE action = 'login:success') AS "loginSuccess",
        (SELECT COUNT(*) FROM base WHERE action = 'login:failed')  AS "loginFailed"
    `);

    const [byDay] = await models.sequelize.query(`
      SELECT TO_CHAR(d::date,'YYYY-MM-DD') AS date, COUNT(a.id)::int AS count
      FROM generate_series((CURRENT_DATE - INTERVAL '6 days')::date, CURRENT_DATE::date, '1 day') d
      LEFT JOIN "${t}" a ON a.created_at::date = d::date
      GROUP BY d ORDER BY d
    `);

    const [byCategory] = await models.sequelize.query(`
      SELECT COALESCE(category,'(none)') AS category, COUNT(*)::int AS count
      FROM "${t}"
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY category ORDER BY count DESC LIMIT 12
    `);

    const [topActors] = await models.sequelize.query(`
      SELECT user_id AS "userId", COUNT(*)::int AS count
      FROM "${t}"
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY user_id ORDER BY count DESC LIMIT 10
    `);

    res.json({ totals: totals?.[0] || {}, byDay, byCategory, topActors });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute summary' });
  }
});

/* ---------- FEED (latest N) ---------- */
router.get('/feed', async (req, res) => {
  if (!hasAudit) return res.json({ items: [] });
  try {
    const limit = clamp(Number(req.query.limit ?? 20), 1, 100);
    const t = models.AuditLog.getTableName();
    const [rows] = await models.sequelize.query(`
      SELECT id, user_id AS "userId", branch_id AS "branchId",
             category, action, entity, entity_id AS "entityId",
             message, ip, created_at AS "createdAt"
      FROM "${t}" ORDER BY created_at DESC LIMIT :limit
    `, { replacements: { limit } });
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

/* ---------- CSV EXPORT ---------- */
router.get('/export.csv', async (req, res) => {
  req.query.limit = 5000; // cap
  const { items } = (await (await fetchLike(req, '/'))).json || { items: [] };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="audit.csv"');
  const header = [
    'createdAt','userId','userName','userEmail','branchId','branchName',
    'category','action','entity','entityId','ip','message'
  ];
  const esc = (s) => `"${String(s ?? '').replace(/"/g,'""')}"`;
  res.write(header.join(',') + '\n');
  items.forEach(r => {
    res.write([
      r.createdAt, r.userId, r.userName, r.userEmail, r.branchId, r.branchName,
      r.category, r.action, r.entity, r.entityId, r.ip, (r.message||'').slice(0,500)
    ].map(esc).join(',') + '\n');
  });
  res.end();

  async function fetchLike(req0, path) {
    // reuse the list handler internally
    const mock = { ...req0, url: path, query: req0.query, method: 'GET' };
    return { json: await new Promise((resolve) => {
      const res0 = { json: (x)=>resolve(x), status: ()=>res0, setHeader: ()=>{}, end: ()=>{} };
      router.handle(mock, res0, ()=>{});
    }) };
  }
});

/* ---------- LIVE SSE STREAM ---------- */
router.get('/stream', async (req, res) => {
  if (!hasAudit) return res.status(501).end();
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders();

  let lastId = null;
  const t = models.AuditLog.getTableName();

  const tick = async () => {
    const [rows] = await models.sequelize.query(`
      SELECT id, created_at AS "createdAt", category, action, message
      FROM "${t}"
      ${lastId ? 'WHERE id > :lastId' : ''}
      ORDER BY id ASC LIMIT 100
    `, { replacements: { lastId } });
    rows.forEach(r => {
      lastId = r.id;
      res.write(`id: ${r.id}\n`);
      res.write(`event: audit\n`);
      res.write(`data: ${JSON.stringify(r)}\n\n`);
    });
  };

  const iv = setInterval(tick, 1500);
  req.on('close', () => clearInterval(iv));
});
module.exports = router;
