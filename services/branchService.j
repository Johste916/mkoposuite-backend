// server/services/branchService.js
'use strict';

/**
 * Service layer for Branches.
 * Keeps all DB logic here so routes/controllers stay thin.
 * Safe with multi-tenant (reads x-tenant-id when branches.tenant_id exists).
 */

let db = {};
try { db = require('../models'); } catch {}
const { sequelize } = db;

// Fallback QueryTypes in case of different Sequelize import shapes
const SequelizePkg = (() => { try { return require('sequelize'); } catch { return null; } })();
const QT =
  (db && db.Sequelize && db.Sequelize.QueryTypes) ||
  (SequelizePkg && SequelizePkg.QueryTypes) ||
  { SELECT: 'SELECT', UPDATE: 'UPDATE', INSERT: 'INSERT', BULKDELETE: 'BULKDELETE' };

const Op = (SequelizePkg && SequelizePkg.Op) || {};

const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
};

const columnExists = async (table, column) => {
  const rows = await sequelize.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2
     LIMIT 1`,
    { bind: [table, column], type: QT.SELECT }
  );
  return rows?.length > 0;
};

const toIntOrNull = (v) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const getTenantIdFromReq = async (req) => {
  const raw = req?.headers?.['x-tenant-id'] || req?.context?.tenantId || req?.user?.tenantId || null;
  // only apply if branches.tenant_id exists and value can be parsed to int
  if (await columnExists('branches', 'tenant_id')) {
    const n = toIntOrNull(raw);
    return n === null ? null : n;
  }
  return null;
};

/* ================================ CRUD ================================ */

exports.list = async (req) => {
  const Branch = getModel('Branch');

  const q = String(req.query?.q || '').trim();
  const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query?.offset) || 0, 0);

  const where = {};
  if (q && Op.iLike) {
    where[Op.or] = [
      { name:    { [Op.iLike]: `%${q}%` } },
      { code:    { [Op.iLike]: `%${q}%` } },
      { phone:   { [Op.iLike]: `%${q}%` } },
      { address: { [Op.iLike]: `%${q}%` } },
    ];
  }

  const tenantId = await getTenantIdFromReq(req);
  if (tenantId !== null) where.tenantId = tenantId;

  const { rows, count } = await Branch.findAndCountAll({
    where,
    order: [['name', 'ASC']],
    limit,
    offset,
  });

  return { items: rows, total: count };
};

exports.create = async (req) => {
  const Branch = getModel('Branch');
  const body = req.body || {};
  const data = {
    name: (body.name || '').trim(),
    code: body.code == null ? null : String(body.code).trim(),
    phone: body.phone == null ? null : String(body.phone).trim(),
    address: body.address == null ? null : String(body.address).trim(),
  };
  if (!data.name) throw Object.assign(new Error('name is required'), { status: 400, expose: true });

  const tenantId = await getTenantIdFromReq(req);
  if (tenantId !== null) data.tenantId = tenantId;

  return await Branch.create(data);
};

exports.getOne = async (req) => {
  const Branch = getModel('Branch');
  const id = toIntOrNull(req.params.id);
  if (id === null) throw Object.assign(new Error('Branch id must be an integer'), { status: 400, expose: true });

  const where = { id };
  const tenantId = await getTenantIdFromReq(req);
  if (tenantId !== null) where.tenantId = tenantId;

  const found = await Branch.findOne({ where });
  if (!found) throw Object.assign(new Error('Branch not found'), { status: 404, expose: true });
  return found;
};

exports.update = async (req) => {
  const Branch = getModel('Branch');
  const id = toIntOrNull(req.params.id);
  if (id === null) throw Object.assign(new Error('Branch id must be an integer'), { status: 400, expose: true });

  const where = { id };
  const tenantId = await getTenantIdFromReq(req);
  if (tenantId !== null) where.tenantId = tenantId;

  const found = await Branch.findOne({ where });
  if (!found) throw Object.assign(new Error('Branch not found'), { status: 404, expose: true });

  const b = req.body || {};
  const updates = {};
  if (typeof b.name === 'string') updates.name = b.name.trim();
  if ('code' in b)    updates.code    = b.code == null ? null : String(b.code).trim();
  if ('phone' in b)   updates.phone   = b.phone == null ? null : String(b.phone).trim();
  if ('address' in b) updates.address = b.address == null ? null : String(b.address).trim();
  if ('managerId' in b) updates.managerId = b.managerId == null ? null : String(b.managerId);

  await found.update(updates);
  return found;
};

exports.destroy = async (req) => {
  const Branch = getModel('Branch');
  const id = toIntOrNull(req.params.id);
  if (id === null) throw Object.assign(new Error('Branch id must be an integer'), { status: 400, expose: true });

  const where = { id };
  const tenantId = await getTenantIdFromReq(req);
  if (tenantId !== null) where.tenantId = tenantId;

  const found = await Branch.findOne({ where });
  if (!found) throw Object.assign(new Error('Branch not found'), { status: 404, expose: true });
  await found.destroy(); // respects paranoid
  return { ok: true };
};

/* ============================ STAFF ASSIGNMENT ============================ */

exports.listStaff = async (req) => {
  const branchId = toIntOrNull(req.params.id);
  if (branchId === null) throw Object.assign(new Error('Branch id must be an integer'), { status: 400, expose: true });

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
    { bind: [branchId], type: QT.SELECT }
  );
  return { items: rows || [] };
};

exports.assignStaff = async (req) => {
  const branchId = toIntOrNull(req.params.id);
  if (branchId === null) throw Object.assign(new Error('Branch id must be an integer'), { status: 400, expose: true });

  const raw = req.body?.userIds;
  const userIds = Array.isArray(raw) ? raw.filter(Boolean) : [];
  if (!userIds.length) throw Object.assign(new Error('userIds[] required (UUIDs)'), { status: 400, expose: true });

  const invalid = userIds.filter((id) => !isUuid(id));
  if (invalid.length) {
    const err = new Error('All userIds must be UUID strings');
    err.status = 400; err.expose = true; err.details = { invalid };
    throw err;
  }

  // ensure exists
  const Branch = getModel('Branch');
  const found = await Branch.findOne({ where: { id: branchId } });
  if (!found) throw Object.assign(new Error('Branch not found'), { status: 404, expose: true });

  // conflicts (already assigned elsewhere)
  const conflicts = await sequelize.query(`
    SELECT ub.user_id AS "userId", ub.branch_id AS "branchId",
           b.name AS "branchName"
    FROM public.user_branches ub
    JOIN public.branches b ON b.id = ub.branch_id
    WHERE ub.user_id = ANY($1::uuid[])
      AND ub.branch_id <> $2::int
  `, { bind: [userIds, branchId], type: QT.SELECT });

  if (conflicts && conflicts.length) {
    const err = new Error('User(s) already assigned to another branch — unassign first.');
    err.status = 409; err.expose = true; err.conflicts = conflicts;
    throw err;
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

  return { ok: true, assigned: userIds.length };
};

exports.unassignStaff = async (req) => {
  const branchId = toIntOrNull(req.params.id);
  const userId = String(req.params.userId || '');
  if (branchId === null) throw Object.assign(new Error('Branch id must be an integer'), { status: 400, expose: true });
  if (!isUuid(userId)) throw Object.assign(new Error('userId must be a UUID'), { status: 400, expose: true });

  await sequelize.query(
    `DELETE FROM public.user_branches_rt WHERE user_id = $1::uuid AND branch_id = $2::int`,
    { bind: [userId, branchId], type: QT.BULKDELETE }
  );
  return { ok: true };
};

/* =========================== OVERVIEW / REPORTS =========================== */

exports.overview = async (req) => {
  const branchId = toIntOrNull(req.params.id);
  if (branchId === null) throw Object.assign(new Error('Branch id must be an integer'), { status: 400, expose: true });

  const q = async (sql, bind = []) => {
    try { return await sequelize.query(sql, { bind, type: QT.SELECT }); }
    catch { return null; }
  };

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

  if (!header || !header[0]) throw Object.assign(new Error('Branch not found'), { status: 404, expose: true });

  const staff = await q(`SELECT COUNT(*)::int AS count FROM public.user_branches WHERE branch_id = $1`, [branchId]);
  const borrowers = await q(`SELECT COUNT(*)::int AS count FROM public."Borrowers" WHERE "branchId" = $1`, [branchId]);
  const loans = await q(`SELECT COUNT(*)::int AS total FROM public."Loans" WHERE "branchId" = $1`, [branchId]);

  let outstanding = null;
  try {
    const out = await sequelize.query(`
      SELECT COALESCE(SUM(l."principalOutstanding"),0)::numeric AS outstanding
      FROM public."Loans" l
      WHERE l."branchId" = $1
    `, { bind: [branchId], type: QT.SELECT });
    outstanding = out?.[0]?.outstanding ?? null;
  } catch {}

  let collections30 =
    await q(`
      SELECT COALESCE(SUM(lp.amount),0)::numeric AS amount
      FROM public."LoanPayments" lp
      JOIN public."Loans" l ON l.id = lp."loanId"
      WHERE l."branchId" = $1
        AND lp."createdAt" >= (NOW() - INTERVAL '30 days')
    `, [branchId]) ||
    await q(`
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

  return {
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
  };
};

exports.report = async (req) => {
  const branchId = toIntOrNull(req.params.id);
  if (branchId === null) throw Object.assign(new Error('Branch id must be an integer'), { status: 400, expose: true });

  const from = String(req.query?.from || '').trim() || null;
  const to = String(req.query?.to || '').trim() || null;

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
    `SELECT COUNT(*)::int AS count FROM public.user_branches WHERE branch_id = $1`,
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

  return {
    kpis: {
      staffCount:  staff?.[0]?.count ?? 0,
      expenses:    expenses?.[0]?.amount ?? 0,
      loansOut:    loansOut?.[0]?.amount ?? 0,
      collections: collections?.[0]?.amount ?? 0,
    },
  };
};
