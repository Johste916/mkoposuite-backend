'use strict';

module.exports = (sequelize, DataTypes) => {
  const CollectionSheet = sequelize.define('CollectionSheet', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4, // safe model-level default (no DB extension needed)
      primaryKey: true,
    },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    type: { type: DataTypes.STRING(32), allowNull: false }, // FIELD | OFFICE | AGENCY
    collector: { type: DataTypes.STRING(128), allowNull: true },
    loanOfficer: { type: DataTypes.STRING(128), allowNull: true },
    status: {
      type: DataTypes.ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'),
      allowNull: false,
      defaultValue: 'PENDING',
    },
    branchId: { type: DataTypes.UUID, allowNull: true },
    collectorId: { type: DataTypes.UUID, allowNull: true },
    loanOfficerId: { type: DataTypes.UUID, allowNull: true },
    createdBy: { type: DataTypes.STRING(64), allowNull: true },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true },
    // deletedAt is managed automatically by `paranoid: true`
  }, {
    tableName: 'collection_sheets',
    schema: 'public',
    timestamps: true,
    paranoid: true,      // enables deletedAt
    underscored: true,   // created_at, updated_at, etc.
  });

  CollectionSheet.associate = (models) => {
    if (models.Branch) {
      CollectionSheet.belongsTo(models.Branch, { foreignKey: 'branchId', as: 'branch' });
    }
    if (models.User) {
      CollectionSheet.belongsTo(models.User, { foreignKey: 'collectorId', as: 'collectorUser' });
      CollectionSheet.belongsTo(models.User, { foreignKey: 'loanOfficerId', as: 'loanOfficerUser' });
    }
  };

  return CollectionSheet;
};
