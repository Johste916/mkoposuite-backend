'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Role,
  Branch,
  UserRole,
  StaffBranch,
} = require('../models');

/* ---------------------------- helpers ---------------------------- */
const pickFirstKey = (obj, keys) => keys.find((k) => obj && Object.prototype.hasOwnProperty.call(obj, k));
const resolveActiveColumn = () => pickFirstKey(User.rawAttributes, ['isActive', 'active', 'enabled', 'status']);
const resolvePasswordHashColumn = () => pickFirstKey(User.rawAttributes, ['passwordHash', 'password_hash', 'password']);
const sanitizeUser = (u) => {
  if (!u) return u;
  const json = u.toJSON ? u.toJSON() : u;
  delete json.passwordHash; delete json.password_hash; delete json.password;
  return json;
};
const buildIncludes = ({ roleId, branchId }) => {
  const asns = User.associations || {};
  const includes = [];

  if (Role) {
    const roleAssoc =
      asns.roles || asns.Roles || asns.role || asns.Role ||
      Object.values(asns).find((a) => a.target && a.target.name === Role.name);
    if (roleAssoc) {
      const isBTM = roleAssoc.associationType === 'BelongsToMany';
      const inc = { model: Role, as: roleAssoc.as, attributes: ['id', 'name'], required: !!roleId };
      if (isBTM) inc.through = { attributes: [] };
      if (roleId) inc.where = { id: roleId };
      includes.push(inc);
    }
  }

  if (Branch) {
    const branchAssoc =
      asns.branches || asns.Branches || asns.branch || asns.Branch ||
      Object.values(asns).find((a) => a.target && a.target.name === Branch.name);
    if (branchAssoc) {
      const isBTM = branchAssoc.associationType === 'BelongsToMany';
      const inc = { model: Branch, as: branchAssoc.as, attributes: ['id', 'name', 'code'], required: !!branchId };
      if (isBTM) inc.through = { attributes: [] };
      if (branchId) inc.where = { id: branchId };
      includes.push(inc);
    }
  }

  return includes;
};

const setUserRoles = async (user, roleIds, t) => {
  if (!Array.isArray(roleIds)) return;
  if (typeof user.setRoles === 'function') {
    await user.setRoles(roleIds, { transaction: t });
  } else if (UserRole) {
    await UserRole.destroy({ where: { userId: user.id }, transaction: t });
    if (roleIds.length) {
      await UserRole.bulkCreate(roleIds.map((roleId) => ({ userId: user.id, roleId })), { transaction: t });
    }
  }
};

const setUserBranches = async (user, branchIds, t) => {
  if (branchIds == null) return;
  const asns = User.associations || {};
  const branchAssoc =
    asns.branches || asns.Branches || asns.branch || asns.Branch ||
    Object.values(asns).find((a) => a.target && a.target.name === (Branch && Branch.name));

  if (branchAssoc && branchAssoc.associationType === 'BelongsToMany') {
    if (typeof user.setBranches === 'function') {
      await user.setBranches(branchIds, { transaction: t });
      return;
    }
    if (StaffBranch) {
      await StaffBranch.destroy({ where: { userId: user.id }, transaction: t });
      const list = Array.isArray(branchIds) ? branchIds : [branchIds];
      if (list.length) {
        await StaffBranch.bulkCreate(list.map((branchId) => ({ userId: user.id, branchId })), { transaction: t });
      }
      return;
    }
  }

  // Fallback: single branchId column on Users
  const userBranchFk = pickFirstKey(User.rawAttributes, ['branchId', 'BranchId', 'branch_id']);
  if (userBranchFk) {
    const first = Array.isArray(branchIds) ? branchIds[0] : branchIds;
    await user.update({ [userBranchFk]: first || null }, { transaction: t });
  }
};

// SAFE: avoid double-hash & re-hash of an already-hashed value
const hashAndAssignPassword = async (payload) => {
  const pwCol = resolvePasswordHashColumn();
  if (!pwCol) return payload;

  // if already has password_hash, assume trusted (do NOT rehash)
  if (payload[pwCol]) return payload;

  if (payload.password) {
    const clean = { ...payload };
    const hash = await bcrypt.hash(String(payload.password), 10);
    clean[pwCol] = hash;
    delete clean.password;
    return clean;
  }
  return payload;
};

