'use strict';
const express = require('express');
const router = express.Router();

let db = {};
try { db = require('../models'); } catch {}
const { sequelize } = db;

// QueryTypes
const SequelizePkg = (() => { try { return require('sequelize'); } catch { return null; } })();
const QT =
  (db && db.Sequelize && db.Sequelize.QueryTypes) ||
  (SequelizePkg && SequelizePkg.QueryTypes) ||
  { SELECT: 'SELECT', UPDATE: 'UPDATE', INSERT: 'INSERT', BULKDELETE: 'BULKDELETE' };

const { Op } = SequelizePkg || { Op: {} };

const { allow } = (() => { try { return require('../middleware/permissions'); } catch { return {}; } })();
const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Unauthorized' }));

const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
};

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const getTenantId = (req) => req.headers['x-tenant-id'] || req.context?.tenantId || req.user?.tenantId || null;

const toIntOrNull = (v) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

const columnExists = async (table, column) => {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    { bind: [table, column], type: QT.SELECT }
  );
  return !!rows.length;
};

const tableExists = async (table) => {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    { bind: [table], type: QT.SELECT }
  );
  return !!rows.length;
};

/* ============================== LIST ============================== */
router.get(
  '/',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');

      const q = String(req.query.q || '').trim();
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const where = {};
      if (q && Op && Op.iLike) {
        where[Op.or] = [
          { name:  { [Op.iLike]: `%${q}%` } },
          { code:  { [Op.iLike]: `%${q}%` } },
          { phone: { [Op.iLike]: `%${q}%` } },
          { address: { [Op.iLike]: `%${q}%` } },
        ];
      }

      const tId = getTenantId(req);
      if (await columnExists('branches', 'tenant_id')) {
        const tNum = toIntOrNull(tId);
        if (tNum !== null) where.tenantId = tNum;
      }

      const { rows, count } = await Branch.findAndCountAll({
        where,
        order: [['name', 'ASC']],
        limit,
        offset,
      });

      res.setHeader('X-Total-Count', String(count));
      return res.json(rows);
    } catch (e) { next(e); }
  }
);

/* ============================== CREATE ============================ */
router.post(
  '/',
  requireAuth,
  allow ? allow('branches:manage') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const body = req.body || {};

      const payload = {
        name: (body.name || '').trim(),
        code: body.code == null ? null : String(body.code).trim(),
        phone: body.phone == null ? null : String(body.phone).trim(),
        address: body.address == null ? null : String(body.address).trim(),
      };
      if (!payload.name) return res.status(400).json({ error: 'name is required' });

      const tId = getTenantId(req);
      if (await columnExists('branches', 'tenant_id')) {
        const tNum = toIntOrNull(tId);
        if (tNum !== null) payload.tenantId = tNum;
      }

      const created = await Branch.create(payload);
      return res.status(201).json(created);
    } catch (e) { next(e); }
  }
);

/* ============================== READ ONE ========================== */
router.get(
  '/:id',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const id = toIntOrNull(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Branch id must be an integer' });

      const where = { id };
      const tId = getTenantId(req);
      if (await columnExists('branches', 'tenant_id')) {
        const tNum = toIntOrNull(tId);
        if (tNum !== null) where.tenantId = tNum;
      }

      const found = await Branch.findOne({ where });
      if (!found) return res.status(404).json({ error: 'Branch not found' });
      return res.json(found);
    } catch (e) { next(e); }
  }
);

/* ============================== UPDATE =========================== */
router.put(
  '/:id',
  requireAuth,
  allow ? allow('branches:manage') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const id = toIntOrNull(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Branch id must be an integer' });

      const where = { id };
      const tId = getTenantId(req);
      if (await columnExists('branches', 'tenant_id')) {
        const tNum = toIntOrNull(tId);
        if (tNum !== null) where.tenantId = tNum;
      }

      const found = await Branch.findOne({ where });
      if (!found) return res.status(404).json({ error: 'Branch not found' });

      const body = req.body || {};
      const updates = {};
      if (typeof body.name === 'string') updates.name = body.name.trim();
      if ('code' in body)    updates.code    = body.code == null ? null : String(body.code).trim();
      if ('phone' in body)   updates.phone   = body.phone == null ? null : String(body.phone).trim();
      if ('address' in body) updates.address = body.address == null ? null : String(body.address).trim();
      if ('managerId' in body) updates.managerId = body.managerId == null ? null : String(body.managerId);

      await found.update(updates);
      return res.json(found);
    } catch (e) { next(e); }
  }
);

