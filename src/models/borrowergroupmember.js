"use strict";
module.exports = (sequelize, DataTypes) => {
  const BorrowerGroupMember = sequelize.define(
    "BorrowerGroupMember",
    {
      groupId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      borrowerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      role: {
        type: DataTypes.ENUM("member", "chair", "secretary", "treasurer"),
        allowNull: false,
        defaultValue: "member",
      },
      joinedAt: { type: DataTypes.DATE, allowNull: true },
      leftAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      paranoid: true,
      tableName: "BorrowerGroupMembers",
      underscored: false,
    }
  );

  BorrowerGroupMember.associate = (models) => {
    BorrowerGroupMember.belongsTo(models.BorrowerGroup, {
      foreignKey: "groupId",
      as: "group",
      onDelete: "CASCADE",
    });
    if (models.Borrower) {
      BorrowerGroupMember.belongsTo(models.Borrower, {
        foreignKey: "borrowerId",
        as: "borrower",
        onDelete: "CASCADE",
      });
    }
  };

  return BorrowerGroupMember;
};
