// src/models/LoanProduct.js
module.exports = (sequelize, DataTypes) => {
  const LoanProduct = sequelize.define(
    'LoanProduct',
    {
      name:           { type: DataTypes.STRING, allowNull: false },
      code:           { type: DataTypes.STRING, allowNull: false, unique: true },

      status:         { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },

      interestMethod: { type: DataTypes.ENUM('flat', 'reducing'), allowNull: false, defaultValue: 'flat' },
      interestRate:   { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 },

      interestPeriod: { type: DataTypes.ENUM('weekly', 'monthly', 'yearly'), allowNull: false, defaultValue: 'monthly' },

      termValue:      { type: DataTypes.INTEGER, allowNull: true },
      termUnit:       { type: DataTypes.ENUM('days', 'weeks', 'months', 'years'), allowNull: false, defaultValue: 'months' },

      minPrincipal:   { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      maxPrincipal:   { type: DataTypes.DECIMAL(14, 2), allowNull: true },

      minTermMonths:  { type: DataTypes.INTEGER, allowNull: true },
      maxTermMonths:  { type: DataTypes.INTEGER, allowNull: true },

      penaltyRate:    { type: DataTypes.DECIMAL(10, 4), allowNull: true },

      feeType:        { type: DataTypes.ENUM('amount', 'percent'), allowNull: false, defaultValue: 'amount' },
      feeAmount:      { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      feePercent:     { type: DataTypes.DECIMAL(10, 4), allowNull: true },

      fees:           { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

      eligibility:    { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      meta:           { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      tableName: 'loan_products', // your table is snake
      underscored: true,          // created_at/updated_at if present
      timestamps: true,
      indexes: [
        { unique: true, fields: ['code'] },
        { fields: ['status'] },
      ],
    }
  );

  return LoanProduct;
};
