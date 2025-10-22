"use strict";

module.exports = (sequelize, DataTypes) => {
  const BorrowerGroup = sequelize.define(
    "BorrowerGroup",
    {
      id: {
        type: DataTypes.BIGINT,        // BIGINT to match DB
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      name: { type: DataTypes.STRING(160), allowNull: false },

      branchId: { type: DataTypes.BIGINT, allowNull: true },
      officerId: { type: DataTypes.BIGINT, allowNull: true },

      // Use STRING/TEXT rather than ENUM so it fits both old/new DBs
      meetingDay: { type: DataTypes.STRING, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },

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
          ["branchId", "officerId", "notes"].forEach((k) => {
            if (instance[k] === "") instance[k] = null;
          });
          if (instance.status) instance.status = String(instance.status).toLowerCase();
        },
      },
      validate: {
        meetingDayAllowed() {
          if (
            this.meetingDay &&
            !["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].includes(
              String(this.meetingDay).toLowerCase()
            )
          ) {
            throw new Error("meetingDay must be a weekday name");
          }
        },
        statusAllowed() {
          if (this.status && !["active","inactive"].includes(String(this.status).toLowerCase())) {
            throw new Error("status must be active|inactive");
          }
        },
      },
    }
  );

  BorrowerGroup.associate = (models) => {
    if (models.Branch) {
      BorrowerGroup.belongsTo(models.Branch, { foreignKey: "branchId", as: "branch" });
    }
    if (models.User) {
      BorrowerGroup.belongsTo(models.User, { foreignKey: "officerId", as: "officer" });
    }
    if (models.BorrowerGroupMember) {
      BorrowerGroup.hasMany(models.BorrowerGroupMember, {
        foreignKey: "groupId",
        as: "groupMembers",
        onDelete: "CASCADE",
      });
    }
  };

  return BorrowerGroup;
};
