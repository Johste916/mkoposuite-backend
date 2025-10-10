'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define(
    'UserRole',
    {
      // Keep your single PK to make Sequelize happy
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'role_id',
      },
      // Optional multi-tenant support; safe to keep null
      tenantId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'tenant_id',
      },
      // Optional: primary flag if you ever want a “primary role”
      isPrimary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_primary',
      },
    },
    {
      tableName: 'UserRoles',
      timestamps: true,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['role_id'] },
        // Prevent duplicate assignments of the same role to a user
        { unique: true, fields: ['user_id', 'role_id'] },
      ],
    }
  );

  return UserRole;
};