/* ============================== DELETE (soft) ===================== */
router.delete(
  '/:id',
  requireAuth,
  allow ? allow('branches:manage') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const id = toIntOrNull(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Branch id must be an integer' });

      const where = { id };
      const tId = getTenantId(req);
      if (await columnExists('branches', 'tenant_id')) {
        const tNum = toIntOrNull(tId);
        if (tNum !== null) where.tenantId = tNum;
      }

      const found = await Branch.findOne({ where });
      if (!found) return res.status(404).json({ error: 'Branch not found' });

      await found.destroy(); // paranoid respected
      return res.status(204).end();
    } catch (e) { next(e); }
  }
);

/* ============================== REPORT =========================== */
router.get(
  '/:id/report',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const branchId = toIntOrNull(req.params.id);
      if (branchId === null) return res.status(400).json({ error: 'Branch id must be an integer' });

      const from = String(req.query.from || '').trim() || null;
      const to   = String(req.query.to || '').trim()   || null;

      const dateFilter = (col) => {
        if (from && to)   return ` AND ${col} >= $2::date AND ${col} < ($3::date + INTERVAL '1 day') `;
        if (from && !to)  return ` AND ${col} >= $2::date `;
        if (!from && to)  return ` AND ${col} < ($2::date + INTERVAL '1 day') `;
        return '';
      };
      const bindFor = (...rest) => [branchId, ...rest.filter(Boolean)];

      const q = async (sql, bind = []) => {
        try { return await sequelize.query(sql, { bind, type: QT.SELECT }); }
        catch { return null; }
      };

      const staff = await q(
        `SELECT COUNT(*)::int AS count FROM public.user_branches ub WHERE ub.branch_id = $1`,
        [branchId]
      );

      const expenses = await q(
        `
        SELECT COALESCE(SUM(e.amount),0)::numeric AS amount
        FROM public.expenses e
        WHERE e."branchId" = $1
        ${dateFilter('e."createdAt"')}
        `,
        from && to ? bindFor(from, to) : from ? bindFor(from) : to ? bindFor(to) : [branchId]
      );

      const loansOut = await q(
        `
        SELECT COALESCE(SUM(l."principalDisbursed"),0)::numeric AS amount
        FROM public."Loans" l
        WHERE l."branchId" = $1
        ${dateFilter('l."createdAt"')}
        `,
        from && to ? bindFor(from, to) : from ? bindFor(from) : to ? bindFor(to) : [branchId]
      );

      let collections = await q(
        `
        SELECT COALESCE(SUM(lp.amount),0)::numeric AS amount
        FROM public."LoanPayments" lp
        JOIN public."Loans" l ON l.id = lp."loanId"
        WHERE l."branchId" = $1
        ${dateFilter('lp."createdAt"')}
        `,
        from && to ? bindFor(from, to) : from ? bindFor(from) : to ? bindFor(to) : [branchId]
      );
      if (!collections || collections.length === 0) {
        collections = await q(
          `
          SELECT COALESCE(SUM(lr.amount),0)::numeric AS amount
          FROM public."LoanRepayments" lr
          JOIN public."Loans" l ON l.id = lr."loanId"
          WHERE l."branchId" = $1
          ${dateFilter('lr."createdAt"')}
          `,
          from && to ? bindFor(from, to) : from ? bindFor(from) : to ? bindFor(to) : [branchId]
        );
      }

      return res.json({
        kpis: {
          staffCount:  staff?.[0]?.count ?? 0,
          expenses:    expenses?.[0]?.amount ?? 0,
          loansOut:    loansOut?.[0]?.amount ?? 0,
          collections: collections?.[0]?.amount ?? 0,
        },
      });
    } catch (e) { next(e); }
  }
);

