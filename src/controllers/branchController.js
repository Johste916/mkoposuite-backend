// controllers/branchController.js
'use strict';
const { Op } = require('sequelize');

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
      JOIN public.users u ON u.id = ub.user_id
      WHERE ub.branch_id = $1
      ORDER BY name ASC
      `,
      { bind: [branchId], type: sequelize.QueryTypes.SELECT }
    );
    res.json({ items: rows || [] });
  } catch (e) { next(e); }
};

// ASSIGN STAFF (writes to runtime TABLE)
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