const asArray = (v) =>
  Array.isArray(v) ? v : v == null ? [] : typeof v === 'string' ? [v] : [v];

/* Some DBs might have snake_case linking columns; detect gracefully */
const detectUserRoleFields = async () => {
  const defaults = { roleId: 'roleId', userId: 'userId' };
  try {
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('UserRoles');
    const roleId = desc.roleId ? 'roleId' : (desc.role_id ? 'role_id' : defaults.roleId);
    const userId = desc.userId ? 'userId' : (desc.user_id ? 'user_id' : defaults.userId);
    return { roleId, userId };
  } catch {
    return defaults;
  }
};

/* --------------------------------- GET /api/users --------------------------------- */
exports.getUsers = async (req, res) => {
  try {
    const { q = '', role, roleId, branchId, isActive, page = 1, limit = 200 } = req.query;

    const where = {};
    if (q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { fullName: { [Op.iLike]: `%${q}%` } },
        { email: { [Op.iLike]: `%${q}%` } },
        { username: { [Op.iLike]: `%${q}%` } },
        { phone: { [Op.iLike]: `%${q}%` } },
      ];
    }
    const activeCol = resolveActiveColumn();
    if (activeCol && typeof isActive !== 'undefined') {
      where[activeCol] = String(isActive) === 'true';
    }

    if (role && !roleId) where.role = role;

    const include = buildIncludes({ roleId, branchId });

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(1000, Math.max(1, Number(limit) || 200));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await User.findAndCountAll({
      where,
      include,
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
      order: [['name', 'ASC']],
      limit: limitNum,
      offset,
      distinct: true,
    });

    res.json(rows.map(sanitizeUser));
  } catch (err) {
    console.error('getUsers error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const include = buildIncludes({});
    const user = await User.findByPk(req.params.id, {
      include,
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUser(user));
  } catch (err) {
    console.error('getUserById error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

exports.createUser = async (req, res) => {
  const t = await (sequelize?.transaction ? sequelize.transaction() : User.sequelize.transaction());
  try {
    const { roleIds = [], branchIds = [], ...rest } = req.body || {};

    // Enforce password at creation (local auth)
    if (!rest.password) {
      await t.rollback();
      return res.status(400).json({ error: 'Password is required.' });
    }

    const payload = await hashAndAssignPassword(rest);
    const user = await User.create(payload, { transaction: t });
    await setUserRoles(user, roleIds, t);
    await setUserBranches(user, branchIds, t);
    await t.commit();

    const fresh = await User.findByPk(user.id, {
      include: buildIncludes({}),
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
    });
    res.status(201).json(sanitizeUser(fresh));
  } catch (err) {
    await t.rollback();
    console.error('createUser error:', err);
    res.status(400).json({ error: 'Failed to create user' });
  }
};

exports.updateUser = async (req, res) => {
  const t = await (sequelize?.transaction ? sequelize.transaction() : User.sequelize.transaction());
  try {
    const { id } = req.params;
    const { roleIds, branchIds, password, ...rest } = req.body || {};
    const user = await User.findByPk(id);
    if (!user) { await t.rollback(); return res.status(404).json({ error: 'User not found' }); }

    const payload = password ? await hashAndAssignPassword({ ...rest, password }) : rest;

    await user.update(payload, { transaction: t });
    if (Array.isArray(roleIds)) await setUserRoles(user, roleIds, t);
    if (Array.isArray(branchIds) || typeof branchIds === 'number') await setUserBranches(user, branchIds, t);
    await t.commit();

    const fresh = await User.findByPk(id, {
      include: buildIncludes({}),
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
    });
    res.json(sanitizeUser(fresh));
  } catch (err) {
    await t.rollback();
    console.error('updateUser error:', err);
    res.status(400).json({ error: 'Failed to update user' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const payload = await hashAndAssignPassword({ password });
    await user.update(payload);
    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('resetPassword error:', err);
    res.status(400).json({ error: 'Failed to reset password' });
  }
};

exports.toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const activeCol = resolveActiveColumn(); // should resolve to 'status' now
    if (!activeCol) return res.status(400).json({ error: 'Active/status column not found on User model' });

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const next = typeof req.body[activeCol] === 'string'
      ? req.body[activeCol]
      : (user[activeCol] === 'active' ? 'inactive' : 'active');

    await user.update({ [activeCol]: next });
    res.json({ id: user.id, [activeCol]: next });
  } catch (err) {
    console.error('toggleStatus error:', err);
    res.status(400).json({ error: 'Failed to update status' });
  }
};

/* ------------------------- assignRoles ------------------------- */
exports.assignRoles = async (req, res) => {
  const t = await (sequelize?.transaction ? sequelize.transaction() : User.sequelize.transaction());
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) { await t.rollback(); return res.status(404).json({ error: 'User not found' }); }
    if (!UserRole && typeof user.setRoles !== 'function') {
      await t.rollback();
      return res.status(501).json({ error: 'Role assignment not available' });
    }

    const { roleIds, add, remove, branchIds } = req.body || {};
    const toAdd = new Set(asArray(add));
    const toRemove = new Set(asArray(remove));

    const allIds = new Set([...(asArray(roleIds)), ...toAdd, ...toRemove].filter(Boolean));
    if (allIds.size) {
      const found = await Role.findAll({ where: { id: Array.from(allIds) } });
      const foundIds = new Set(found.map(r => r.id));
      const missing = Array.from(allIds).filter(id => !foundIds.has(id));
      if (missing.length) { await t.rollback(); return res.status(400).json({ error: 'Unknown role(s)', missing }); }
    }

    if (Array.isArray(roleIds)) {
      await setUserRoles(user, roleIds, t);
    } else if (toAdd.size || toRemove.size) {
      if (typeof user.addRoles === 'function' && typeof user.removeRoles === 'function') {
        if (toAdd.size)    await user.addRoles(Array.from(toAdd),    { transaction: t });
        if (toRemove.size) await user.removeRoles(Array.from(toRemove), { transaction: t });
      } else if (UserRole) {
        const { roleId, userId } = await detectUserRoleFields();
        if (toAdd.size) {
          await UserRole.bulkCreate(
            Array.from(toAdd).map(rid => ({ [userId]: user.id, [roleId]: rid })),
            { transaction: t, ignoreDuplicates: true }
          );
        }
        if (toRemove.size) {
          await UserRole.destroy({ where: { [userId]: user.id, [roleId]: Array.from(toRemove) }, transaction: t });
        }
      }
    }

    if (typeof branchIds !== 'undefined') {
      await setUserBranches(user, branchIds, t);
    }

    await t.commit();

    const fresh = await User.findByPk(user.id, {
      include: [{ model: Role, as: 'Roles', through: { attributes: [] } }],
    });
    res.json(sanitizeUser(fresh));
  } catch (err) {
    await t.rollback();
    console.error('assignRoles error:', err);
    res.status(500).json({ error: 'Failed to assign roles' });
  }
};

/* ------------------------- deleteUser ------------------------- */
exports.deleteUser = async (req, res) => {
  const t = await (sequelize?.transaction ? sequelize.transaction() : User.sequelize.transaction());
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) { await t.rollback(); return res.status(404).json({ error: 'User not found' }); }

    const force = ['1','true','yes'].includes(String(req.query.force||'').toLowerCase());
    const hard  = ['1','true','yes'].includes(String(req.query.hard ||'').toLowerCase());

    if (force) {
      if (UserRole) {
        const { userId } = await detectUserRoleFields();
        await UserRole.destroy({ where: { [userId]: user.id }, transaction: t });
      } else if (typeof user.setRoles === 'function') {
        await user.setRoles([], { transaction: t });
      }
    }

    await user.destroy({ force: hard, transaction: t });
    await t.commit();
    res.json({ ok: true });
  } catch (err) {
    await t.rollback();
    console.error('deleteUser error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};
