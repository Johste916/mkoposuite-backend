"use strict";

module.exports = (sequelize, DataTypes) => {
  const BorrowerGroup = sequelize.define(
    "BorrowerGroup",
    {
      id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name:      { type: DataTypes.STRING(160), allowNull: false },

      branchId:  { type: DataTypes.INTEGER, allowNull: true },
      officerId: { type: DataTypes.UUID,    allowNull: true },

      // DB uses enums? keep as STRING with validation for portability
      meetingDay: { type: DataTypes.STRING, allowNull: true },
      notes:      { type: DataTypes.TEXT,   allowNull: true },
      status:     { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },

      createdAt:  { type: DataTypes.DATE, allowNull: false },
      updatedAt:  { type: DataTypes.DATE, allowNull: false },
      deletedAt:  { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "BorrowerGroups",
      freezeTableName: true,
      paranoid: true,
      timestamps: true,
      underscored: false,
      hooks: {
        beforeValidate(instance) {
          if (instance.meetingDay) instance.meetingDay = String(instance.meetingDay).toLowerCase();
          if (instance.status)     instance.status     = String(instance.status).toLowerCase();
          for (const k of ["branchId", "officerId", "notes"]) {
            if (instance[k] === "") instance[k] = null;
          }
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
      indexes: [
        { fields: ["name"] },
        { fields: ["status"] },
        { fields: ["branchId"] },
        { fields: ["officerId"] },
        { fields: ["deletedAt"] },
      ],
    }
  );

  BorrowerGroup.associate = (models) => {
    if (models.Branch && !BorrowerGroup.associations?.branch) {
      BorrowerGroup.belongsTo(models.Branch, { foreignKey: "branchId", as: "branch" });
    }
    if (models.User && !BorrowerGroup.associations?.officer) {
      // officerId is UUID, User.id UUID → no constraint issues
      BorrowerGroup.belongsTo(models.User, { foreignKey: "officerId", as: "officer" });
    }
    if (models.BorrowerGroupMember && !BorrowerGroup.associations?.groupMembers) {
      BorrowerGroup.hasMany(models.BorrowerGroupMember, {
        foreignKey: "groupId",
        as: "groupMembers",
        onDelete: "CASCADE",
      });
    }
  };

  return BorrowerGroup;
};
