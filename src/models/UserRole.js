'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define(
    'UserRole',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false, field: 'userId' },
      roleId: { type: DataTypes.UUID, allowNull: false, field: 'roleId' },
    },
    {
      tableName: 'UserRoles',
      timestamps: true,
      indexes: [
        { fields: ['userId'] },
        { fields: ['roleId'] },
        { unique: true, fields: ['userId', 'roleId'] },
      ],
    }
  );

  // Optional, but helps with includes when debugging
  UserRole.associate = (models) => {
    if (models.User) UserRole.belongsTo(models.User, { foreignKey: 'userId' });
    if (models.Role) UserRole.belongsTo(models.Role, { foreignKey: 'roleId' });
  };

  return UserRole;
};
