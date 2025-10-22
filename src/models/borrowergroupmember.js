"use strict";

module.exports = (sequelize, DataTypes) => {
  const BorrowerGroupMember = sequelize.define(
    "BorrowerGroupMember",
    {
      // Composite primary key (groupId, borrowerId)
      groupId: { type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      borrowerId: { type: DataTypes.BIGINT, allowNull: false, primaryKey: true },

      role: { type: DataTypes.STRING, allowNull: false, defaultValue: "member" },
      joinedAt: { type: DataTypes.DATE, allowNull: true },
      leftAt: { type: DataTypes.DATE, allowNull: true },

      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      deletedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "BorrowerGroupMembers",
      paranoid: true,
      timestamps: true,
      underscored: false,
    }
  );

  BorrowerGroupMember.associate = (models) => {
    if (models.BorrowerGroup) {
      BorrowerGroupMember.belongsTo(models.BorrowerGroup, {
        foreignKey: "groupId",
        as: "group",
      });
    }
    if (models.Borrower) {
      BorrowerGroupMember.belongsTo(models.Borrower, {
        foreignKey: "borrowerId",
        as: "borrower",
      });
    }
  };

  return BorrowerGroupMember;
};
