// backend/src/models/setting.js
module.exports = (sequelize, DataTypes) => {
  // Pick JSON type based on dialect
  const JSON_TYPE =
    sequelize.getDialect && sequelize.getDialect() === 'postgres'
      ? DataTypes.JSONB
      : DataTypes.JSON;

  const Setting = sequelize.define(
    'Setting',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },

      key: {
        type: DataTypes.STRING(200),
        allowNull: false,
        unique: true,
        validate: {
          len: [2, 200],
          // allow letters, numbers, dots, dashes and underscores: e.g. "loan.reminders", "userManagement_defaultRole"
          is: /^[A-Za-z0-9._-]+$/i,
        },
      },

      value: {
        // JSONB on Postgres, JSON elsewhere
        type: JSON_TYPE,
        allowNull: false,
        defaultValue: {},
      },

      description: {
        type: DataTypes.STRING(500),
        allowNull: false,
        defaultValue: '',
      },

      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },

      updatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      timestamps: true,
      tableName: 'settings',
      indexes: [
        // Fast lookup by key (also enforced unique)
        { unique: true, fields: ['key'] },
        // Helpful when querying by value on Postgres
        ...(sequelize.getDialect() === 'postgres'
          ? [{ fields: ['value'], using: 'gin', name: 'settings_value_gin_idx' }]
          : []),
      ],
      hooks: {
        beforeValidate(instance) {
          if (typeof instance.key === 'string') {
            instance.key = instance.key.trim();
          }
        },
      },
    }
  );

  /* -----------------------------------------------------------
   * Convenience helpers (keep controllers thin & consistent)
   * --------------------------------------------------------- */

  /**
   * Get a settings blob by key, with optional defaults if missing.
   * @param {string} key
   * @param {any} defaults
   * @returns {Promise<any>}
   */
  Setting.get = async function get(key, defaults = {}) {
    const row = await Setting.findOne({ where: { key } });
    return row?.value ?? defaults;
  };

  /**
   * Get multiple keys at once (returns { key: value, ... }).
   * Missing keys fall back to `null` unless defaults provided.
   * @param {string[]} keys
   * @param {Record<string, any>} defaultsMap
   * @returns {Promise<Record<string, any>>}
   */
  Setting.getMany = async function getMany(keys = [], defaultsMap = {}) {
    if (!Array.isArray(keys) || keys.length === 0) return {};
    const rows = await Setting.findAll({ where: { key: keys } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return keys.reduce((acc, k) => {
      acc[k] = k in map ? map[k] : defaultsMap[k] ?? null;
      return acc;
    }, {});
  };

  /**
   * Set/replace a settings blob by key.
   * @param {string} key
   * @param {any} value
   * @param {string|null} updatedBy
   * @param {string|null} createdBy
   * @returns {Promise<any>}
   */
  Setting.set = async function set(key, value, updatedBy = null, createdBy = null) {
    const [row] = await Setting.upsert({
      key: String(key).trim(),
      value,
      updatedBy: updatedBy || null,
      createdBy: createdBy || null,
    });
    return row?.value ?? value;
  };

  /**
   * Merge patch into existing settings (shallow merge).
   * @param {string} key
   * @param {object} patch
   * @param {string|null} updatedBy
   * @returns {Promise<any>}
   */
  Setting.merge = async function merge(key, patch = {}, updatedBy = null) {
    const current = await Setting.get(key, {});
    const next = { ...(current || {}), ...(patch || {}) };
    const [row] = await Setting.upsert({
      key: String(key).trim(),
      value: next,
      updatedBy: updatedBy || null,
    });
    return row?.value ?? next;
  };

  return Setting;
};
