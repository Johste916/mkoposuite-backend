// src/models/LoanProduct.js
module.exports = (sequelize, DataTypes) => {
  const LoanProduct = sequelize.define(
    'LoanProduct',
    {
      name:            { type: DataTypes.STRING, allowNull: false },
      code:            { type: DataTypes.STRING, allowNull: false, unique: true },
      status:          { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },

      // Pricing
      interestMethod:  { type: DataTypes.ENUM('flat', 'reducing'), allowNull: false, defaultValue: 'flat' },
      interestRate:    { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 }, // %

      // Constraints
      minPrincipal:    { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      maxPrincipal:    { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      minTermMonths:   { type: DataTypes.INTEGER, allowNull: true },
      maxTermMonths:   { type: DataTypes.INTEGER, allowNull: true },

      // Optional
      penaltyRate:     { type: DataTypes.DECIMAL(10, 4), allowNull: true },
      fees:            { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },  // [{name,type:'fixed|percent',value}]
      eligibility:     { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      tableName: 'loan_products', // keep your existing table
      underscored: true,          // created_at / updated_at
      indexes: [
        { unique: true, fields: ['code'] },
        { fields: ['status'] },
      ],
    }
  );

  // Note: you define associations in models/index.js, so this is optional.
  // LoanProduct.associate = (models) => {
  //   if (models.Loan) {
  //     LoanProduct.hasMany(models.Loan, { foreignKey: 'productId' });
  //   }
  // };

  return LoanProduct;
};