/* ============================== OVERVIEW ========================== */
router.get(
  '/:id/overview',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    const branchId = toIntOrNull(req.params.id);
    if (branchId === null) return res.status(400).json({ error: 'Branch id must be an integer' });

    const q = async (sql, bind = []) => {
      try { return await sequelize.query(sql, { bind, type: QT.SELECT }); }
      catch { return null; }
    };

    try {
      const header = await q(`
        SELECT b.id, b.name, b.code,
               COALESCE(b.phone, NULL)   AS phone,
               COALESCE(b.address, NULL) AS address,
               b.created_at              AS "createdAt",
               NULLIF(b.manager, '')     AS "managerId",
               CASE WHEN EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='branches' AND column_name='tenant_id'
               ) THEN (SELECT b.tenant_id) ELSE NULL END AS tenant_id
        FROM public.branches b
        WHERE b.id = $1
        LIMIT 1
      `, [branchId]);

      if (!header || !header[0]) return res.status(404).json({ error: 'Branch not found' });

      const staff = await q(`
        SELECT COUNT(*)::int AS count
        FROM public.user_branches ub
        WHERE ub.branch_id = $1
      `, [branchId]);

      const borrowers = await q(`
        SELECT COUNT(*)::int AS count
        FROM public."Borrowers" bo
        WHERE bo."branchId" = $1
      `, [branchId]);

      const loans = await q(`
        SELECT COUNT(*)::int AS total
        FROM public."Loans" l
        WHERE l."branchId" = $1
      `, [branchId]);

      let outstanding = null;
      try {
        const out = await sequelize.query(`
          SELECT COALESCE(SUM(l."principalOutstanding"),0)::numeric AS outstanding
          FROM public."Loans" l
          WHERE l."branchId" = $1
        `, { bind: [branchId], type: QT.SELECT });
        outstanding = out?.[0]?.outstanding ?? null;
      } catch {}

      let collections30 = await q(`
        SELECT COALESCE(SUM(lp.amount),0)::numeric AS amount
        FROM public."LoanPayments" lp
        JOIN public."Loans" l ON l.id = lp."loanId"
        WHERE l."branchId" = $1
          AND lp."createdAt" >= (NOW() - INTERVAL '30 days')
      `, [branchId]) || await q(`
        SELECT COALESCE(SUM(lr.amount),0)::numeric AS amount
        FROM public."LoanRepayments" lr
        JOIN public."Loans" l ON l.id = lr."loanId"
        WHERE l."branchId" = $1
          AND lr."createdAt" >= (NOW() - INTERVAL '30 days')
      `, [branchId]);

      const expenses = await q(`
        SELECT COALESCE(SUM(e.amount),0)::numeric AS amount
        FROM public.expenses e
        WHERE e."branchId" = $1
          AND date_trunc('month', e."createdAt") = date_trunc('month', CURRENT_DATE)
      `, [branchId]);

      const savings = await q(`
        SELECT
          COALESCE(SUM(CASE WHEN st.type ILIKE 'deposit%'  THEN st.amount ELSE 0 END),0)::numeric AS deposits,
          COALESCE(SUM(CASE WHEN st.type ILIKE 'withdraw%' THEN st.amount ELSE 0 END),0)::numeric AS withdrawals
        FROM public.savingstransactions st
        JOIN public."Borrowers" bo ON bo.id = st."borrowerId"
        WHERE bo."branchId" = $1
          AND date_trunc('month', st."createdAt") = date_trunc('month', CURRENT_DATE)
      `, [branchId]);

      return res.json({
        branch: {
          id: header[0].id,
          name: header[0].name,
          code: header[0].code,
          phone: header[0].phone,
          address: header[0].address,
          createdAt: header[0].createdAt,
          tenantId: header[0].tenant_id || null,
        },
        kpis: {
          staffCount: staff?.[0]?.count ?? 0,
          borrowers: borrowers?.[0]?.count ?? 0,
          loans: {
            total: loans?.[0]?.total ?? 0,
            outstanding: outstanding,
          },
          collections: { last30Days: collections30?.[0]?.amount ?? null },
          expenses: { thisMonth: expenses?.[0]?.amount ?? null },
          savings: savings ? {
            depositsThisMonth: savings?.[0]?.deposits ?? null,
            withdrawalsThisMonth: savings?.[0]?.withdrawals ?? null,
          } : null,
        },
      });
    } catch (e) { return next(e); }
  }
);

