// backend/src/controllers/admin/staffController.js
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, Role, Branch, UserRole } = require('../../models');

/* ---------------------------- helpers ---------------------------- */

const pickFirstKey = (attrs, keys) =>
  keys.find((k) => attrs && Object.prototype.hasOwnProperty.call(attrs, k));

const activeColumn = () =>
  pickFirstKey(User.rawAttributes, ['isActive', 'active', 'enabled', 'status']);

const passwordHashColumn = () =>
  pickFirstKey(User.rawAttributes, ['passwordHash', 'password_hash', 'password']);

const sanitizeUser = (u) => {
  if (!u) return u;
  const j = u.toJSON ? u.toJSON() : u;
  delete j.password;
  delete j.passwordHash;
  delete j.password_hash;
  return j;
};

const hashPasswordOnto = async (payload) => {
  const pwCol = passwordHashColumn();
  if (!pwCol) return payload;
  const raw = payload.password ?? payload[pwCol];
  if (!raw) return payload;

  const hash = await bcrypt.hash(String(raw), 10);
  const out = { ...payload };
  delete out.password;
  delete out.passwordHash;
  delete out.password_hash;
  out[pwCol] = hash;
  return out;
};

/* ------------------------------ controllers ------------------------------ */
/**
 * GET /api/admin/staff
 * Query: q, roleId, branchId, isActive, page, limit
 *
 * Your associations (from models/index.js):
 * - User.belongsTo(Branch, { foreignKey: 'branchId' })  // single branch
 * - User.belongsToMany(Role, { through: UserRole, as: 'Roles' })
 */
exports.list = async (req, res) => {
  try {
    const {
      q = '',
      roleId,
      branchId,
      isActive,
      page = 1,
      limit = 20,
    } = req.query;

    const where = {};

    // search
    if (q) {
      where[Op.or] = [
        { fullName: { [Op.iLike]: `%${q}%` } },
        { name:     { [Op.iLike]: `%${q}%` } },
        { email:    { [Op.iLike]: `%${q}%` } },
        { username: { [Op.iLike]: `%${q}%` } },
        { phone:    { [Op.iLike]: `%${q}%` } },
      ];
    }

    // status
    const activeCol = activeColumn();
    if (activeCol && typeof isActive !== 'undefined') {
      where[activeCol] = String(isActive) === 'true';
    }

    // branch filter (belongsTo)
    if (branchId) where.branchId = Number(branchId);

    const pageNum  = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 20));
    const offset   = (pageNum - 1) * limitNum;

    const { rows, count } = await User.findAndCountAll({
      where,
      include: [
        {
          model: Role,
          as: 'Roles',
          attributes: ['id', 'name'],
          through: { attributes: [] },
          required: !!roleId,
          ...(roleId ? { where: { id: Number(roleId) } } : {}),
        },
        {
          // belongsTo — no alias specified in your association, so don't pass `as`
          model: Branch,
          attributes: ['id', 'name', 'code'],
          required: false,
        },
      ],
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset,
      distinct: true, // safe with Roles M2M
    });

    res.json({
      data: rows.map(sanitizeUser),
      meta: { page: pageNum, limit: limitNum, total: count },
    });
  } catch (err) {
    console.error('admin.staff.list error:', err);
    res.status(500).json({ error: 'Unable to list staff' });
  }
};

/** GET /api/admin/staff/:id */
exports.getById = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [
        { model: Role, as: 'Roles', attributes: ['id', 'name'], through: { attributes: [] } },
        { model: Branch, attributes: ['id', 'name', 'code'] },
      ],
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUser(user));
  } catch (err) {
    console.error('admin.staff.getById error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

/** POST /api/admin/staff */
exports.create = async (req, res) => {
  const t = await User.sequelize.transaction();
  try {
    const { roleIds = [], ...rest } = req.body || {};
    const payload = await hashPasswordOnto(rest);

    const user = await User.create(payload, { transaction: t });

    // roles (M2M)
    if (Array.isArray(roleIds)) {
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
    }

    await t.commit();

    const fresh = await User.findByPk(user.id, {
      include: [
        { model: Role, as: 'Roles', attributes: ['id', 'name'], through: { attributes: [] } },
        { model: Branch, attributes: ['id', 'name', 'code'] },
      ],
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
    });

    res.status(201).json(sanitizeUser(fresh));
  } catch (err) {
    await t.rollback();
    console.error('admin.staff.create error:', err);
    res.status(400).json({ error: 'Failed to create user' });
  }
};

/** PUT /api/admin/staff/:id */
exports.update = async (req, res) => {
  const t = await User.sequelize.transaction();
  try {
    const { id } = req.params;
    const { roleIds, password, ...rest } = req.body || {};

    const user = await User.findByPk(id);
    if (!user) {
      await t.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    const payload = password ? await hashPasswordOnto({ ...rest, password }) : rest;
    await user.update(payload, { transaction: t });

    if (Array.isArray(roleIds)) {
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
    }

    await t.commit();

    const fresh = await User.findByPk(id, {
      include: [
        { model: Role, as: 'Roles', attributes: ['id', 'name'], through: { attributes: [] } },
        { model: Branch, attributes: ['id', 'name', 'code'] },
      ],
      attributes: { exclude: ['password', 'passwordHash', 'password_hash'] },
    });

    res.json(sanitizeUser(fresh));
  } catch (err) {
    await t.rollback();
    console.error('admin.staff.update error:', err);
    res.status(400).json({ error: 'Failed to update user' });
  }
};

/** PATCH /api/admin/staff/:id/password */
exports.resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const payload = await hashPasswordOnto({ password });
    await user.update(payload);

    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('admin.staff.resetPassword error:', err);
    res.status(400).json({ error: 'Failed to reset password' });
  }
};

/** PATCH /api/admin/staff/:id/status */
exports.toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const col = activeColumn();
    if (!col) return res.status(400).json({ error: 'Active/status column not found on User model' });

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const next = typeof req.body[col] === 'boolean' ? req.body[col] : !user[col];
    await user.update({ [col]: next });

    res.json({ id: user.id, [col]: next });
  } catch (err) {
    console.error('admin.staff.toggleStatus error:', err);
    res.status(400).json({ error: 'Failed to update status' });
  }
};
