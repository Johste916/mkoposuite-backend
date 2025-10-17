'use strict';

module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define(
    'Role',
    {
      id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name:       { type: DataTypes.STRING(120), allowNull: false, unique: true },
      description:{ type: DataTypes.TEXT, allowNull: true, defaultValue: '' },
      isSystem:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_system' },
    },
    {
      tableName: 'roles',
      underscored: true,
      timestamps: true,
      indexes: [{ unique: true, fields: ['name'] }],
    }
  );

  Role.associate = (models) => {
    // Users: primary role (users.role_id)
    if (models.User) {
      Role.hasMany(models.User, { foreignKey: 'roleId', sourceKey: 'id', as: 'primaryUsers' });
      Role.belongsToMany(models.User, {
        through: models.UserRole || 'user_roles',
        foreignKey: 'roleId',
        otherKey: 'userId',
        as: 'users',
      });
    }

    // Roles ↔ Permissions (optional, only if present)
    if (models.Permission && (models.RolePermission || sequelize.models.RolePermission)) {
      Role.belongsToMany(models.Permission, {
        through: models.RolePermission || 'role_permissions',
        foreignKey: 'roleId',
        otherKey: 'permissionId',
        as: 'permissions',
      });
    }
  };

  return Role;
};
