// backend/src/models/UserRole.js
module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define(
    'UserRole',
    {
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
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

  return UserRole;
};
