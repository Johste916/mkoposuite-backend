// models/borrowergroupmember.js
"use strict";

module.exports = (sequelize, DataTypes) => {
  const BorrowerGroupMember = sequelize.define(
    "BorrowerGroupMember",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      groupId: { type: DataTypes.INTEGER, allowNull: false },
      borrowerId: { type: DataTypes.INTEGER, allowNull: false },
      role: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "member" },
      joinedAt: { type: DataTypes.DATE, allowNull: true },
      leftAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      deletedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "BorrowerGroupMembers",
      paranoid: true,
      indexes: [
        { unique: true, fields: ["groupId", "borrowerId"], name: "uq_group_borrower" },
        { fields: ["borrowerId"] },
      ],
    }
  );

  BorrowerGroupMember.associate = (models) => {
    if (models.BorrowerGroup) {
      BorrowerGroupMember.belongsTo(models.BorrowerGroup, { foreignKey: "groupId", as: "group" });
    }
    if (models.Borrower) {
      BorrowerGroupMember.belongsTo(models.Borrower, { foreignKey: "borrowerId", as: "borrower" });
    }
  };

  return BorrowerGroupMember;
};
