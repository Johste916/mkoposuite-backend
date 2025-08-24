'use strict';

module.exports = (sequelize, DataTypes) => {
  const CollectionSheet = sequelize.define('CollectionSheet', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    date:          { type: DataTypes.DATEONLY, allowNull: false },
    type:          { type: DataTypes.STRING,   allowNull: false }, // FIELD | OFFICE | AGENCY
    collector:     { type: DataTypes.STRING,   allowNull: true  },
    loanOfficer:   { type: DataTypes.STRING,   allowNull: true  },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending',
    },
    // Keep these as UUID to match Supabase (and most prod setups)
    branchId:       { type: DataTypes.UUID, allowNull: true },
    collectorId:    { type: DataTypes.UUID, allowNull: true },
    loanOfficerId:  { type: DataTypes.UUID, allowNull: true },
    // If you later add soft deletes, also add deletedAt + paranoid: true in options
  }, {
    tableName: 'collection_sheets',
    schema: 'public',
    timestamps: true,
    // paranoid: true, // enable only if your table actually has deletedAt
  });

  CollectionSheet.associate = function (models) {
    if (models.Branch) {
      CollectionSheet.belongsTo(models.Branch, { foreignKey: 'branchId', as: 'branch' });
    }
    if (models.User) {
      CollectionSheet.belongsTo(models.User, { foreignKey: 'collectorId',   as: 'collectorUser' });
      CollectionSheet.belongsTo(models.User, { foreignKey: 'loanOfficerId', as: 'loanOfficerUser' });
    }
  };

  return CollectionSheet;
};
