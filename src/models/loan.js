// src/models/loan.js
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      // Core FKs (match your existing migration)
      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' },

      // Optional branch (only if your DB actually has this; harmless if unused)
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branchId' },

      // NEW: product_id in DB → productId in model
      productId:  { type: DataTypes.INTEGER, allowNull: true,  field: 'product_id' },

      // Reference used on receipts etc.
      reference:  { type: DataTypes.STRING, unique: true },

      // Money / terms
      amount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency:     { type: DataTypes.STRING(8), defaultValue: 'TZS' },
      interestRate: { type: DataTypes.DECIMAL(10, 4), field: 'interestRate' },

      // NEW: term_months in DB → termMonths in model
      termMonths: { type: DataTypes.INTEGER, field: 'term_months' },

      // ⚠ These were created camelCase in your first migration — keep camel here
      startDate:          { type: DataTypes.DATEONLY, field: 'startDate' },
      endDate:            { type: DataTypes.DATEONLY, field: 'endDate' },
      repaymentFrequency: { type: DataTypes.ENUM('weekly', 'monthly'), field: 'repaymentFrequency' },
      interestMethod:     { type: DataTypes.ENUM('flat', 'reducing'),  field: 'interestMethod' },

      // Status enum (migration above extends it safely)
      status: { type: DataTypes.STRING },

      // NEW: numeric totals (snake in DB)
      totalInterest: { type: DataTypes.DECIMAL(14, 2), field: 'total_interest' },
      outstanding:   { type: DataTypes.DECIMAL(14, 2), field: 'outstanding' },

      // Workflow columns (your original migration used INTEGERs, not UUIDs)
      approvedBy:       { type: DataTypes.INTEGER, field: 'approvedBy' },
      approvalDate:     { type: DataTypes.DATE,    field: 'approvalDate' },
      disbursedBy:      { type: DataTypes.INTEGER, field: 'disbursedBy' },
      disbursementDate: { type: DataTypes.DATE,    field: 'disbursementDate' },
      disbursementMethod: { type: DataTypes.STRING, field: 'disbursementMethod' },

      // NEW: close fields we just added (snake in DB)
      closedBy:   { type: DataTypes.INTEGER, field: 'closed_by' },
      closedDate: { type: DataTypes.DATE,    field: 'closed_date' },
    },
    {
      tableName: 'loans',
      timestamps: true,   // createdAt / updatedAt (camel in DB per your first migration)
      underscored: false, // because many columns are camelCase already
      hooks: {
        beforeValidate: async (loan) => {
          if (!loan.reference) {
            const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
            loan.reference = `LN-${(loan.borrowerId || 'X')}-${rnd}`;
          }
        },
      },
    }
  );

  return Loan;
};
