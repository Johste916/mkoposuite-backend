// controllers/branchController.js
'use strict';

let db = {};
try { db = require('../models'); } catch {}
const { sequelize } = db;

const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
};

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/** ------- (other handlers unchanged) ------- **/

// LIST STAFF (reads from VIEW)
exports.listStaff = async (req, res, next) => {
  try {
    const branchId = Number(req.params.id);
    const rows = await sequelize.query(
      `
      SELECT u.id,
             COALESCE(u.name, (u."firstName" || ' ' || u."lastName")) AS name,
             u.email,
             u.role
      FROM public.user_branches ub
      JOIN public."Users" u ON u.id = ub.user_id
      WHERE ub.branch_id = $1
      ORDER BY name ASC
      `,
      { bind: [branchId], type: sequelize.QueryTypes.SELECT }
    );
    res.json({ items: rows || [] });
  } catch (e) { next(e); }
};

// ASSIGN STAFF (writes to runtime TABLE) with single-branch guard
exports.assignStaff = async (req, res, next) => {
  try {
    const branchId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(branchId)) {
      return res.status(400).json({ error: 'Branch id must be an integer' });
    }

    const raw = req.body?.userIds;
    const userIds = Array.isArray(raw) ? raw.filter(Boolean) : [];
    if (!userIds.length) return res.status(400).json({ error: 'userIds[] required (UUIDs)' });

    const invalid = userIds.filter((id) => !isUuid(id));
    if (invalid.length) {
      return res.status(400).json({ error: 'All userIds must be UUID strings', details: { invalid } });
    }

    // Make sure branch exists (good 404s)
    const Branch = getModel('Branch');
    const branch = await Branch.findOne({ where: { id: branchId } });
    if (!branch) return res.status(404).json({ error: 'Branch not found' });

    // Conflict check (same as in route)
    const conflicts = await sequelize.query(`
      SELECT ub.user_id AS "userId", ub.branch_id AS "branchId",
             b.name AS "branchName"
      FROM public.user_branches ub
      JOIN public.branches b ON b.id = ub.branch_id
      WHERE ub.user_id = ANY($1::uuid[])
        AND ub.branch_id <> $2::int
    `, { bind: [userIds, branchId], type: sequelize.QueryTypes.SELECT });

    if (conflicts && conflicts.length) {
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

    // Single bulk insert, no explicit transaction → no 25P02 chain
    await sequelize.query(
      `
      INSERT INTO public.user_branches_rt (user_id, branch_id, created_at)
      SELECT uid, $2::int, NOW()
      FROM unnest($1::uuid[]) AS t(uid)
      ON CONFLICT (user_id, branch_id) DO NOTHING
      `,
      { bind: [userIds, branchId] }
    );

    return res.json({ ok: true, assigned: userIds.length });
  } catch (e) {
    const code = e?.original?.code || e?.parent?.code;
    if (code === '22P02') {
      return next(Object.assign(new Error('Invalid ID type — userIds must be UUID and branchId must be integer.'), { status: 400, expose: true, original: e }));
    }
    if (code === '42P01') {
      return next(Object.assign(new Error('Missing table/view. Ensure migrations ran for user_branches_rt and user_branches.'), { status: 500, expose: true, original: e }));
    }
    return next(e);
  }
};

// UNASSIGN STAFF (delete from runtime table)
exports.unassignStaff = async (req, res, next) => {
  try {
    const branchId = Number.parseInt(String(req.params.id), 10);
    const userId = String(req.params.userId || '');
    if (!Number.isFinite(branchId)) return res.status(400).json({ error: 'Branch id must be an integer' });
    if (!isUuid(userId)) return res.status(400).json({ error: 'userId must be a UUID' });

    const result = await sequelize.query(
      `DELETE FROM public.user_branches_rt WHERE user_id = $1::uuid AND branch_id = $2::int`,
      { bind: [userId, branchId], type: sequelize.QueryTypes.BULKDELETE }
    );
    return res.json({ ok: true, removed: (result?.[1] ?? 0) > 0 });
  } catch (e) { next(e); }
};

// OVERVIEW (same logic as route version provided for controller-based usage)
exports.overview = async (req, res, next) => {
  const branchId = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(branchId)) return res.status(400).json({ error: 'Branch id must be an integer' });

  const q = async (sql, bind = []) => {
    try { return await sequelize.query(sql, { bind, type: sequelize.QueryTypes.SELECT }); }
    catch { return null; }
  };

  try {
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

    const staff = await q(`SELECT COUNT(*)::int AS count FROM public.user_branches WHERE branch_id = $1`, [branchId]);
    const borrowers = await q(`SELECT COUNT(*)::int AS count FROM public."Borrowers" WHERE "branchId" = $1`, [branchId]);
    const loans = await q(`SELECT COUNT(*)::int AS total FROM public."Loans" WHERE "branchId" = $1`, [branchId]);

    let outstanding = null;
    try {
      const out = await sequelize.query(`
        SELECT COALESCE(SUM(l."principalOutstanding"),0)::numeric AS outstanding
        FROM public."Loans" l
        WHERE l."branchId" = $1
      `, { bind: [branchId], type: sequelize.QueryTypes.SELECT });
      outstanding = out?.[0]?.outstanding ?? null;
    } catch {}

    let collections30 = await q(`
      SELECT COALESCE(SUM(lp.amount),0)::numeric AS amount
      FROM public."LoanPayments" lp
      JOIN public."Loans" l ON l.id = lp."loanId"
      WHERE l."branchId" = $1
        AND lp."createdAt" >= (NOW() - INTERVAL '30 days')
    `, [branchId]);
    if (!collections30) {
      collections30 = await q(`
        SELECT COALESCE(SUM(lr.amount),0)::numeric AS amount
        FROM public."LoanRepayments" lr
        JOIN public."Loans" l ON l.id = lr."loanId"
        WHERE l."branchId" = $1
          AND lr."createdAt" >= (NOW() - INTERVAL '30 days')
      `, [branchId]);
    }

    const expenses = await q(`
      SELECT COALESCE(SUM(e.amount),0)::numeric AS amount
      FROM public.expenses e
      WHERE e.branchId = $1
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
  } catch (e) { return next(e); }
};
