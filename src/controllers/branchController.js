// src/controllers/branchController.js
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

// LIST STAFF
exports.listStaff = async (req, res, next) => {
  try {
    const bid = Number(req.params.id);
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
};

// ASSIGN STAFF (single-branch rule)
exports.assignStaff = async (req, res, next) => {
  try {
    const bid = parseInt(String(req.params.id), 10);
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    if (!Number.isFinite(bid)) return res.status(400).json({ error: 'Branch id must be an integer' });
    if (!userIds.length || userIds.some((u) => !isUuid(u))) {
      return res.status(400).json({ error: 'userIds[] required (UUIDs)' });
    }

    const Branch = getModel('Branch');
    const branch = await Branch.findByPk(bid);
    if (!branch) return res.status(404).json({ error: 'Branch not found' });

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

    return res.json({ ok: true, assigned: userIds.length });
  } catch (e) {
    const code = e?.original?.code || e?.parent?.code;
    if (code === '22P02') return next(Object.assign(new Error('Invalid ID type'), { status: 400, expose: true }));
    if (code === '42P01') return next(Object.assign(new Error('Missing table/view; run migrations'), { status: 500, expose: true }));
    if (code === '23505') return res.status(409).json({ error: 'Already assigned to a different branch (constraint)', code });
    return next(e);
  }
};

// UNASSIGN STAFF
exports.unassignStaff = async (req, res, next) => {
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
};
