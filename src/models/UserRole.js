'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define(
    'UserRole',
    {
      id:     { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false, field: 'userId' },
      roleId: { type: DataTypes.UUID, allowNull: false, field: 'roleId' },
    },
    {
      tableName: 'UserRoles',
      freezeTableName: true,
      timestamps: true,
      underscored: false,
      indexes: [
        { fields: ['userId'] },
        { fields: ['roleId'] },
        { unique: true, fields: ['userId', 'roleId'], name: 'user_roles_unique_pair' },
      ],
    }
  );

  UserRole.associate = (models) => {
    if (models.User && !UserRole.associations?.user) {
      UserRole.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    }
    if (models.Role && !UserRole.associations?.role) {
      UserRole.belongsTo(models.Role, { foreignKey: 'roleId', as: 'role' });
    }
  };

  return UserRole;
};
