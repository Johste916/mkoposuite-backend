'use strict';

module.exports = (sequelize, DataTypes) => {
  const RolePermission = sequelize.define(
    'RolePermission',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      roleId: { type: DataTypes.UUID, allowNull: false },
      permissionId: { type: DataTypes.UUID, allowNull: false },
    },
    {
      tableName: 'RolePermissions',
      timestamps: true,
      indexes: [
        { unique: true, fields: ['roleId', 'permissionId'], name: 'role_permissions_unique_pair' },
        { fields: ['roleId'] },
        { fields: ['permissionId'] },
      ],
    }
  );

  RolePermission.associate = (models) => {
    if (models.Role) {
      RolePermission.belongsTo(models.Role, { foreignKey: 'roleId', as: 'role' });
    }
    if (models.Permission) {
      RolePermission.belongsTo(models.Permission, { foreignKey: 'permissionId', as: 'permission' });
    }
  };

  return RolePermission;
};
