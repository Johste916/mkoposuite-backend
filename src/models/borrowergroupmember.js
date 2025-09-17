"use strict";

module.exports = (sequelize, DataTypes) => {
  const BorrowerGroupMember = sequelize.define(
    "BorrowerGroupMember",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: sequelize.literal("gen_random_uuid()"),
        primaryKey: true,
        allowNull: false,
      },
      groupId: { type: DataTypes.UUID, allowNull: false },
      borrowerId: { type: DataTypes.UUID, allowNull: false },

      role: {
        type: DataTypes.ENUM("member", "chair", "secretary", "treasurer"),
        allowNull: false,
        defaultValue: "member",
      },
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
