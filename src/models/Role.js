'use strict';

module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define(
    'Role',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      description: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'Roles',
      timestamps: true,
      indexes: [{ unique: true, fields: ['name'] }],
    }
  );

  Role.associate = (models) => {
    // M:N to Permissions if present
    if (models.Permission && models.RolePermission) {
      Role.belongsToMany(models.Permission, {
        through: models.RolePermission,
        foreignKey: 'roleId',
        otherKey: 'permissionId',
        as: 'Permissions',
      });
    }

    // ✅ also wire back to Users (helps prevent eager-load mistakes)
    if (models.User) {
      Role.belongsToMany(models.User, {
        through: models.UserRole || 'UserRoles',
        foreignKey: 'roleId',
        otherKey: 'userId',
        as: 'Users',
      });
    }
  };

  return Role;
};
