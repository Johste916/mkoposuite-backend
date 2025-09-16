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

/* … list/create/update/delete branches remain unchanged … */

/* ============================== ASSIGN STAFF =============================== */
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

      // Ensure branch exists
      const Branch = getModel('Branch');
      const exists = await Branch.findOne({ where: { id: branchId } });
      if (!exists) return res.status(404).json({ error: 'Branch not found' });

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