/* ============================== ASSIGN STAFF =============================== */
router.post(
  '/:id/assign-staff',
  requireAuth,
  allow ? allow('branches:assign') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const branchId = toIntOrNull(req.params.id);
      if (branchId === null) return res.status(400).json({ error: 'Branch id must be an integer' });

      const raw = req.body?.userIds;
      const userIds = Array.isArray(raw) ? raw.filter(Boolean) : [];
      if (userIds.length === 0) return res.status(400).json({ error: 'userIds[] required (UUIDs)' });

      const invalid = userIds.filter((id) => !isUuid(id));
      if (invalid.length) {
        return res.status(400).json({ error: 'All userIds must be UUID strings', details: { invalid } });
      }

      const Branch = getModel('Branch');
      const branch = await Branch.findOne({ where: { id: branchId } });
      if (!branch) return res.status(404).json({ error: 'Branch not found' });

      const conflicts = await sequelize.query(`
        SELECT ub.user_id AS "userId", ub.branch_id AS "branchId",
               b.name AS "branchName"
        FROM public.user_branches ub
        JOIN public.branches b ON b.id = ub.branch_id
        WHERE ub.user_id = ANY($1::uuid[])
          AND ub.branch_id <> $2::int
      `, { bind: [userIds, branchId], type: QT.SELECT });

      if (conflicts?.length) {
        return res.status(409).json({
          error: 'User(s) already assigned to another branch — unassign first.',
          conflicts: conflicts.map(c => ({
            userId: c.userId,
            currentBranchId: c.branchId,
            currentBranchName: c.branchName,
            unassignUrl: `/api/branches/${c.branchId}/staff/${c.userId}`,
          })),
        });
      }

      await sequelize.query(
        `
        INSERT INTO public.user_branches_rt (user_id, branch_id, created_at)
        SELECT uid, $2::int, NOW()
        FROM unnest($1::uuid[]) AS t(uid)
        ON CONFLICT (user_id, branch_id) DO NOTHING
        `,
        { bind: [userIds, branchId] }
      );

      res.json({ ok: true, assigned: userIds.length });
    } catch (e) {
      const code = e?.original?.code || e?.parent?.code;
      if (code === '22P02') return res.status(400).json({ error: 'Invalid ID type' });
      if (code === '42P01') return res.status(500).json({ error: 'Missing table/view; run migrations' });
      next(e);
    }
  }
);

/* ============================== UNASSIGN STAFF ============================= */
router.delete(
  '/:id/staff/:userId',
  requireAuth,
  allow ? allow('branches:assign') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const branchId = toIntOrNull(req.params.id);
      const userId = String(req.params.userId || '');
      if (branchId === null) return res.status(400).json({ error: 'Branch id must be an integer' });
      if (!isUuid(userId)) return res.status(400).json({ error: 'userId must be a UUID' });

      await sequelize.query(
        `DELETE FROM public.user_branches_rt WHERE user_id = $1::uuid AND branch_id = $2::int`,
        { bind: [userId, branchId], type: QT.BULKDELETE }
      );

      return res.json({ ok: true, removed: true });
    } catch (e) { next(e); }
  }
);

/* ============================== LIST STAFF (robust) ======================== */
router.get(
  '/:id/staff',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const branchId = toIntOrNull(req.params.id);
      if (branchId === null) return res.status(400).json({ error: 'Branch id must be an integer' });

      const usersTbl = (await tableExists('users')) ? 'users' : (await tableExists('Users')) ? '"Users"' : null;
      if (!usersTbl) return res.json({ items: [] });

      const rows = await sequelize.query(
        `
        SELECT u.id,
               COALESCE(u.name, (u."firstName" || ' ' || u."lastName")) AS name,
               u.email,
               u.role
        FROM public.user_branches ub
        JOIN public.${usersTbl} u ON u.id = ub.user_id
        WHERE ub.branch_id = $1
        ORDER BY name ASC
        `,
        { bind: [branchId], type: QT.SELECT }
      );

      res.json({ items: rows || [] });
    } catch (e) { next(e); }
  }
);

/* ============================== LIST BORROWERS (compact) =================== */
router.get(
  '/:id/borrowers',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const branchId = toIntOrNull(req.params.id);
      if (branchId === null) return res.status(400).json({ error: 'Branch id must be an integer' });

      const rows = await sequelize.query(
        `
        SELECT bo.id, bo.name, bo.phone,
               COALESCE((
                 SELECT COUNT(*) FROM public."Loans" l WHERE l."borrowerId" = bo.id
               ),0)::int AS loans
        FROM public."Borrowers" bo
        WHERE bo."branchId" = $1
        ORDER BY bo.name ASC
        `,
        { bind: [branchId], type: QT.SELECT }
      );

      res.json({ items: rows || [] });
    } catch (e) { next(e); }
  }
);

module.exports = router;
