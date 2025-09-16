// routes/branchRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

let db = {};
try { db = require('../models'); } catch {}
const { sequelize } = db;
const { Op } = require('sequelize');

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

/* … list/create/update/delete branches remain unchanged … */

/* ============================== BRANCH OVERVIEW ============================ */
/**
 * Additive overview that computes safe, read-only KPIs.
 * - Multi-tenant aware when tables expose tenant_id
 * - Skips sections that error (never breaks)
 */
router.get(
  '/:id/overview',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    const branchId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(branchId)) return res.status(400).json({ error: 'Branch id must be an integer' });

    const tId = getTenantId(req);

    const q = async (sql, bind = []) => {
      try { return await sequelize.query(sql, { bind, type: sequelize.QueryTypes.SELECT }); }
      catch { return null; }
    };

    try {
      // Header
      const header = await q(`
        SELECT b.id, b.name, b.code,
               COALESCE(b.phone, NULL)   AS phone,
               COALESCE(b.address, NULL) AS address,
               b.created_at              AS createdAt,
               NULLIF(b.manager, '')     AS managerId,
               CASE WHEN EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='branches' AND column_name='tenant_id'
               ) THEN (SELECT b.tenant_id) ELSE NULL END AS tenant_id
        FROM public.branches b
        WHERE b.id = $1
        LIMIT 1
      `, [branchId]);

      if (!header || !header[0]) return res.status(404).json({ error: 'Branch not found' });

      // Staff count (via VIEW)
      const staff = await q(`
        SELECT COUNT(*)::int AS count
        FROM public.user_branches ub
        WHERE ub.branch_id = $1
      `, [branchId]);

      // Borrowers
      const borrowers = await q(`
        SELECT COUNT(*)::int AS count
        FROM public."Borrowers" bo
        WHERE bo."branchId" = $1
      `, [branchId]);

      // Loans (safe counts; outstanding may not exist → try catch)
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
        `, { bind: [branchId], type: sequelize.QueryTypes.SELECT });
        outstanding = out?.[0]?.outstanding ?? null;
      } catch { /* field may not exist; skip */ }

      // Collections last 30d (LoanPayments or LoanRepayments)
      let collections30 = null;
      collections30 = await q(`
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

      // Expenses this month (optional)
      const expenses = await q(`
        SELECT COALESCE(SUM(e.amount),0)::numeric AS amount
        FROM public.expenses e
        WHERE e.branchId = $1
          AND date_trunc('month', e."createdAt") = date_trunc('month', CURRENT_DATE)
      `, [branchId]);

      // Savings in/out this month (optional)
      const savings = await q(`
        SELECT
          COALESCE(SUM(CASE WHEN st.type ILIKE 'deposit%'   THEN st.amount ELSE 0 END),0)::numeric AS deposits,
          COALESCE(SUM(CASE WHEN st.type ILIKE 'withdraw%'  THEN st.amount ELSE 0 END),0)::numeric AS withdrawals
        FROM public.savingstransactions st
        JOIN public."Borrowers" bo ON bo.id = st."borrowerId"
        WHERE bo."branchId" = $1
          AND date_trunc('month', st."createdAt") = date_trunc('month', CURRENT_DATE)
      `, [branchId]);

      // Response (skip nulls gracefully)
      return res.json({
        branch: {
          id: header[0].id,
          name: header[0].name,
          code: header[0].code,
          phone: header[0].phone,
          address: header[0].address,
          createdAt: header[0].createdat || header[0].createdAt,
          tenantId: header[0].tenant_id || null,
        },
        kpis: {
          staffCount: staff?.[0]?.count ?? 0,
          borrowers: borrowers?.[0]?.count ?? 0,
          loans: {
            total: loans?.[0]?.total ?? 0,
            outstanding: outstanding,
          },
          collections: {
            last30Days: collections30?.[0]?.amount ?? null,
          },
          expenses: {
            thisMonth: expenses?.[0]?.amount ?? null,
          },
          savings: savings ? {
            depositsThisMonth: savings?.[0]?.deposits ?? null,
            withdrawalsThisMonth: savings?.[0]?.withdrawals ?? null,
          } : null,
        },
      });
    } catch (e) {
      return next(e);
    }
  }
);

/* ============================== ASSIGN STAFF =============================== */
/** Enforces: one active branch per user until unassigned */
router.post(
  '/:id/assign-staff',
  requireAuth,
  allow ? allow('branches:assign') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const branchId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(branchId)) {
        return res.status(400).json({ error: 'Branch id must be an integer' });
      }

      const raw = req.body?.userIds;
      const userIds = Array.isArray(raw) ? raw.filter(Boolean) : [];
      if (userIds.length === 0) {
        return res.status(400).json({ error: 'userIds[] required (UUIDs)' });
      }

      const invalid = userIds.filter((id) => !isUuid(id));
      if (invalid.length) {
        return res.status(400).json({ error: 'All userIds must be UUID strings', details: { invalid } });
      }

      // Ensure branch exists (+ tenant id if present)
      const Branch = getModel('Branch');
      const branch = await Branch.findOne({ where: { id: branchId } });
      if (!branch) return res.status(404).json({ error: 'Branch not found' });

      // Conflict check: any user currently assigned to a different branch?
      // We use VIEW (user_branches) and join branches to retrieve name/tenant (tenant is optional)
      const conflicts = await sequelize.query(`
        SELECT ub.user_id AS "userId", ub.branch_id AS "branchId",
               b.name AS "branchName"
        FROM public.user_branches ub
        JOIN public.branches b ON b.id = ub.branch_id
        WHERE ub.user_id = ANY($1::uuid[])
          AND ub.branch_id <> $2::int
      `, { bind: [userIds, branchId], type: sequelize.QueryTypes.SELECT });

      if (conflicts && conflicts.length) {
        // Return first conflict, but list all for the client
        const first = conflicts[0];
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

      // Bulk insert: one statement → avoids 25P02 chains
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
      const branchId = parseInt(String(req.params.id), 10);
      const userId = String(req.params.userId || '');
      if (!Number.isFinite(branchId)) return res.status(400).json({ error: 'Branch id must be an integer' });
      if (!isUuid(userId)) return res.status(400).json({ error: 'userId must be a UUID' });

      const result = await sequelize.query(
        `DELETE FROM public.user_branches_rt WHERE user_id = $1::uuid AND branch_id = $2::int`,
        { bind: [userId, branchId], type: sequelize.QueryTypes.BULKDELETE }
      );

      return res.json({ ok: true, removed: (result?.[1] ?? 0) > 0 });
    } catch (e) { next(e); }
  }
);

/* ============================== LIST STAFF ================================= */
router.get(
  '/:id/staff',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const branchId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(branchId)) return res.status(400).json({ error: 'Branch id must be an integer' });

      const rows = await sequelize.query(
        `
        SELECT u.id,
               COALESCE(u.name, (u."firstName" || ' ' || u."lastName")) AS name,
               u.email,
               u.role
        FROM public.user_branches ub
        JOIN public.users u ON u.id = ub.user_id
        WHERE ub.branch_id = $1
        ORDER BY name ASC
        `,
        { bind: [branchId], type: sequelize.QueryTypes.SELECT }
      );

      res.json({ items: rows || [] });
    } catch (e) { next(e); }
  }
);

module.exports = router;
