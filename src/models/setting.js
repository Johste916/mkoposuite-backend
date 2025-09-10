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
      ],
      hooks: {
        beforeValidate(instance) {
          if (typeof instance.key === 'string') instance.key = instance.key.trim();
        },
      },
    }
  );

  const nsKey = (key, tenantId) => {
    const cleanKey = String(key).trim();
    return tenantId ? `${String(tenantId)}:${cleanKey}` : cleanKey;
    // Example: 0000-...:signup.config
  };

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
      acc[k] = nk in map ? map[nk] : defaultsMap[k] ?? null;
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

  return Setting;
};
