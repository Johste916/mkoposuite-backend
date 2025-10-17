'use strict';

/**
 * Role model
 * - Adds a unique `code` used by auth middleware and RBAC checks.
 * - Auto-derives `code` from `name` if not provided (slug: lowercase, a–z0–9 and underscores).
 */

module.exports = (sequelize, DataTypes) => {
  const toCode = (value) => {
    if (!value) return value;
    return String(value)
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      || null;
  };

  const Role = sequelize.define(
    'Role',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

      code: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        set(val) {
          const normalized = toCode(val);
          if (!normalized) {
            const name = this.getDataValue('name');
            const fallback = toCode(name);
            this.setDataValue('code', fallback);
          } else {
            this.setDataValue('code', normalized);
          }
        },
      },

      name: {
        type: DataTypes.STRING(80),
        allowNull: false,
        unique: true,
        set(val) {
          const clean = (val ?? '').toString().trim();
          this.setDataValue('name', clean);
          if (!this.getDataValue('code')) {
            const derived = toCode(clean);
            this.setDataValue('code', derived);
          }
        },
      },

      description: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'Roles',
      timestamps: true,
      indexes: [
        { unique: true, fields: ['name'] },
        { unique: true, fields: ['code'], name: 'roles_code_unique' },
      ],
      hooks: {
        beforeValidate(role) {
          if (role.name) role.name = role.name.toString().trim();
          if (!role.code && role.name) role.code = toCode(role.name);
          if (role.code === '') role.code = null;
        },
      },
    }
  );

  Role.associate = (models) => {
    if (models.Permission && models.RolePermission) {
      Role.belongsToMany(models.Permission, {
        through: models.RolePermission,
        foreignKey: 'roleId',
        otherKey: 'permissionId',
        as: 'Permissions',
      });
    }
    if (models.User) {
      Role.belongsToMany(models.User, {
        through: models.UserRole || 'UserRoles',
        foreignKey: 'roleId',
        otherKey: 'userId',
        as: 'Users',
      });
    }
  };

  Role.findByCode = async function (code, options = {}) {
    return Role.findOne({ where: { code: toCode(code) }, ...options });
  };

  Role.prototype.toSafeJSON = function () {
    const { id, code, name, description, isSystem, createdAt, updatedAt } = this.get({ plain: true });
    return { id, code, name, description, isSystem, createdAt, updatedAt };
    };

  return Role;
};
