"use strict";

module.exports = (sequelize, DataTypes) => {
  const BorrowerGroup = sequelize.define(
    "BorrowerGroup",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: DataTypes.STRING(160), allowNull: false },

      branchId: { type: DataTypes.INTEGER, allowNull: true },
      officerId: { type: DataTypes.UUID, allowNull: true },

      // Model as STRINGs; DB has ENUM so values must match, but we avoid tying to enum name
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
          if (instance.meetingDay) instance.meetingDay = String(instance.meetingDay).toLowerCase();
          if (instance.status) instance.status = String(instance.status).toLowerCase();
          ["branchId","officerId","notes"].forEach((k) => {
            if (instance[k] === "") instance[k] = null;
          });
        },
      },
      validate: {
        meetingDayAllowed() {
          const v = (this.meetingDay || "").toLowerCase();
          if (v && !["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].includes(v)) {
            throw new Error("meetingDay must be monday…sunday");
          }
        },
        statusAllowed() {
          const v = (this.status || "").toLowerCase();
          if (v && !["active","inactive"].includes(v)) {
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
