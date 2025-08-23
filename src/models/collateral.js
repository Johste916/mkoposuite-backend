'use strict';

module.exports = (sequelize, DataTypes) => {
  const Collateral = sequelize.define('Collateral', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },

    // Soft links (no hard DB FKs to avoid cross-env type mismatch)
    borrowerId: { type: DataTypes.UUID, allowNull: true },
    loanId:     { type: DataTypes.UUID, allowNull: true },

    // Core fields
    itemName:     { type: DataTypes.STRING,  allowNull: false },
    category:     { type: DataTypes.STRING,  allowNull: true },
    model:        { type: DataTypes.STRING,  allowNull: true },
    serialNumber: { type: DataTypes.STRING,  allowNull: true },
    estValue:     { type: DataTypes.DECIMAL(18,2), allowNull: true },

    status: {
      type: DataTypes.ENUM('ACTIVE', 'RELEASED', 'DISPOSED'),
      allowNull: false,
      defaultValue: 'ACTIVE',
    },

    location: { type: DataTypes.STRING, allowNull: true },
    notes:    { type: DataTypes.TEXT,   allowNull: true },

    // Audit (optional)
    createdBy: { type: DataTypes.UUID, allowNull: true },
    updatedBy: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'collaterals',
    schema: 'public',
    timestamps: true,
    indexes: [
      { fields: ['status'] },
      { fields: ['category'] },
      { fields: ['borrowerId'] },
      { fields: ['loanId'] },
    ],
    defaultScope: { order: [['createdAt', 'DESC']] },
  });

  // This associate() is harmless if not called; we wire associations in models/index.js too.
  Collateral.associate = function(models) {
    if (models.Borrower) Collateral.belongsTo(models.Borrower, { foreignKey: 'borrowerId', as: 'borrower' });
    if (models.Loan)     Collateral.belongsTo(models.Loan,     { foreignKey: 'loanId',     as: 'loan' });
    if (models.User) {
      Collateral.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      Collateral.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  };

  return Collateral;
};
