'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define('UserRole', {
    userId: { type: DataTypes.UUID, allowNull: false, primaryKey: true, field: 'user_id' },
    roleId: { type: DataTypes.UUID, allowNull: false, primaryKey: true, field: 'role_id' },
  }, {
    tableName: 'user_roles',
    underscored: true,
    timestamps: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['role_id'] },
      { unique: true, fields: ['user_id', 'role_id'] },
    ],
  });

  UserRole.associate = (models) => {
    if (models.User) UserRole.belongsTo(models.User, { foreignKey: { name: 'userId', field: 'user_id' } });
    if (models.Role) UserRole.belongsTo(models.Role, { foreignKey: { name: 'roleId', field: 'role_id' } });
  };

  return UserRole;
};
