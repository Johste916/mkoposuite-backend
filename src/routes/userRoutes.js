'use strict';

const express = require('express');
const router = express.Router();

let db = {};
try { db = require('../models'); } catch {}
const sequelize = db?.sequelize;
const { Op } = require('sequelize');

// Optional middlewares/controllers (use if present; no crash if missing)
let authenticateUser = (_req, _res, next) => next();
try { ({ authenticateUser } = require('../middleware/authMiddleware')); } catch {}

let userCtrl = {};
try { userCtrl = require('../controllers/userController'); } catch {}

const getModel = (name) => {
  const m = db?.[name] || db?.sequelize?.models?.[name];
  if (!m) throw Object.assign(new Error(`Model "${name}" not found`), { status: 500, expose: true });
  return m;
};

const tenantIdFrom = (req) =>
  req?.tenant?.id || req?.headers?.['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || null;

// The app likely already mounts auth; but this is harmless if double-used.
router.use(authenticateUser);

/**
 * GET /users
 * Use controller if present; else provide a safe fallback list with ?q and ?limit.
 */
router.get('/', async (req, res, next) => {
  if (typeof userCtrl.getUsers === 'function') {
    return userCtrl.getUsers(req, res, next);
  }
  try {
    const User = getModel('User');
    const where = {};
    const q = (req.query.q || '').trim();
    if (q) {
      where[Op.or] = [
        { name:      { [Op.iLike]: `%${q}%` } },
        { email:     { [Op.iLike]: `%${q}%` } },
        { firstName: { [Op.iLike]: `%${q}%` } },
        { lastName:  { [Op.iLike]: `%${q}%` } },
      ];
    }
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const rows = await User.findAll({ where, order: [['name', 'ASC']], limit });
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.get('/:id', (req, res, next) => {
  if (typeof userCtrl.getUserById === 'function') return userCtrl.getUserById(req, res, next);
  return res.status(501).json({ error: 'getUserById not implemented' });
});

router.post('/', (req, res, next) => {
  if (typeof userCtrl.createUser === 'function') return userCtrl.createUser(req, res, next);
  return res.status(501).json({ error: 'createUser not implemented' });
});

router.put('/:id', (req, res, next) => {
  if (typeof userCtrl.updateUser === 'function') return userCtrl.updateUser(req, res, next);
  return res.status(501).json({ error: 'updateUser not implemented' });
});

router.patch('/:id/password', (req, res, next) => {
  if (typeof userCtrl.resetPassword === 'function') return userCtrl.resetPassword(req, res, next);
  return res.status(501).json({ error: 'resetPassword not implemented' });
});

router.patch('/:id/status', (req, res, next) => {
  if (typeof userCtrl.toggleStatus === 'function') return userCtrl.toggleStatus(req, res, next);
  return res.status(501).json({ error: 'toggleStatus not implemented' });
});

/**
 * ✅ POST /users/:id/assign
 * Body: { roleId?: number|null, branchId?: number|null }
 * - Tries to set users.role_id directly; if not available, upserts user_roles (by user_id)
 * - Always upserts user_branches for branchId (many-to-many safe)
 * - Respects x-tenant-id if provided
 */
router.post('/:id/assign', async (req, res) => {
  const userId = Number(req.params.id);
  const roleId = req.body?.roleId ? Number(req.body.roleId) : null;
  const branchId = req.body?.branchId ? Number(req.body.branchId) : null;
  const tenantId = tenantIdFrom(req);

  if (!sequelize) return res.status(500).json({ error: 'DB not initialized' });
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });
  if (!roleId && !branchId) return res.status(400).json({ error: 'roleId or branchId required' });

  try {
    await sequelize.transaction(async (t) => {
      // Ensure user exists
      const [rows] = await sequelize.query(
        `select id from public.users where id = :userId`,
        { replacements: { userId }, transaction: t }
      );
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Role assignment
      if (roleId) {
        let updatedViaColumn = false;
        try {
          await sequelize.query(
            `update public.users set role_id = :roleId where id = :userId`,
            { replacements: { roleId, userId }, transaction: t }
          );
          updatedViaColumn = true;
        } catch (_) {
          // If users.role_id column doesn't exist, fall back to user_roles table
        }
        if (!updatedViaColumn) {
          await sequelize.query(
            `
            insert into public.user_roles (user_id, role_id${tenantId ? ', tenant_id' : ''})
            values (:userId, :roleId${tenantId ? ', :tenantId' : ''})
            on conflict (user_id) do update set role_id = excluded.role_id
            `,
            { replacements: { userId, roleId, tenantId }, transaction: t }
          );
        }
      }

      // Branch assignment upsert
      if (branchId) {
        await sequelize.query(
          `
          insert into public.user_branches (user_id, branch_id${tenantId ? ', tenant_id' : ''})
          values (:userId, :branchId${tenantId ? ', :tenantId' : ''})
          on conflict (user_id, branch_id) do update set
            ${tenantId ? 'tenant_id = excluded.tenant_id' : 'branch_id = excluded.branch_id'}
          `,
          { replacements: { userId, branchId, tenantId }, transaction: t }
        );
      }
    });

    res.json({ ok: true, userId, roleId, branchId });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ error: e?.expose ? e.message : 'Failed to assign' });
  }
});

module.exports = router;
