// src/routes/branchRoutes.js
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

/* ============================== BASIC CRUD ============================== */
// list
router.get(
  '/',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const where = {};
      if (req.query.q) where.name = { [Op.iLike]: `%${req.query.q}%` };
      const rows = await Branch.findAll({ where, order: [['name', 'ASC']] });
      res.setHeader('X-Total-Count', String(rows.length));
      res.json(rows);
    } catch (e) { next(e); }
  }
);

// create
router.post(
  '/',
  requireAuth,
  allow ? allow('branches:manage') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const rec = { ...req.body };
      if (!rec.name) return res.status(400).json({ error: 'name is required' });
      const row = await Branch.create(rec);
      res.status(201).json(row);
    } catch (e) { next(e); }
  }
);

// update
router.patch(
  '/:id',
  requireAuth,
  allow ? allow('branches:manage') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const row = await Branch.findByPk(req.params.id);
      if (!row) return res.status(404).json({ error: 'Branch not found' });
      await row.update(req.body || {});
      res.json(row);
    } catch (e) { next(e); }
  }
);

// delete
router.delete(
  '/:id',
  requireAuth,
  allow ? allow('branches:manage') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const Branch = getModel('Branch');
      const n = await Branch.destroy({ where: { id: req.params.id } });
      if (!n) return res.status(404).json({ error: 'Branch not found' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  }
);

/* ============================== OVERVIEW =============================== */
/**
 * Rich overview of a branch:
 * - staffCount, borrowerCount
 * - sums: disbursed, collected, expenses (optional date range ?from=YYYY-MM-DD&to=YYYY-MM-DD)
 * - recent activity: 10 latest assigned staff/borrowers
 */
router.get(
  '/:id/overview',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const bid = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(bid)) return res.status(400).json({ error: 'Branch id must be an integer' });

      const from = req.query.from || null;
      const to   = req.query.to   || null;

      const between = (col) =>
        from && to ? ` AND ${col} >= :from AND ${col} < (:to::date + interval '1 day')`
        : from     ? ` AND ${col} >= :from`
        : to       ? ` AND ${col} < (:to::date + interval '1 day')`
                   : '';

      const [[staffCountRow]] = await sequelize.query(
        `SELECT COUNT(*)::int AS c FROM public.user_branches WHERE branch_id = :bid`,
        { replacements: { bid } }
      );
      const [[borrowerCountRow]] = await sequelize.query(
        `SELECT COUNT(*)::int AS c FROM public.borrower_branches WHERE branch_id = :bid`,
        { replacements: { bid } }
      ).catch(() => [[{ c: 0 }]]); // tolerate missing table in some envs

      const [[disbursedRow]] = await sequelize.query(
        `SELECT COALESCE(SUM(principal_amount),0)::numeric AS total
           FROM public.loans
          WHERE branch_id = :bid ${between('disbursement_date')}`,
        { replacements: { bid, from, to } }
      ).catch(() => [[{ total: 0 }]]);

      const [[collectedRow]] = await sequelize.query(
        `SELECT COALESCE(SUM(amount),0)::numeric AS total
           FROM public.repayments
          WHERE branch_id = :bid ${between('"date"')}`, // quoted "date" if reserved
        { replacements: { bid, from, to } }
      ).catch(() => [[{ total: 0 }]]);

      const [[expensesRow]] = await sequelize.query(
        `SELECT COALESCE(SUM(amount),0)::numeric AS total
           FROM public.expenses
          WHERE branch_id = :bid ${between('"date"')}`,
        { replacements: { bid, from, to } }
      ).catch(() => [[{ total: 0 }]]);

      const [recentStaff] = await sequelize.query(
        `SELECT ub.user_id AS id,
                COALESCE(u.name, (u."firstName"||' '||u."lastName")) AS name,
                u.email,
                ub.created_at
           FROM public.user_branches ub
           JOIN public.users u ON u.id = ub.user_id
          WHERE ub.branch_id = :bid
          ORDER BY ub.created_at DESC
          LIMIT 10`,
        { replacements: { bid } }
      );

      const [recentBorrowers] = await sequelize.query(
        `SELECT b.id,
                b.name,
                bb.created_at
           FROM public.borrower_branches bb
           JOIN public.borrowers b ON b.id = bb.borrower_id
          WHERE bb.branch_id = :bid
          ORDER BY bb.created_at DESC
          LIMIT 10`,
        { replacements: { bid } }
      ).catch(() => [ [] ]);

      res.json({
        kpis: {
          staffCount: Number(staffCountRow?.c || 0),
          borrowerCount: Number(borrowerCountRow?.c || 0),
          disbursed: Number(disbursedRow?.total || 0),
          collected: Number(collectedRow?.total || 0),
          expenses: Number(expensesRow?.total || 0),
        },
        recent: { staff: recentStaff, borrowers: recentBorrowers },
        range: { from, to },
      });
    } catch (e) { next(e); }
  }
);

