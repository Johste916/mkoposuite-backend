'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CollectionSheet extends Model {
    static associate(models) {
      // Example: if you later relate to LoanOfficer/User etc.
      // CollectionSheet.belongsTo(models.User, { as: 'officer', foreignKey: 'loanOfficerId' });
    }
  }

  CollectionSheet.init(
    {
      // Core fields
      date: { type: DataTypes.DATE, allowNull: false },
      type: { type: DataTypes.STRING(32), allowNull: false }, // FIELD | OFFICE | AGENCY
      collector: { type: DataTypes.STRING(128), allowNull: true },
      loanOfficer: { type: DataTypes.STRING(128), allowNull: true },
      status: { type: DataTypes.STRING(32), allowNull: false }, // PENDING | IN_PROGRESS | COMPLETED | CANCELLED

      // Audit (optional)
      createdBy: { type: DataTypes.STRING(64), allowNull: true },
      updatedBy: { type: DataTypes.STRING(64), allowNull: true },

      // Soft delete
      deletedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'CollectionSheet',     // ⚠️ This is the name the controller expects
      tableName: 'collection_sheets',   // explicit table name
      underscored: true,
      paranoid: true,                   // enables soft delete via deletedAt
      timestamps: true,                 // createdAt/updatedAt
    }
  );

  return CollectionSheet;
};
