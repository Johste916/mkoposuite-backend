'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Role,
  Branch,
  UserRole,
  UserBranch, // ✅ use your actual join model
} = require('../models');

/* ---------------------------- helpers ---------------------------- */
const pickFirstKey = (obj, keys) => keys.find((k) => obj && Object.prototype.hasOwnProperty.call(obj, k));
const resolveActiveColumn = () => pickFirstKey(User.rawAttributes, ['status', 'isActive', 'active', 'enabled']); // prefer 'status'
const resolvePasswordHashColumn = () => pickFirstKey(User.rawAttributes, ['passwordHash', 'password_hash', 'password']);
const sanitizeUser = (u) => {
  if (!u) return u;
  const json = u.toJSON ? u.toJSON() : u;
  delete json.passwordHash; delete json.password_hash; delete json.password;
  return json;
};

const normalizeUserInput = (body = {}) => {
  const clean = { ...body };

  // Map possible frontend fields to what DB expects
  clean.name = clean.name || clean.fullName || clean.username || '';
  if (!clean.name && clean.email && typeof clean.email === 'string') {
    // fallback: use email local part as name
    clean.name = clean.email.split('@')[0];
  }

  // trim strings
  ['name', 'email', 'password', 'role'].forEach((k) => {
    if (clean[k] && typeof clean[k] === 'string') clean[k] = clean[k].trim();
  });

  return clean;
};

const hasAttr = (model, attr) => !!(model?.rawAttributes?.[attr]);

