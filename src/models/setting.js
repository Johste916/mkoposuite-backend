module.exports = (sequelize, DataTypes) => {
  const JSON_TYPE =
    sequelize.getDialect && sequelize.getDialect() === 'postgres'
      ? DataTypes.JSONB
      : DataTypes.JSON;

  const Setting = sequelize.define(
    'Setting',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      key: {
        type: DataTypes.STRING(200),
        allowNull: false,
        unique: true,
        validate: { len: [2, 200], is: /^[A-Za-z0-9._-]+$/i },
      },
      value: { type: JSON_TYPE, allowNull: false, defaultValue: {} },
      description: { type: DataTypes.STRING(500), allowNull: false, defaultValue: '' },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
    },
    {
      timestamps: true,
      tableName: 'settings',
      indexes: [
        { unique: true, fields: ['key'] },
        ...(sequelize.getDialect() === 'postgres'
          ? [{ fields: ['value'], using: 'gin', name: 'settings_value_gin_idx' }]
          : []),
        { fields: ['updatedAt'], name: 'settings_updated_at_idx' },
      ],
      hooks: {
        beforeValidate(instance) {
          if (typeof instance.key === 'string') instance.key = instance.key.trim();
        },
      },
    }
  );

  /* ---------------------- Namespacing helpers (tenant) --------------------- */
  const nsKey = (key, tenantId) => {
    const cleanKey = String(key).trim();
    return tenantId ? `${String(tenantId)}:${cleanKey}` : cleanKey;
    // Example: 0000-...:signup.config
  };
  const stripNs = (fullKey, tenantId) => {
    if (!tenantId) return fullKey;
    const prefix = `${tenantId}:`;
    return fullKey.startsWith(prefix) ? fullKey.slice(prefix.length) : fullKey;
  };

  /* --------------------------------- CRUD ---------------------------------- */
  Setting.get = async function get(key, defaults = {}, opts = {}) {
    const row = await Setting.findOne({ where: { key: nsKey(key, opts.tenantId) } });
    return row?.value ?? defaults;
  };

  Setting.getMany = async function getMany(keys = [], defaultsMap = {}, opts = {}) {
    if (!Array.isArray(keys) || keys.length === 0) return {};
    const namespaced = keys.map(k => nsKey(k, opts.tenantId));
    const rows = await Setting.findAll({ where: { key: namespaced } });
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return keys.reduce((acc, k) => {
      const nk = nsKey(k, opts.tenantId);
      acc[k] = nk in map ? map[nk] : (defaultsMap[k] ?? null);
      return acc;
    }, {});
  };

  Setting.set = async function set(key, value, opts = {}) {
    const { updatedBy = null, createdBy = null, tenantId } = opts || {};
    const [row] = await Setting.upsert({
      key: nsKey(key, tenantId),
      value,
      updatedBy,
      createdBy,
    });
    return row?.value ?? value;
  };

  Setting.setMany = async function setMany(map = {}, opts = {}) {
    const { updatedBy = null, createdBy = null, tenantId } = opts || {};
    const t = await sequelize.transaction();
    try {
      const entries = Object.entries(map);
      for (const [key, value] of entries) {
        await Setting.upsert({
          key: nsKey(key, tenantId),
          value,
          updatedBy,
          createdBy,
        }, { transaction: t });
      }
      await t.commit();
      return { ok: true, count: Object.keys(map).length };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  };

  Setting.merge = async function merge(key, patch = {}, opts = {}) {
    const { updatedBy = null, tenantId } = opts || {};
    const current = await Setting.get(key, {}, { tenantId });
    const next = { ...(current || {}), ...(patch || {}) };
    const [row] = await Setting.upsert({
      key: nsKey(key, tenantId),
      value: next,
      updatedBy,
    });
    return row?.value ?? next;
  };

  Setting.mergeMany = async function mergeMany(map = {}, opts = {}) {
    const { updatedBy = null, tenantId } = opts || {};
    const t = await sequelize.transaction();
    try {
      const keys = Object.keys(map);
      if (keys.length === 0) { await t.commit(); return { ok: true, count: 0 }; }
      const namespaced = keys.map(k => nsKey(k, tenantId));
      const rows = await Setting.findAll({ where: { key: namespaced }, transaction: t });
      const byKey = new Map(rows.map(r => [r.key, r]));
      for (const k of keys) {
        const nk = nsKey(k, tenantId);
        const cur = byKey.get(nk)?.value || {};
        const next = { ...(cur || {}), ...(map[k] || {}) };
        await Setting.upsert({ key: nk, value: next, updatedBy }, { transaction: t });
      }
      await t.commit();
      return { ok: true, count: keys.length };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  };

  Setting.remove = async function remove(key, opts = {}) {
    const { tenantId } = opts || {};
    await Setting.destroy({ where: { key: nsKey(key, tenantId) } });
    return true;
  };

  // List all keys for a tenant, optionally by prefix (prefix is *un-namespaced*).
  Setting.list = async function list(prefix = '', opts = {}) {
    const { tenantId } = opts || {};
    const where = {};
    if (tenantId) {
      if (prefix) {
        where.key = { [sequelize.Sequelize.Op.like]: `${tenantId}:${prefix}%` };
      } else {
        where.key = { [sequelize.Sequelize.Op.like]: `${tenantId}:%` };
      }
    } else if (prefix) {
      where.key = { [sequelize.Sequelize.Op.like]: `${prefix}%` };
    }
    const rows = await Setting.findAll({
      where,
      order: [['updatedAt', 'DESC']],
      attributes: ['key', 'value', 'updatedAt', 'createdAt'],
    });
    return rows.map(r => ({
      key: stripNs(r.key, tenantId),
      value: r.value,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    }));
  };

  return Setting;
};
