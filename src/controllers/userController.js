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
const pickFirstKey = (obj, keys) =>
  keys.find((k) => obj && Object.prototype.hasOwnProperty.call(obj, k));

const resolveActiveColumn = () =>
  pickFirstKey(User.rawAttributes, ['status', 'isActive', 'active', 'enabled']); // prefer 'status'

const resolvePasswordHashColumn = () =>
  pickFirstKey(User.rawAttributes, ['passwordHash', 'password_hash', 'password']);

const sanitizeUser = (u) => {
  if (!u) return u;
  const json = u.toJSON ? u.toJSON() : u;
  delete json.passwordHash;
  delete json.password_hash;
  delete json.password;
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

const titleize = (s) =>
  String(s || '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/* canonical code from name (e.g., "Loan Officer" -> "loan_officer") */
const toCode = (v) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || null;

const asArrayTop = (v) =>
  Array.isArray(v) ? v : v == null ? [] : typeof v === 'string' ? [v] : [v];

/* ---------- build a rich set of role fields for the UI ---------- */
const withDisplayFields = (json) => {
  const name =
    json.name ||
    json.fullName ||
    json.username ||
    (json.email ? String(json.email).split('@')[0] : null) ||
    null;

  const rolesArr = Array.isArray(json.Roles) ? json.Roles : [];
  const roleNames = rolesArr.map((r) => r.name).filter(Boolean);
  // Prefer explicit code; otherwise derive from name so UI always has a code
  const roleCodes = rolesArr
    .map((r) => r.code || r.slug || toCode(r.name))
    .filter(Boolean);

  const primaryCode =
    roleCodes[0] ||
    (json.role ? toCode(json.role) : null) || // legacy Users.role
    null;

  const primaryName =
    roleNames[0] ||
    (json.role ? titleize(json.role) : null) ||
    null;

  const roleLabel = primaryName || (primaryCode ? titleize(primaryCode) : null);
  const roleDisplay = roleLabel || primaryCode || null;

  return {
    ...json,
    name,
    // canonical single values
    role: primaryCode,          // filter-friendly (loan_officer)
    role_code: primaryCode,
    role_name: roleLabel,       // pretty label (“Loan Officer”)
    role_display: roleDisplay,
    // arrays + csv mirrors
    roles: roleCodes,
    roleCodes: roleCodes,
    roleNames: roleNames,
    role_codes: roleCodes.join(','),
    role_names: roleNames.join(','),
    // legacy-ish mirrors
    roleLabel,
    roleName: roleLabel,
  };
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

/* ---------- include builders ---------- */
const buildIncludes = ({ roleId, roleCode, branchId }) => {
  const asns = User.associations || {};
  const includes = [];

  if (Role) {
    const roleAssoc =
      asns.roles ||
      asns.Roles ||
      asns.role ||
      asns.Role ||
      Object.values(asns).find((a) => a.target && a.target.name === Role.name);
    if (roleAssoc) {
      const isBTM = roleAssoc.associationType === 'BelongsToMany';
      const roleAttrs = ['id', 'name'].concat(hasAttr(Role, 'code') ? ['code'] : []);
      const inc = {
        model: Role,
        as: roleAssoc.as,
        attributes: roleAttrs,
        required: !!(roleId || roleCode),
      };
      if (isBTM) inc.through = { attributes: [] };
      if (roleId) inc.where = { ...(inc.where || {}), id: roleId };
      if (roleCode && hasAttr(Role, 'code'))
        inc.where = { ...(inc.where || {}), code: String(roleCode).toLowerCase() };
      includes.push(inc);
    }
  }

  if (Branch) {
    const branchAssoc =
      asns.branches ||
      asns.Branches ||
      asns.branch ||
      asns.Branch ||
      Object.values(asns).find((a) => a.target && a.target.name === Branch.name);
    if (branchAssoc) {
      const isBTM = branchAssoc.associationType === 'BelongsToMany';
      const inc = {
        model: Branch,
        as: branchAssoc.as,
        attributes: ['id', 'name', 'code'],
        required: !!branchId,
      };
      if (isBTM) inc.through = { attributes: [] };
      if (branchId) inc.where = { id: branchId };
      includes.push(inc);
    }
  }

  return includes;
};

/* ---------- role/branch setters ---------- */
const setUserRoles = async (user, roleIds, t) => {
  if (!Array.isArray(roleIds)) return;
  if (typeof user.setRoles === 'function') {
    await user.setRoles(roleIds, { transaction: t });
  } else if (UserRole) {
    await UserRole.destroy({ where: { userId: user.id }, transaction: t });
    if (roleIds.length) {
      await UserRole.bulkCreate(
        roleIds.map((roleId) => ({ userId: user.id, roleId })),
        { transaction: t }
      );
    }
  }
};

const setUserBranches = async (user, branchIds, t) => {
  if (branchIds == null) return;
  const asns = User.associations || {};
  const branchAssoc =
    asns.branches ||
    asns.Branches ||
    asns.branch ||
    asns.Branch ||
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
        await UserBranch.bulkCreate(
          list.map((branchId) => ({ userId: user.id, branchId })),
          { transaction: t }
        );
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

/* ---------- password hashing ---------- */
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

const safeRollback = async (t) => {
  try {
    if (t && typeof t.rollback === 'function' && !t.finished) {
      await t.rollback();
    }
  } catch {}
};

/* ---------- fallback: hydrate roles if include missed ---------- */
const hydrateRolesForUsers = async (users) => {
  try {
    const ids = users
      .map((u) => u.id || (u.get ? u.get('id') : null))
      .filter(Boolean);
    if (!ids.length || !sequelize) return;

    const rows = await sequelize.query(
      `
      SELECT ur."userId" as "userId",
             r.id        as "id",
             r.name      as "name",
             ${hasAttr(Role, 'code') ? 'r.code as "code",' : 'NULL as "code",'}
             ROW_NUMBER() OVER (PARTITION BY ur."userId" ORDER BY r.name) as rn
      FROM "UserRoles" ur
      JOIN "Roles" r ON r.id = ur."roleId"
      WHERE ur."userId" IN (:ids)
      `,
      { replacements: { ids }, type: QueryTypes.SELECT }
    );

    const map = new Map();
    for (const r of rows) {
      const list = map.get(r.userId) || [];
      list.push({ id: r.id, name: r.name, code: r.code || toCode(r.name) });
      map.set(r.userId, list);
    }

    for (const u of users) {
      const uid = u.id || (u.get ? u.get('id') : null);
      if (!uid) continue;
      const has = u.Roles && Array.isArray(u.Roles) && u.Roles.length > 0;
      if (!has) {
        const roles = map.get(uid) || [];
        if (u.setDataValue) u.setDataValue('Roles', roles);
        else u.Roles = roles;
      }
    }
  } catch {
    // best-effort
  }
};

/* ---------- raw SQL list fallback (applies same filters) ---------- */
const rawListUsers = async ({
  q = '',
  limitNum = 200,
  offset = 0,
  roleId,
  roleCodeFilter,
  activeCol,
  activeIsBool,
  activeValue,
  branchCol,
  branchId,
}) => {
  const qpat = q ? `%${q}%` : '';

  const hasCode = hasAttr(Role, 'code');
  const roleCodeExpr = hasCode
    ? 'LOWER(r.code)'
    : "LOWER(REGEXP_REPLACE(r.name, '[^a-zA-Z0-9]+', '_', 'g'))";

  const activeSQL = activeCol
    ? (activeIsBool ? `"${activeCol}" = :activeValue` : `"${activeCol}" = :activeValue`)
    : '1=1';

  const branchSQL = branchCol && branchId != null ? `"${branchCol}" = :branchId` : '1=1';

  const roleFilterSQL = roleId
    ? 'r.id = :roleId'
    : roleCodeFilter
      ? `${roleCodeExpr} = :roleCode`
      : '1=1';

  const rows = await sequelize.query(
    `
    SELECT
      u.id,
      COALESCE(u.name, '') AS name,
      u.email,
      u.role AS legacy_role,
      COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.id IS NOT NULL), NULL), '{}') AS role_names_array,
      COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT ${hasCode ? 'r.code' : "LOWER(REGEXP_REPLACE(r.name,'[^a-zA-Z0-9]+','_','g'))"}) FILTER (WHERE r.id IS NOT NULL), NULL), '{}')
        AS role_codes_array
    FROM "Users" u
    LEFT JOIN "UserRoles" ur ON ur."userId" = u.id
    LEFT JOIN "Roles" r      ON r.id        = ur."roleId"
    WHERE (:q = '' OR u.name ILIKE :qpat OR u.email ILIKE :qpat)
      AND ${activeSQL}
      AND ${branchSQL}
      AND ${roleFilterSQL}
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
        roleId,
        roleCode: roleCodeFilter || null,
        activeValue: activeCol ? (activeIsBool ? Boolean(activeValue) : activeValue) : null,
        branchId: branchId ?? null,
      },
    }
  );

  return rows.map((r) => {
    const Roles = (r.role_names_array || []).map((name, i) => ({
      id: null,
      name,
      code: (r.role_codes_array || [])[i] || toCode(name),
    }));
    const base = {
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.legacy_role ? toCode(r.legacy_role) : null,
      Roles,
    };
    const json = sanitizeUser(base);
    return withDisplayFields(json);
  });
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
    let activeIsBool = false;
    if (typeof isActive !== 'undefined' && activeCol) {
      const attr = User.rawAttributes[activeCol];
      const truthy = ['1', 'true', 'yes', 'active'].includes(String(isActive).toLowerCase());
      if (attr?.type?.key === 'BOOLEAN') {
        activeIsBool = true;
        where[activeCol] = truthy;
      } else {
        where[activeCol] = truthy ? 'active' : 'inactive';
      }
    }

    const roleCode = role ? toCode(role) : null;
    if (!roleId && !roleCode && role) where.role = toCode(role); // legacy fallback

    const include = buildIncludes({ roleId, roleCode, branchId });

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(1000, Math.max(1, Number(limit) || 200));
    const offset = (pageNum - 1) * limitNum;

    try {
      // ORM path
      const { rows } = await User.findAndCountAll({
        where,
        include,
        attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
        order: [['name', 'ASC']],
        limit: limitNum,
        offset,
        distinct: true,
      });

      await hydrateRolesForUsers(rows);
      const out = rows.map((u) => withDisplayFields(sanitizeUser(u)));
      return res.json(out);
    } catch (ormErr) {
      // Fallback if eager-loading/associations fail
      console.warn('getUsers: ORM include failed, using raw fallback →', ormErr.message);

      const branchCol = pickFirstKey(User.rawAttributes, ['branchId', 'BranchId', 'branch_id']) || null;
      const out = await rawListUsers({
        q,
        limitNum,
        offset,
        roleId,
        roleCodeFilter: roleCode,
        activeCol,
        activeIsBool,
        activeValue:
          typeof isActive !== 'undefined'
            ? (activeIsBool
                ? ['1', 'true', 'yes', 'active'].includes(String(isActive).toLowerCase())
                : (['1', 'true', 'yes', 'active'].includes(String(isActive).toLowerCase()) ? 'active' : 'inactive'))
            : null,
        branchCol,
        branchId: branchId != null ? Number(branchId) : null,
      });
      return res.json(out);
    }
  } catch (err) {
    console.error('getUsers fatal error:', err);
    return res.status(500).json({ error: 'Failed to list users' });
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

    await hydrateRolesForUsers([user]);
    const json = sanitizeUser(user);
    return res.json(withDisplayFields(json));
  } catch (err) {
    console.error('getUserById error:', err);
    return res.status(500).json({ error: 'Failed to fetch user' });
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

    await hydrateRolesForUsers([fresh]);

    const json = sanitizeUser(fresh);
    return res.status(201).json(withDisplayFields(json));
  } catch (err) {
    await safeRollback(t);
    console.error('createUser error:', err);
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Email already in use.' });
    }
    if (err.name === 'SequelizeValidationError') {
      return res
        .status(400)
        .json({ error: err.errors?.[0]?.message || 'Validation error', details: err.errors });
    }
    return res.status(400).json({ error: 'Failed to create user' });
  }
};

exports.updateUser = async (req, res) => {
  const t = await (sequelize?.transaction ? sequelize.transaction() : User.sequelize.transaction());
  try {
    const { id } = req.params;
    const { roleIds, branchIds, password, ...restRaw } = req.body || {};
    const rest = normalizeUserInput(restRaw);

    const user = await User.findByPk(id);
    if (!user) {
      await safeRollback(t);
      return res.status(404).json({ error: 'User not found' });
    }

    const payload = password ? await hashAndAssignPassword({ ...rest, password }) : rest;

    if (payload.email && payload.email !== user.email) {
      const dup = await User.findOne({ where: { email: payload.email } });
      if (dup) {
        await safeRollback(t);
        return res.status(409).json({ error: 'Email already in use.' });
      }
    }

    await user.update(payload, { transaction: t });
    if (Array.isArray(roleIds)) await setUserRoles(user, roleIds, t);
    if (Array.isArray(branchIds) || typeof branchIds === 'number')
      await setUserBranches(user, branchIds, t);
    await t.commit();
    t.finished = t.finished || 'commit';

    const fresh = await User.findByPk(id, {
      include: buildIncludes({}),
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
    });

    await hydrateRolesForUsers([fresh]);

    const json = sanitizeUser(fresh);
    return res.json(withDisplayFields(json));
  } catch (err) {
    await safeRollback(t);
    console.error('updateUser error:', err);
    if (err.name === 'SequelizeValidationError') {
      return res
        .status(400)
        .json({ error: err.errors?.[0]?.message || 'Validation error', details: err.errors });
    }
    return res.status(400).json({ error: 'Failed to update user' });
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
    return res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(400).json({ error: 'Failed to reset password' });
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
      else if (typeof bodyVal === 'string')
        next = ['1', 'true', 'yes', 'active'].includes(bodyVal.toLowerCase());
      else next = !Boolean(user[activeCol]);
    } else {
      const current = (user[activeCol] || 'active').toString().toLowerCase();
      const bodyVal = (req.body[activeCol] || '').toString().toLowerCase();
      next = bodyVal ? bodyVal : current === 'active' ? 'inactive' : 'active';
    }

    await user.update({ [activeCol]: next });
    return res.json({ id: user.id, [activeCol]: next });
  } catch (err) {
    console.error('toggleStatus error:', err);
    return res.status(400).json({ error: 'Failed to update status' });
  }
};

/* ------------------------- assignRoles ------------------------- */
exports.assignRoles = async (req, res) => {
  const t = await (sequelize?.transaction ? sequelize.transaction() : User.sequelize.transaction());
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      await safeRollback(t);
      return res.status(404).json({ error: 'User not found' });
    }
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

    const asArray = asArrayTop;

    const codesReplace = [...asArray(role), ...asArray(role_code), ...asArray(roles), ...asArray(roleCodes)]
      .filter(Boolean)
      .map((s) => toCode(s));
    const codesAdd = asArray(addCodes).filter(Boolean).map((s) => toCode(s));
    const codesRemove = asArray(removeCodes).filter(Boolean).map((s) => toCode(s));

    // Resolve codes -> IDs
    const hasCode = !!(Role?.rawAttributes?.code);
    let codeToId = new Map();
    const wanted = [...new Set([...codesReplace, ...codesAdd, ...codesRemove])];
    if (wanted.length) {
      const attrs = ['id', 'name'].concat(hasAttr(Role, 'code') ? ['code'] : []);
      const all = await Role.findAll({ attributes: attrs });
      const keyOf = (r) => (hasCode ? r.code : toCode(r.name));
      codeToId = new Map(all.map((r) => [keyOf(r), r.id]));
    }

    const idsReplace = [
      ...asArray(roleId),
      ...asArray(roleIds),
      ...codesReplace.map((c) => codeToId.get(c)).filter(Boolean),
    ];
    const idsAdd = [...asArray(add), ...codesAdd.map((c) => codeToId.get(c)).filter(Boolean)];
    const idsRemove = [...asArray(remove), ...codesRemove.map((c) => codeToId.get(c)).filter(Boolean)];

    const validateIds = async (ids) => {
      if (!ids?.length) return null;
      const found = await Role.findAll({ where: { id: ids } });
      const foundIds = new Set(found.map((r) => r.id));
      const missing = ids.filter((id) => !foundIds.has(id));
      return missing.length ? missing : null;
    };

    if (idsReplace.length) {
      const missing = await validateIds(idsReplace);
      if (missing) {
        await safeRollback(t);
        return res.status(400).json({ error: 'Unknown role(s)', missing });
      }
      await setUserRoles(user, Array.from(new Set(idsReplace)), t);
    } else if (idsAdd.length || idsRemove.length) {
      const missingAdd = await validateIds(idsAdd);
      if (missingAdd) {
        await safeRollback(t);
        return res.status(400).json({ error: 'Unknown role(s)', missing: missingAdd });
      }

      if (typeof user.addRoles === 'function' && typeof user.removeRoles === 'function') {
        if (idsAdd.length) await user.addRoles(idsAdd, { transaction: t });
        if (idsRemove.length) await user.removeRoles(idsRemove, { transaction: t });
      } else if (UserRole) {
        const { roleId: roleIdCol, userId: userIdCol } = await (async () => {
          const defaults = { roleId: 'roleId', userId: 'userId' };
          try {
            const qi = sequelize.getQueryInterface();
            const desc = await qi.describeTable('UserRoles');
            const roleId = desc.roleId ? 'roleId' : desc.role_id ? 'role_id' : defaults.roleId;
            const userId = desc.userId ? 'userId' : desc.user_id ? 'user_id' : defaults.userId;
            return { roleId, userId };
          } catch {
            return defaults;
          }
        })();

        if (idsAdd.length) {
          await UserRole.bulkCreate(
            idsAdd.map((rid) => ({ [userIdCol]: user.id, [roleIdCol]: rid })),
            { transaction: t, ignoreDuplicates: true }
          );
        }
        if (idsRemove.length) {
          await UserRole.destroy({
            where: { [userIdCol]: user.id, [roleIdCol]: idsRemove },
            transaction: t,
          });
        }
      }
    }

    if (typeof branchIds !== 'undefined') {
      await setUserBranches(user, branchIds, t);
    }

    await t.commit();
    t.finished = t.finished || 'commit';

    const fresh = await User.findByPk(user.id, {
      include: [
        {
          model: Role,
          as: 'Roles',
          attributes: ['id', 'name'].concat(hasAttr(Role, 'code') ? ['code'] : []),
          through: { attributes: [] },
        },
      ],
    });

    await hydrateRolesForUsers([fresh]);
    const json = sanitizeUser(fresh);
    return res.json(withDisplayFields(json));
  } catch (err) {
    await safeRollback(t);
    console.error('assignRoles error:', err);
    return res.status(500).json({ error: 'Failed to assign roles' });
  }
};

/* ------------------------- deleteUser ------------------------- */
exports.deleteUser = async (req, res) => {
  const t = await (sequelize?.transaction ? sequelize.transaction() : User.sequelize.transaction());
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      await safeRollback(t);
      return res.status(404).json({ error: 'User not found' });
    }

    const force = ['1', 'true', 'yes'].includes(String(req.query.force || '').toLowerCase());
    const hard = ['1', 'true', 'yes'].includes(String(req.query.hard || '').toLowerCase());

    if (force) {
      if (UserRole) {
        const qi = sequelize.getQueryInterface();
        let userIdCol = 'userId';
        let roleIdCol = 'roleId';
        try {
          const desc = await qi.describeTable('UserRoles');
          userIdCol = desc.userId ? 'userId' : desc.user_id ? 'user_id' : 'userId';
          roleIdCol = desc.roleId ? 'roleId' : desc.role_id ? 'role_id' : 'roleId';
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
    return res.json({ ok: true });
  } catch (err) {
    await safeRollback(t);
    console.error('deleteUser error:', err);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
};
