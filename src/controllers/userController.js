'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Role,
  Branch,
  UserRole,
  UserBranch,
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
const hasAttr = (model, attr) => !!(model?.rawAttributes?.[attr]);

const normalizeUserInput = (body = {}) => {
  const clean = { ...body };

  clean.name = clean.name || clean.fullName || clean.username || '';
  if (!clean.name && clean.email && typeof clean.email === 'string') {
    clean.name = clean.email.split('@')[0];
  }

  ['name', 'email', 'password', 'role'].forEach((k) => {
    if (clean[k] && typeof clean[k] === 'string') clean[k] = clean[k].trim();
  });

  return clean;
};

/* ---------- New: consistent display fields for FE ---------- */
const titleize = (s) => String(s || '')
  .replace(/[_\-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (c) => c.toUpperCase());

const withDisplayFields = (json) => {
  // Name fallback chain so the table never shows "—"
  const name =
    json.name ||
    json.fullName ||
    json.username ||
    (json.email ? String(json.email).split('@')[0] : null) ||
    null;

  // Roles
  const rolesArr  = Array.isArray(json.Roles) ? json.Roles : [];
  const roleCodes = rolesArr.map((r) => r.code || r.slug || r.name).filter(Boolean);
  const roleNames = rolesArr.map((r) => r.name).filter(Boolean);

  const primaryCode  = roleCodes[0] || json.role || null;
  const primaryLabel = (roleNames[0] || (primaryCode ? titleize(primaryCode) : null)) || null;

  return {
    ...json,
    name,
    role: primaryCode,       // machine-friendly (code/slug or legacy name)
    roleLabel: primaryLabel, // human label for the table
    roles: roleCodes,        // list of codes
    roleNames,               // list of human names
  };
};

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

  const userBranchFk = pickFirstKey(User.rawAttributes, ['branchId', 'BranchId', 'branch_id']);
  if (userBranchFk) {
    const first = Array.isArray(branchIds) ? branchIds[0] : branchIds;
    await user.update({ [userBranchFk]: first || null }, { transaction: t });
  }
};

// avoid double-hash & re-hash of an already-hashed value
const hashAndAssignPassword = async (payload) => {
  const pwCol = resolvePasswordHashColumn();
  if (!pwCol) return payload;
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
      if (attr?.type?.key === 'BOOLEAN') {
        where[activeCol] = truthy;
      } else {
        where[activeCol] = truthy ? 'active' : 'inactive';
      }
    }

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

    const out = rows.map((u) => withDisplayFields(sanitizeUser(u)));
    res.json(out);
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
    const json = sanitizeUser(user);
    return res.json(withDisplayFields(json));
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

    const payload = await hashAndAssignPassword(rest);

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

    const json = sanitizeUser(fresh);
    return res.status(201).json(withDisplayFields(json));
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
    const json = sanitizeUser(fresh);
    res.json(withDisplayFields(json));
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
 * - roleId: UUID (single)
 * - roleIds: UUID[]
 * - role / role_code: single role code
 * - roles / roleCodes: string[] of role codes
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
      roleId,
      roleIds,
      role,
      role_code,
      roles,
      roleCodes,
      add,
      remove,
      addCodes,
      removeCodes,
      branchIds,
    } = req.body || {};

    const codesReplace = [...asArray(role), ...asArray(role_code), ...asArray(roles), ...asArray(roleCodes)]
      .filter(Boolean).map(s => String(s).toLowerCase());
    const codesAdd    = asArray(addCodes).filter(Boolean).map(s => String(s).toLowerCase());
    const codesRemove = asArray(removeCodes).filter(Boolean).map(s => String(s).toLowerCase());

    // Resolve codes -> IDs.
    const hasCode = !!(Role?.rawAttributes?.code);
    let codeToId = new Map();
    const wanted = [...new Set([...codesReplace, ...codesAdd, ...codesRemove])];
    if (wanted.length) {
      const attrs = ['id', 'name'].concat(hasCode ? ['code'] : []);
      const all = await Role.findAll({ attributes: attrs });
      const makeKey = (r) => String((hasCode ? r.code : r.name) || '').toLowerCase();
      codeToId = new Map(all.map(r => [makeKey(r), r.id]));
    }

    const idsReplace = [
      ...asArray(roleId),
      ...asArray(roleIds),
      ...codesReplace.map(c => codeToId.get(c)).filter(Boolean),
    ];
    const idsAdd    = [...asArray(add),    ...codesAdd.map(c => codeToId.get(c)).filter(Boolean)];
    const idsRemove = [...asArray(remove), ...codesRemove.map(c => codeToId.get(c)).filter(Boolean)];

    const validateIds = async (ids) => {
      if (!ids?.length) return null;
      const found = await Role.findAll({ where: { id: ids } });
      const foundIds = new Set(found.map(r => r.id));
      const missing = ids.filter(id => !foundIds.has(id));
      return missing.length ? missing : null;
    };

    if (idsReplace.length) {
      const missing = await validateIds(idsReplace);
      if (missing) { await safeRollback(t); return res.status(400).json({ error: 'Unknown role(s)', missing }); }
      await setUserRoles(user, Array.from(new Set(idsReplace)), t);
    } else if (idsAdd.length || idsRemove.length) {
      const missingAdd = await validateIds(idsAdd);
      if (missingAdd) { await safeRollback(t); return res.status(400).json({ error: 'Unknown role(s)', missing: missingAdd }); }

      if (typeof user.addRoles === 'function' && typeof user.removeRoles === 'function') {
        if (idsAdd.length)    await user.addRoles(idsAdd,    { transaction: t });
        if (idsRemove.length) await user.removeRoles(idsRemove, { transaction: t });
      } else if (UserRole) {
        const { roleId: roleIdCol, userId: userIdCol } = await (async () => {
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

        if (idsAdd.length) {
          await UserRole.bulkCreate(
            idsAdd.map(rid => ({ [userIdCol]: user.id, [roleIdCol]: rid })),
            { transaction: t, ignoreDuplicates: true }
          );
        }
        if (idsRemove.length) {
          await UserRole.destroy({ where: { [userIdCol]: user.id, [roleIdCol]: idsRemove }, transaction: t });
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

    const json = sanitizeUser(fresh);
    return res.json(withDisplayFields(json));
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
