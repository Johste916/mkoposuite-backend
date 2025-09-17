"use strict";

module.exports = (sequelize, DataTypes) => {
  const BorrowerGroup = sequelize.define(
    "BorrowerGroup",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: sequelize.literal("gen_random_uuid()"),
        primaryKey: true,
        allowNull: false,
      },
      name: { type: DataTypes.STRING(160), allowNull: false },

      branchId: { type: DataTypes.UUID, allowNull: true },
      officerId: { type: DataTypes.UUID, allowNull: true },

      meetingDay: {
        type: DataTypes.ENUM(
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday"
        ),
        allowNull: true,
      },
      notes: { type: DataTypes.TEXT, allowNull: true },
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        allowNull: false,
        defaultValue: "active",
      },

      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      deletedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "BorrowerGroups",
      paranoid: true,
      timestamps: true,
      underscored: false,
      hooks: {
        beforeValidate(instance) {
          if (instance.meetingDay) {
            instance.meetingDay = String(instance.meetingDay).toLowerCase();
          }
          // Treat empty strings as null to satisfy UUID/ENUM columns
          ["branchId", "officerId", "notes"].forEach((k) => {
            if (instance[k] === "") instance[k] = null;
          });
        },
      },
    }
  );

  BorrowerGroup.associate = (models) => {
    if (models.Branch) {
      BorrowerGroup.belongsTo(models.Branch, {
        foreignKey: "branchId",
        as: "branch",
      });
    }
    if (models.User) {
      BorrowerGroup.belongsTo(models.User, {
        foreignKey: "officerId",
        as: "officer",
      });
    }
    if (models.BorrowerGroupMember) {
      BorrowerGroup.hasMany(models.BorrowerGroupMember, {
        foreignKey: "groupId",
        as: "members",
        onDelete: "CASCADE",
      });
    }
  };

  return BorrowerGroup;
};
