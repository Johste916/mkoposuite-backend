'use strict';

const bcrypt = require('bcryptjs');
const { Op, QueryTypes } = require('sequelize');
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
const hasAttr = (model, attr) => !!(model?.rawAttributes?.[attr]);

const sanitizeUser = (u) => {
  if (!u) return u;
  const json = u.toJSON ? u.toJSON() : u;
  delete json.passwordHash; delete json.password_hash; delete json.password;
  return json;
};

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

const titleize = (s) => String(s || '')
  .replace(/[_\-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (c) => c.toUpperCase());

const asArray = (v) => Array.isArray(v) ? v : v == null ? [] : typeof v === 'string' ? [v] : [v];

const safeRollback = async (t) => {
  try {
    if (t && typeof t.rollback === 'function' && !t.finished) {
      await t.rollback();
    }
  } catch {}
};

/* ---------- include builders (still used by some endpoints) ---------- */
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

/* --------------------------------- GET /api/users ---------------------------------
   Return users with stable, denormalized role fields for the UI:
   - role_name / role_code (primary)
   - role_names[] / role_codes[]
   - role (legacy string = role_name)
----------------------------------------------------------------------------------- */
exports.getUsers = async (req, res) => {
  try {
    const { q = '', role, roleId, branchId, isActive, page = 1, limit = 200 } = req.query;

    // Paging
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(1000, Math.max(1, Number(limit) || 200));
    const offset = (pageNum - 1) * limitNum;

    // Filters
    const qpat = q ? `%${q}%` : '';
    const activeCol = resolveActiveColumn();
    const activeIsBool = activeCol && User.rawAttributes[activeCol]?.type?.key === 'BOOLEAN';
    const hasRoleCodeCol = hasAttr(Role, 'code');

    // If the UI passes ?role=loan_officer, filter by code if we have it, else by derived slug from name
    const roleCodeFilter = role ? String(role).toLowerCase() : null;
    const roleCodeExpr = hasRoleCodeCol
      ? 'LOWER(r.code)'
      : "LOWER(REGEXP_REPLACE(r.name, '[^a-zA-Z0-9]+', '_', 'g'))";

    // Active filter SQL and replacement
    let activeWhereSQL = '1=1';
    let activeRepl = {};
    if (typeof isActive !== 'undefined' && activeCol) {
      if (activeIsBool) {
        activeWhereSQL = `"${activeCol}" = :activeBool`;
        activeRepl = { activeBool: ['1','true','yes','active'].includes(String(isActive).toLowerCase()) };
      } else {
        activeWhereSQL = `"${activeCol}" = :activeStr`;
        activeRepl = { activeStr: ['1','true','yes','active'].includes(String(isActive).toLowerCase()) ? 'active' : 'inactive' };
      }
    }

    // Branch filter (works for Users.branchId only; extend if you support many-to-many branches in UI list)
    let branchWhereSQL = '1=1';
    let branchRepl = {};
    if (branchId) {
      const userBranchCol = pickFirstKey(User.rawAttributes, ['branchId', 'BranchId', 'branch_id']) || 'branchId';
      branchWhereSQL = `"${userBranchCol}" = :branchId`;
      branchRepl = { branchId: Number(branchId) };
    }

    // Role filter SQL
    let roleFilterSQL = '1=1';
    let roleRepl = {};
    if (roleId) {
      roleFilterSQL = 'r.id = :roleId';
      roleRepl = { roleId };
    } else if (roleCodeFilter) {
      roleFilterSQL = `${roleCodeExpr} = :roleCode`;
      roleRepl = { roleCode: roleCodeFilter };
    }

    // Main query: aggregate names and codes; pick a primary via order by a simple precedence
    // Precedence example: admin > director > manager > loan_officer > accountant > user > (others)
    // We compute primary in JS after fetching arrays.
    const rows = await sequelize.query(
      `
      WITH u AS (
        SELECT *
        FROM "Users"
        WHERE (:q = '' OR name ILIKE :qpat OR email ILIKE :qpat OR COALESCE(username,'') ILIKE :qpat)
          AND ${activeWhereSQL}
          AND ${branchWhereSQL}
      )
      SELECT
        u.id,
        COALESCE(u.name, '')   AS name,
        u.email,
        u.${activeCol ? `"${activeCol}"` : `'active'`} AS active_value,
        COALESCE(
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.id IS NOT NULL), NULL),
          '{}'
        ) AS role_names,
        COALESCE(
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT ${hasRoleCodeCol ? 'r.code' : "LOWER(REGEXP_REPLACE(r.name, '[^a-zA-Z0-9]+', '_', 'g'))"}) FILTER (WHERE r.id IS NOT NULL), NULL),
          '{}'
        ) AS role_codes
      FROM u
      LEFT JOIN "UserRoles" ur ON ur."userId" = u.id
      LEFT JOIN "Roles" r      ON r.id = ur."roleId"
      WHERE ${roleFilterSQL}
      GROUP BY u.id
      ORDER BY u.name NULLS LAST, u.email
      LIMIT :limitNum OFFSET :offset
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          q,
          qpat,
          limitNum,
          offset,
          ...activeRepl,
          ...branchRepl,
          ...roleRepl,
        },
      }
    );

    // Choose a primary role based on precedence, then fall back to first item.
    const precedence = [
      'admin', 'director', 'manager', 'loan_officer', 'accountant', 'user'
    ];

    const out = rows.map((r) => {
      const codes = Array.isArray(r.role_codes) ? r.role_codes : [];
      const names = Array.isArray(r.role_names) ? r.role_names : [];

      let primaryCode = null;
      for (const p of precedence) {
        if (codes.map(String).map(s => s.toLowerCase()).includes(p)) { primaryCode = p; break; }
      }
      if (!primaryCode) primaryCode = codes[0] || null;

      const idx = primaryCode ? codes.findIndex(c => String(c).toLowerCase() === String(primaryCode).toLowerCase()) : -1;
      const primaryName = idx >= 0 ? names[idx] : (names[0] || (primaryCode ? titleize(primaryCode) : null));

      return {
        id: r.id,
        name: r.name || (r.email ? String(r.email).split('@')[0] : null),
        email: r.email,
        // legacy compatibility + explicit display fields
        role: primaryName || null,
        role_name: primaryName || null,
        role_code: primaryCode || null,
        role_names: names,
        role_codes: codes,
      };
    });

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

    // Normalize for UI (single user view can keep the included roles)
    const json = sanitizeUser(user);
    const roles = Array.isArray(json.Roles) ? json.Roles : [];
    const codes = roles.map(r => r.code || (r.name ? r.name.toLowerCase().replace(/[^a-z0-9]+/g,'_') : null)).filter(Boolean);
    const names = roles.map(r => r.name).filter(Boolean);
    const role_name = names[0] || (codes[0] ? titleize(codes[0]) : json.role || null);
    const role_code = codes[0] || (json.role ? json.role.toLowerCase().replace(/[^a-z0-9]+/g,'_') : null);

    return res.json({
      ...json,
      role: role_name,
      role_name,
      role_code,
      role_names: names,
      role_codes: codes,
    });
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

    const errors = [];
    if (!rest.name) errors.push('Name is required.');
    if (!rest.email) errors.push('Email is required.');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rest.email)) errors.push('Email is invalid.');
    if (!rest.password) errors.push('Password is required.');
    else if (String(rest.password).length < 6) errors.push('Password must be at least 6 characters.');
    if (errors.length) { await safeRollback(t); return res.status(400).json({ error: errors[0], errors }); }

    const payload = await hashAndAssignPassword(rest);
    const existing = await User.findOne({ where: { email: payload.email } });
    if (existing) { await safeRollback(t); return res.status(409).json({ error: 'Email already in use.' }); }

    const user = await User.create(payload, { transaction: t });
    await setUserRoles(user, roleIds, t);
    await setUserBranches(user, branchIds, t);
    await t.commit();
    t.finished = t.finished || 'commit';

    // Return minimal normalized row
    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: null,
      role_name: null,
      role_code: null,
      role_names: [],
      role_codes: [],
    });
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

    // Keep response consistent (let list endpoint compute final role fields)
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: null,
      role_name: null,
      role_code: null,
      role_names: [],
      role_codes: [],
    });
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

    const hasCode = hasAttr(Role, 'code');
    let codeToId = new Map();
    const wanted = [...new Set([...codesReplace, ...codesAdd, ...codesRemove])];
    if (wanted.length) {
      const attrs = ['id', 'name'].concat(hasCode ? ['code'] : []);
      const all = await Role.findAll({ attributes: attrs });
      const keyOf = (r) => String((hasCode ? r.code : r.name) || '').toLowerCase();
      codeToId = new Map(all.map(r => [keyOf(r), r.id]));
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

    // Let the list endpoint compute display fields; here return minimal ok
    res.json({ ok: true, userId: user.id });
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
