'use strict';

const express = require('express');
const router = express.Router();

let db = {};
try { db = require('../models'); } catch {}
const sequelize = db?.sequelize;
const { Op } = require('sequelize');

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

router.use(authenticateUser);

router.get('/', async (req, res, next) => {
  if (typeof userCtrl.getUsers === 'function') {
    return userCtrl.getUsers(req, res, next);
  }
  try {
    const User = getModel('User');
    const Role = getModel('Role');

    const where = {};
    const q = (req.query.q || '').trim();
    const like = User.sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;

    if (q) {
      where[Op.or] = [
        { name:      { [like]: `%${q}%` } },
        { email:     { [like]: `%${q}%` } },
        { firstName: { [like]: `%${q}%` } },
        { lastName:  { [like]: `%${q}%` } },
      ];
    }
    if (req.query.branchId) where.branchId = req.query.branchId;

    // Always include roles so we can filter by role name in-memory too
    const include = [{ model: Role, as: 'Roles', through: { attributes: [] } }];
    const limit = Math.min(Number(req.query.limit) || 1000, 2000);

    const rows = await User.findAll({
      where,
      include,
      order: [['name', 'ASC']],
      limit,
    });

    // Role filter: role, roleName, or roles (case-insensitive)
    const roleFilter = (req.query.role || req.query.roleName || req.query.roles || '').toLowerCase();
    const items = roleFilter
      ? rows.filter(u =>
          (u.Roles || []).some(r => (String(r.name) || '').toLowerCase() === roleFilter) ||
          (String(u.role) || '').toLowerCase() === roleFilter
        )
      : rows;

    res.json({ items });
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

// tolerant inline assign (role/branch)
router.post('/:id/assign', async (req, res) => {
  const userId = req.params.id;
  const roleId = req.body?.roleId || null;
  const branchId = req.body?.branchId || null;
  const tenantId = tenantIdFrom(req);

  if (!sequelize) return res.status(500).json({ error: 'DB not initialized' });
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });
  if (!roleId && !branchId) return res.status(400).json({ error: 'roleId or branchId required' });

  try {
    await sequelize.transaction(async (t) => {
      const [rows] = await sequelize.query(
        `select id from public.users where id = :userId`,
        { replacements: { userId }, transaction: t }
      );
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (roleId) {
        let viaColumn = false;
        try {
          await sequelize.query(
            `update public.users set role_id = :roleId where id = :userId`,
            { replacements: { roleId, userId }, transaction: t }
          );
          viaColumn = true;
        } catch {}
        if (!viaColumn) {
          await sequelize.query(
            `
            insert into public.user_roles (user_id, role_id${tenantId ? ', tenant_id' : ''})
            values (:userId, :roleId${tenantId ? ', :tenantId' : ''})
            on conflict (user_id, role_id) do nothing
            `,
            { replacements: { userId, roleId, tenantId }, transaction: t }
          );
        }
      }

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

        // Keep a primary branch_id on Users
        await sequelize.query(
          `update public.users set branch_id = :branchId where id = :userId`,
          { replacements: { userId, branchId }, transaction: t }
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
