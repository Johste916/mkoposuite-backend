"use strict";

module.exports = (sequelize, DataTypes) => {
  const Permission = sequelize.define(
    "Permission",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4, // DB also has a default; either works
        primaryKey: true,
      },
      action: {
        type: DataTypes.STRING(190),
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      roles: {
        // <-- match your DB: text[] (Postgres array of strings)
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: false,
        defaultValue: [],
      },
      isSystem: {
        field: "is_system", // <-- map to snake_case column
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "permissions",
      underscored: true, // maps created_at / updated_at
      timestamps: true,
      indexes: [{ unique: true, fields: ["action"] }],
    }
  );

  return Permission;
};
