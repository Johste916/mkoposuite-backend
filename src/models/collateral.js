'use strict';

module.exports = (sequelize, DataTypes) => {
  const Collateral = sequelize.define('Collateral', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },

    // Optional relations (kept flexible to avoid FK type clashes)
    borrowerId: { type: DataTypes.UUID, allowNull: true },
    loanId:     { type: DataTypes.UUID, allowNull: true },

    // Core fields
    itemName:      { type: DataTypes.STRING,  allowNull: false },
    category:      { type: DataTypes.STRING,  allowNull: true },   // e.g., Electronics, Vehicle
    model:         { type: DataTypes.STRING,  allowNull: true },
    serialNumber:  { type: DataTypes.STRING,  allowNull: true },
    estValue:      { type: DataTypes.DECIMAL(18,2), allowNull: true },

    status: {
      type: DataTypes.ENUM('ACTIVE', 'RELEASED', 'DISPOSED'),
      allowNull: false,
      defaultValue: 'ACTIVE',
    },

    location: { type: DataTypes.STRING, allowNull: true }, // store/branch
    notes:    { type: DataTypes.TEXT,   allowNull: true  },

    // Audit (optional)
    createdBy: { type: DataTypes.UUID, allowNull: true },
    updatedBy: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'collaterals',
    schema: 'public',
    timestamps: true,
  });

  Collateral.associate = function(models) {
    // Keep associations soft to avoid type mismatch explosions across environments
    if (models.Borrower && models.Borrower.rawAttributes?.id) {
      Collateral.belongsTo(models.Borrower, { foreignKey: 'borrowerId', as: 'borrower' });
    }
    if (models.Loan && models.Loan.rawAttributes?.id) {
      Collateral.belongsTo(models.Loan, { foreignKey: 'loanId', as: 'loan' });
    }
    if (models.User && models.User.rawAttributes?.id) {
      Collateral.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
      Collateral.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
    }
  };

  return Collateral;
};
