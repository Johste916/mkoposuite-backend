"use strict";
module.exports = (sequelize, DataTypes) => {
  const BorrowerGroup = sequelize.define(
    "BorrowerGroup",
    {
      name: { type: DataTypes.STRING(160), allowNull: false },
      branchId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      officerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
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
    },
    {
      paranoid: true,
      tableName: "BorrowerGroups",
      underscored: false,
    }
  );

  BorrowerGroup.associate = (models) => {
    // optional FK associations (left non-required to avoid breaking)
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

    BorrowerGroup.hasMany(models.BorrowerGroupMember, {
      foreignKey: "groupId",
      as: "groupMembers",
      onDelete: "CASCADE",
    });

    if (models.Borrower) {
      // convenience many-to-many
      BorrowerGroup.belongsToMany(models.Borrower, {
        through: models.BorrowerGroupMember,
        foreignKey: "groupId",
        otherKey: "borrowerId",
        as: "members",
      });
    }
  };

  return BorrowerGroup;
};
