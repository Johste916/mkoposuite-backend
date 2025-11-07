// src/models/loanProduct.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const LoanProduct = sequelize.define(
    'LoanProduct',
    {
      id:   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: 'id' },
      name: { type: DataTypes.STRING, allowNull: false, field: 'name' },
      code: { type: DataTypes.STRING, allowNull: false, unique: true, field: 'code' },

      status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active', field: 'status' },

      // map camel -> snake columns
      interestMethod: { type: DataTypes.ENUM('flat', 'reducing'), allowNull: false, defaultValue: 'flat', field: 'interest_method' },
      interestRate:   { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0, field: 'interest_rate' },

      interestPeriod: { type: DataTypes.ENUM('weekly', 'monthly', 'yearly'), allowNull: false, defaultValue: 'monthly', field: 'interest_period' },

      termValue:      { type: DataTypes.INTEGER, allowNull: true, field: 'term_value' },
      termUnit:       { type: DataTypes.ENUM('days', 'weeks', 'months', 'years'), allowNull: false, defaultValue: 'months', field: 'term_unit' },

      minPrincipal:   { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: 'min_principal' },
      maxPrincipal:   { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: 'max_principal' },

      minTermMonths:  { type: DataTypes.INTEGER, allowNull: true, field: 'min_term_months' },
      maxTermMonths:  { type: DataTypes.INTEGER, allowNull: true, field: 'max_term_months' },

      penaltyRate:    { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'penalty_rate' },

      feeType:        { type: DataTypes.ENUM('amount', 'percent'), allowNull: false, defaultValue: 'amount', field: 'fee_type' },
      feeAmount:      { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: 'fee_amount' },
      feePercent:     { type: DataTypes.DECIMAL(10, 4), allowNull: true, field: 'fee_percent' },

      fees:           { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'fees' },

      eligibility:    { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'eligibility' },
      meta:           { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'meta' },
    },
    {
      schema: 'public',
      tableName: 'loan_products',
      freezeTableName: true,
      timestamps: true,
      underscored: false,
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      indexes: [
        { unique: true, fields: ['code'] },
        { fields: ['status'] },
      ],
    }
  );

  LoanProduct.associate = (models) => {
    if (models.Loan && !LoanProduct.associations?.Loans) {
      LoanProduct.hasMany(models.Loan, {
        as: 'Loans',
        foreignKey: 'productId', // maps to product_id in loans
        sourceKey: 'id',
        constraints: false,
      });
    }
  };

  return LoanProduct;
};
