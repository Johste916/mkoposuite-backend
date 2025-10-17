'use strict';

module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define('Role', {
    id:          { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name:        { type: DataTypes.STRING(120), allowNull: false, unique: true },
    description: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
    isSystem:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_system' },
  }, {
    tableName: 'roles',
    underscored: true,           // this table actually uses snake_case columns (created_at, etc.)
    timestamps: true,
    indexes: [{ unique: true, fields: ['name'] }],
  });

  Role.associate = (models) => {
    if (models.User) {
      Role.belongsToMany(models.User, {
        through: models.UserRole || 'user_roles',
        foreignKey: { name: 'roleId', field: 'role_id' },
        otherKey:   { name: 'userId', field: 'user_id' },
        as: 'Users',
      });
    }
    if (models.Permission && models.RolePermission) {
      Role.belongsToMany(models.Permission, {
        through: models.RolePermission,
        foreignKey: { name: 'roleId', field: 'role_id' },
        otherKey:   { name: 'permissionId', field: 'permission_id' },
        as: 'Permissions',
      });
    }
  };

  return Role;
};
