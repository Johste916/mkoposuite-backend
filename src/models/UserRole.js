"use strict";

module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define(
    "UserRole",
    {
      // Keep a PK to make Sequelize happy
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // IMPORTANT: pin to DB column names to avoid auto snake_casing
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "userId",    // <-- ensure NOT "user_id"
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "roleId",    // <-- ensure NOT "role_id"
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