const buildIncludes = ({ roleId, roleCode, branchId }) => {
  const asns = User.associations || {};
  const includes = [];

  if (Role) {
    const roleAssoc =
      asns.roles || asns.Roles || asns.role || asns.Role ||
      Object.values(asns).find((a) => a.target && a.target.name === Role.name);
    if (roleAssoc) {
      const isBTM = roleAssoc.associationType === 'BelongsToMany';
      const roleAttrs = ['id', 'name'].concat(hasAttr(Role, 'code') ? ['code'] : []);
      const inc = { model: Role, as: roleAssoc.as, attributes: roleAttrs, required: !!(roleId || roleCode) };
      if (isBTM) inc.through = { attributes: [] };
      if (roleId) inc.where = { ...(inc.where || {}), id: roleId };
      if (roleCode && hasAttr(Role, 'code')) inc.where = { ...(inc.where || {}), code: String(roleCode).toLowerCase() };
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
    if (UserBranch) {
      await UserBranch.destroy({ where: { userId: user.id }, transaction: t });
      const list = Array.isArray(branchIds) ? branchIds : [branchIds];
      if (list.length) {
        await UserBranch.bulkCreate(list.map((branchId) => ({ userId: user.id, branchId })), { transaction: t });
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

/* --------- NEW: safe rollback helper to avoid "finished with state: commit" --------- */
const safeRollback = async (t) => {
  try {
    if (t && typeof t.rollback === 'function' && !t.finished) {
      await t.rollback();
    }
  } catch {}
};

/* ------------------------------- Validators ------------------------------- */
const validateCreate = (data) => {
  const errors = [];

  if (!data.name) errors.push('Name is required.');
  if (!data.email) errors.push('Email is required.');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('Email is invalid.');

  if (!data.password) errors.push('Password is required.');
  else if (String(data.password).length < 6) errors.push('Password must be at least 6 characters.');

  return errors;
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
    if (typeof isActive !== 'undefined' && activeCol) {
      const attr = User.rawAttributes[activeCol];
      const truthy = String(isActive) === 'true' || String(isActive) === '1';
      // boolean column → true/false
      if (attr?.type?.key === 'BOOLEAN') {
        where[activeCol] = truthy;
      } else {
        // enum/string column → 'active'/'inactive'
        where[activeCol] = truthy ? 'active' : 'inactive';
      }
    }

    // role filtering: prefer include filter on Role.code if M:N, fall back to legacy Users.role
    const roleCode = role && hasAttr(Role, 'code') ? String(role).toLowerCase() : null;
    if (!roleId && !roleCode && role) {
      where.role = role; // legacy
    }

    const include = buildIncludes({ roleId, roleCode, branchId });

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
    const { roleIds = [], branchIds = [], ...restRaw } = req.body || {};
    const rest = normalizeUserInput(restRaw);

    const errors = validateCreate(rest);
    if (errors.length) {
      await safeRollback(t);
      return res.status(400).json({ error: errors[0], errors });
    }

    // pre-hash if "password" provided; model hook will also hash if needed
    const payload = await hashAndAssignPassword(rest);

    // Unique email guard (cleaner 409 vs generic 400)
    const existing = await User.findOne({ where: { email: payload.email } });
    if (existing) {
      await safeRollback(t);
      return res.status(409).json({ error: 'Email already in use.' });
    }

    const user = await User.create(payload, { transaction: t });
    await setUserRoles(user, roleIds, t);
    await setUserBranches(user, branchIds, t);
    await t.commit();
    t.finished = t.finished || 'commit';

    const fresh = await User.findByPk(user.id, {
      include: buildIncludes({}),
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
    });
    res.status(201).json(sanitizeUser(fresh));
  } catch (err) {
    await safeRollback(t);
    console.error('createUser error:', err);

    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Email already in use.' });
    }
    if (err.name === 'SequelizeValidationError') {
      return res.status(400).json({ error: err.errors?.[0]?.message || 'Validation error', details: err.errors });
    }
    res.status(400).json({ error: 'Failed to create user' });
  }
};

exports.updateUser = async (req, res) => {
  const t = await (sequelize?.transaction ? sequelize.transaction() : User.sequelize.transaction());
  try {
    const { id } = req.params;
    const { roleIds, branchIds, password, ...restRaw } = req.body || {};
    const rest = normalizeUserInput(restRaw);

    const user = await User.findByPk(id);
    if (!user) { await safeRollback(t); return res.status(404).json({ error: 'User not found' }); }

    const payload = password ? await hashAndAssignPassword({ ...rest, password }) : rest;

    // prevent accidental email collision
    if (payload.email && payload.email !== user.email) {
      const dup = await User.findOne({ where: { email: payload.email } });
      if (dup) { await safeRollback(t); return res.status(409).json({ error: 'Email already in use.' }); }
    }

    await user.update(payload, { transaction: t });
    if (Array.isArray(roleIds)) await setUserRoles(user, roleIds, t);
    if (Array.isArray(branchIds) || typeof branchIds === 'number') await setUserBranches(user, branchIds, t);
    await t.commit();
    t.finished = t.finished || 'commit';

    const fresh = await User.findByPk(id, {
      include: buildIncludes({}),
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
    });
    res.json(sanitizeUser(fresh));
  } catch (err) {
    await safeRollback(t);
    console.error('updateUser error:', err);
    if (err.name === 'SequelizeValidationError') {
      return res.status(400).json({ error: err.errors?.[0]?.message || 'Validation error', details: err.errors });
    }
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
    const activeCol = resolveActiveColumn() || 'status';
    const meta = User.rawAttributes[activeCol];
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let next;
    if (meta?.type?.key === 'BOOLEAN') {
      const bodyVal = req.body[activeCol];
      if (typeof bodyVal === 'boolean') next = bodyVal;
      else if (typeof bodyVal === 'string') next = ['1','true','yes','active'].includes(bodyVal.toLowerCase());
      else next = !Boolean(user[activeCol]);
    } else {
      const current = (user[activeCol] || 'active').toString().toLowerCase();
      const bodyVal = (req.body[activeCol] || '').toString().toLowerCase();
      next = bodyVal ? bodyVal : (current === 'active' ? 'inactive' : 'active');
    }

    await user.update({ [activeCol]: next });
    res.json({ id: user.id, [activeCol]: next });
  } catch (err) {
    console.error('toggleStatus error:', err);
    res.status(400).json({ error: 'Failed to update status' });
  }
};

/* ------------------------- assignRoles ------------------------- */
/**
 * Accepts any of the following in body:
 * - roleIds: UUID[]
 * - roles / roleCodes: string[] of role codes (e.g., ["admin","manager"])
 * - add / remove: UUID[] (incremental)
 * - addCodes / removeCodes: string[] (incremental by code)
 * - branchIds: number[] | number (optional)
 */
exports.assignRoles = async (req, res) => {
  const t = await (sequelize?.transaction ? sequelize.transaction() : User.sequelize.transaction());
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) { await safeRollback(t); return res.status(404).json({ error: 'User not found' }); }
    if (!UserRole && typeof user.setRoles !== 'function') {
      await safeRollback(t);
      return res.status(501).json({ error: 'Role assignment not available' });
    }

    const {
      roleIds,
      roles: roleCodesRaw,
      roleCodes,
      add,
      remove,
      addCodes,
      removeCodes,
      branchIds,
    } = req.body || {};

    const codesFromBody = asArray(roleCodesRaw).concat(asArray(roleCodes)).map((s) => String(s).toLowerCase());
    const addCodesArr = asArray(addCodes).map((s) => String(s).toLowerCase());
    const removeCodesArr = asArray(removeCodes).map((s) => String(s).toLowerCase());

    // Resolve codes to IDs if Role has code
    const needsLookup = codesFromBody.length || addCodesArr.length || removeCodesArr.length;
    let codeMap = new Map();
    if (needsLookup && Role && hasAttr(Role, 'code')) {
      const want = [...new Set([...codesFromBody, ...addCodesArr, ...removeCodesArr])];
      if (want.length) {
        const found = await Role.findAll({ where: { code: want } });
        codeMap = new Map(found.map(r => [r.code, r.id]));
      }
    }

    const idsFromCodes = codesFromBody.map(c => codeMap.get(c)).filter(Boolean);
    const addFromCodes = addCodesArr.map(c => codeMap.get(c)).filter(Boolean);
    const removeFromCodes = removeCodesArr.map(c => codeMap.get(c)).filter(Boolean);

    const toAdd = new Set([...asArray(add), ...addFromCodes].filter(Boolean));
    const toRemove = new Set([...asArray(remove), ...removeFromCodes].filter(Boolean));

    // If explicit roleIds provided → replace mode
    if (Array.isArray(roleIds) || idsFromCodes.length) {
      const finalIds = Array.from(new Set([...(roleIds || []), ...idsFromCodes]));
      // validate
      if (finalIds.length) {
        const found = await Role.findAll({ where: { id: finalIds } });
        const foundIds = new Set(found.map(r => r.id));
        const missing = finalIds.filter(id => !foundIds.has(id));
        if (missing.length) { await safeRollback(t); return res.status(400).json({ error: 'Unknown role(s)', missing }); }
      }
      await setUserRoles(user, finalIds, t);
    } else if (toAdd.size || toRemove.size) {
      // incremental mode
      if (typeof user.addRoles === 'function' && typeof user.removeRoles === 'function') {
        if (toAdd.size)    await user.addRoles(Array.from(toAdd),    { transaction: t });
        if (toRemove.size) await user.removeRoles(Array.from(toRemove), { transaction: t });
      } else if (UserRole) {
        // infer column names
        const { roleId, userId } = await (async () => {
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
        })();

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
    t.finished = t.finished || 'commit';

    const fresh = await User.findByPk(user.id, {
      include: [{ model: Role, as: 'Roles', attributes: ['id', 'name'].concat(hasAttr(Role, 'code') ? ['code'] : []), through: { attributes: [] } }],
    });
    res.json(sanitizeUser(fresh));
  } catch (err) {
    await safeRollback(t);
    console.error('assignRoles error:', err);
    res.status(500).json({ error: 'Failed to assign roles' });
  }
};

/* ------------------------- deleteUser ------------------------- */
exports.deleteUser = async (req, res) => {
  const t = await (sequelize?.transaction ? sequelize.transaction() : User.sequelize.transaction());
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) { await safeRollback(t); return res.status(404).json({ error: 'User not found' }); }

    const force = ['1','true','yes'].includes(String(req.query.force||'').toLowerCase());
    const hard  = ['1','true','yes'].includes(String(req.query.hard ||'').toLowerCase());

    if (force) {
      if (UserRole) {
        const qi = sequelize.getQueryInterface();
        let userIdCol = 'userId';
        let roleIdCol = 'roleId';
        try {
          const desc = await qi.describeTable('UserRoles');
          userIdCol = desc.userId ? 'userId' : (desc.user_id ? 'user_id' : 'userId');
          roleIdCol = desc.roleId ? 'roleId' : (desc.role_id ? 'role_id' : 'roleId');
        } catch {}
        await UserRole.destroy({ where: { [userIdCol]: user.id }, transaction: t });
        // Optionally also clean branches
        if (UserBranch) {
          await UserBranch.destroy({ where: { userId: user.id }, transaction: t });
        }
      } else if (typeof user.setRoles === 'function') {
        await user.setRoles([], { transaction: t });
      }
    }

    await user.destroy({ force: hard, transaction: t });
    await t.commit();
    t.finished = t.finished || 'commit';
    res.json({ ok: true });
  } catch (err) {
    await safeRollback(t);
    console.error('deleteUser error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};
