'use strict';

module.exports = (sequelize, DataTypes) => {
  const CollectionSheet = sequelize.define('CollectionSheet', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4, // safer if gen_random_uuid isn't available
      primaryKey: true,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    collector: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    loanOfficer: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending',
    },
    branchId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    collectorId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    loanOfficerId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  }, {
    tableName: 'collection_sheets',
    schema: 'public',
    timestamps: true,
  });

  CollectionSheet.associate = function (models) {
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