/* ============================== STAFF: LIST ============================== */
router.get(
  '/:id/staff',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const bid = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(bid)) return res.status(400).json({ error: 'Branch id must be an integer' });

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
        { bind: [bid], type: sequelize.QueryTypes.SELECT }
      );

      res.json({ items: rows || [] });
    } catch (e) { next(e); }
  }
);

/* ============================== STAFF: ASSIGN ============================= */
/**
 * Enforces single-branch per user:
 * - If a user already has a different branch, 409 + details { existing: { userId, branchId, branchName, branchCode } }
 * - If already assigned to the same branch, ignored (idempotent)
 */
router.post(
  '/:id/assign-staff',
  requireAuth,
  allow ? allow('branches:assign') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const bid = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(bid)) return res.status(400).json({ error: 'Branch id must be an integer' });

      const raw = req.body?.userIds;
      const userIds = Array.isArray(raw) ? raw.filter(Boolean) : [];
      if (!userIds.length) return res.status(400).json({ error: 'userIds[] required (UUIDs)' });

      const invalid = userIds.filter((id) => !isUuid(id));
      if (invalid.length) {
        return res.status(400).json({ error: 'All userIds must be UUID strings', details: { invalid } });
      }

      // Make sure branch exists
      const Branch = getModel('Branch');
      const branch = await Branch.findByPk(bid);
      if (!branch) return res.status(404).json({ error: 'Branch not found' });

      // Check if any of the users already assigned to another branch
      const [conflicts] = await sequelize.query(
        `
        SELECT rt.user_id, rt.branch_id, b.name AS branch_name, b.code AS branch_code
          FROM public.user_branches_rt rt
          LEFT JOIN public.branches b ON b.id = rt.branch_id
         WHERE rt.user_id = ANY($1::uuid[])
           AND rt.branch_id <> $2::int
        `,
        { bind: [userIds, bid] }
      );

      if (conflicts.length) {
        return res.status(409).json({
          error: 'One or more users are already assigned to another branch',
          existing: conflicts.map((c) => ({
            userId: c.user_id,
            branchId: c.branch_id,
            branchName: c.branch_name,
            branchCode: c.branch_code,
          })),
          action: 'Unassign them first, then retry.',
        });
      }

      // Insert: idempotent (ignore duplicates for same branch)
      await sequelize.query(
        `
        INSERT INTO public.user_branches_rt (user_id, branch_id, created_at)
        SELECT uid, $2::int, NOW()
        FROM unnest($1::uuid[]) AS t(uid)
        ON CONFLICT (user_id) DO UPDATE
          SET branch_id = EXCLUDED.branch_id,
              created_at = public.user_branches_rt.created_at
          WHERE public.user_branches_rt.branch_id = EXCLUDED.branch_id
        `,
        { bind: [userIds, bid] }
      );

      res.json({ ok: true, assigned: userIds.length });
    } catch (e) {
      const code = e?.original?.code || e?.parent?.code;
      if (code === '22P02') return res.status(400).json({ error: 'Invalid ID type' });
      if (code === '42P01') return res.status(500).json({ error: 'Missing table/view; run migrations' });
      if (code === '23505') return res.status(409).json({ error: 'Already assigned to a different branch (constraint)', code });
      next(e);
    }
  }
);

/* ============================== STAFF: UNASSIGN =========================== */
router.delete(
  '/:id/staff/:userId',
  requireAuth,
  allow ? allow('branches:assign') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const bid = parseInt(String(req.params.id), 10);
      const uid = String(req.params.userId);
      if (!Number.isFinite(bid)) return res.status(400).json({ error: 'Branch id must be an integer' });
      if (!isUuid(uid)) return res.status(400).json({ error: 'userId must be a UUID' });

      await sequelize.query(
        `DELETE FROM public.user_branches_rt WHERE user_id = $1::uuid AND branch_id = $2::int`,
        { bind: [uid, bid] }
      );
      res.json({ ok: true });
    } catch (e) { next(e); }
  }
);

