"use strict";

module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define(
    "UserRole",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "userId", // pin exact column name
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "roleId", // pin exact column name
      },
    },
    {
      tableName: "UserRoles",
      timestamps: true,
      indexes: [
        { fields: ["userId"] },
        { fields: ["roleId"] },
        { unique: true, fields: ["userId", "roleId"] },
      ],
    }
  );

  return UserRole;
};
