module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define(
    'UserRole',
    {
      // Having a PK keeps Sequelize happy and simplifies future references
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
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
        // Prevent duplicate assignments of the same role to a user
        { unique: true, fields: ['userId', 'roleId'] },
      ],
    }
  );

  return UserRole;
};