/* ============================== BORROWERS: LIST =========================== */
router.get(
  '/:id/borrowers',
  requireAuth,
  allow ? allow('branches:view') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const bid = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(bid)) return res.status(400).json({ error: 'Branch id must be an integer' });

      const rows = await sequelize.query(
        `
        SELECT b.id, b.name, b.phone
          FROM public.borrower_branches bb
          JOIN public.borrowers b ON b.id = bb.borrower_id
         WHERE bb.branch_id = $1
         ORDER BY b.name ASC
        `,
        { bind: [bid], type: sequelize.QueryTypes.SELECT }
      ).catch(() => []);

      res.json({ items: rows || [] });
    } catch (e) { next(e); }
  }
);

/* ============================== BORROWERS: ASSIGN ========================= */
/** Enforce single-branch per borrower (same idea as staff) */
router.post(
  '/:id/assign-borrowers',
  requireAuth,
  allow ? allow('branches:assign') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const bid = parseInt(String(req.params.id), 10);
      const borrowerIds = Array.isArray(req.body?.borrowerIds) ? req.body.borrowerIds.map((x) => parseInt(String(x), 10)).filter(Number.isFinite) : [];
      if (!Number.isFinite(bid)) return res.status(400).json({ error: 'Branch id must be an integer' });
      if (!borrowerIds.length) return res.status(400).json({ error: 'borrowerIds[] required (ints)' });

      // Conflicts?
      const [conflicts] = await sequelize.query(
        `
        SELECT bb.borrower_id, bb.branch_id, b2.name AS branch_name, b2.code AS branch_code
          FROM public.borrower_branches bb
          LEFT JOIN public.branches b2 ON b2.id = bb.branch_id
         WHERE bb.borrower_id = ANY($1::int[])
           AND bb.branch_id <> $2::int
        `,
        { bind: [borrowerIds, bid] }
      ).catch(() => [ [] ]);

      if (conflicts.length) {
        return res.status(409).json({
          error: 'One or more borrowers are already assigned to another branch',
          existing: conflicts.map((c) => ({
            borrowerId: c.borrower_id,
            branchId: c.branch_id,
            branchName: c.branch_name,
            branchCode: c.branch_code,
          })),
          action: 'Unassign them first, then retry.',
        });
      }

      // Insert or keep same-branch idempotent
      await sequelize.query(
        `
        INSERT INTO public.borrower_branches (borrower_id, branch_id, created_at)
        SELECT id, $2::int, NOW()
        FROM unnest($1::int[]) AS t(id)
        ON CONFLICT (borrower_id) DO UPDATE
          SET branch_id = EXCLUDED.branch_id
          WHERE public.borrower_branches.branch_id = EXCLUDED.branch_id
        `,
        { bind: [borrowerIds, bid] }
      ).catch(() => { throw Object.assign(new Error('Missing table borrower_branches; run migrations'), { status: 500, expose: true }); });

      res.json({ ok: true, assigned: borrowerIds.length });
    } catch (e) {
      const code = e?.original?.code || e?.parent?.code;
      if (code === '42P01') return res.status(500).json({ error: 'Missing table; run migrations' });
      if (code === '23505') return res.status(409).json({ error: 'Already assigned to a different branch (constraint)', code });
      next(e);
    }
  }
);

/* ============================== BORROWERS: UNASSIGN ======================= */
router.delete(
  '/:id/borrowers/:borrowerId',
  requireAuth,
  allow ? allow('branches:assign') : (_req, _res, next) => next(),
  async (req, res, next) => {
    try {
      const bid = parseInt(String(req.params.id), 10);
      const borrowerId = parseInt(String(req.params.borrowerId), 10);
      if (!Number.isFinite(bid) || !Number.isFinite(borrowerId)) {
        return res.status(400).json({ error: 'ids must be integers' });
      }
      await sequelize.query(
        `DELETE FROM public.borrower_branches WHERE borrower_id = $1::int AND branch_id = $2::int`,
        { bind: [borrowerId, bid] }
      ).catch(() => { throw Object.assign(new Error('Missing table borrower_branches; run migrations'), { status: 500, expose: true }); });
      res.json({ ok: true });
    } catch (e) { next(e); }
  }
);

module.exports = router;
