// src/models/LoanProduct.js
module.exports = (sequelize, DataTypes) => {
  const LoanProduct = sequelize.define(
    'LoanProduct',
    {
      name:           { type: DataTypes.STRING, allowNull: false },
      code:           { type: DataTypes.STRING, allowNull: false, unique: true },

      /** Active status (keep your existing behavior) */
      status:         { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },

      /** Interest */
      interestMethod: { type: DataTypes.ENUM('flat', 'reducing'), allowNull: false, defaultValue: 'flat' },
      interestRate:   { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 }, // %

      /** Periodicity of interest (new) */
      interestPeriod: { type: DataTypes.ENUM('weekly', 'monthly', 'yearly'), allowNull: false, defaultValue: 'monthly' },

      /** Term (new) */
      termValue:      { type: DataTypes.INTEGER, allowNull: true }, // e.g., 12
      termUnit:       { type: DataTypes.ENUM('days', 'weeks', 'months', 'years'), allowNull: false, defaultValue: 'months' },

      /** Principals (keep compatible names) */
      minPrincipal:   { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      maxPrincipal:   { type: DataTypes.DECIMAL(14, 2), allowNull: true },

      /** Optional legacy min/max term in months (kept for compatibility) */
      minTermMonths:  { type: DataTypes.INTEGER, allowNull: true },
      maxTermMonths:  { type: DataTypes.INTEGER, allowNull: true },

      /** Optional */
      penaltyRate:    { type: DataTypes.DECIMAL(10, 4), allowNull: true },

      /** Fees
       *  - feeType/feeAmount/feePercent are the normalized fields the app uses
       *  - 'fees' JSONB (array) is retained for backward compatibility
       */
      feeType:        { type: DataTypes.ENUM('amount', 'percent'), allowNull: false, defaultValue: 'amount' },
      feeAmount:      { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      feePercent:     { type: DataTypes.DECIMAL(10, 4), allowNull: true },

      fees:           { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

      /** Anything else the API might send—safe landing zone */
      eligibility:    { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      meta:           { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      tableName: 'loan_products',
      underscored: true,
      indexes: [
        { unique: true, fields: ['code'] },
        { fields: ['status'] },
      ],
    }
  );

  return LoanProduct;
};
