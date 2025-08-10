// src/models/LoanProduct.js
module.exports = (sequelize, DataTypes) => {
  const LoanProduct = sequelize.define('LoanProduct', {
    name: { type: DataTypes.STRING, allowNull: false },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },

    interestMethod: { type: DataTypes.ENUM('flat', 'reducing'), allowNull: false, defaultValue: 'flat' },
    interestRate: { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 }, // % per period

    minPrincipal: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    maxPrincipal: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    minTermMonths: { type: DataTypes.INTEGER, allowNull: true },
    maxTermMonths: { type: DataTypes.INTEGER, allowNull: true },

    penaltyRate: { type: DataTypes.DECIMAL(10, 4), allowNull: true }, // optional %/month or rule-defined

    fees: { type: DataTypes.JSONB, allowNull: true, defaultValue: [] },         // [{name, type:'fixed|percent', value}]
    eligibility: { type: DataTypes.JSONB, allowNull: true, defaultValue: {} },  // arbitrary rules later
  }, {
    tableName: 'loan_products',
    underscored: true,
  });

  LoanProduct.associate = (models) => {
    if (models.Loan) {
      LoanProduct.hasMany(models.Loan, { foreignKey: 'productId', as: 'loans' });
    }
  };

  return LoanProduct;
};
