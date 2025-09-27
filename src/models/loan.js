// src/models/loan.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      /* ---------------------- Core FKs ---------------------- */
      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' },
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branchId' },

      // product_id in DB → productId in model
      productId:  { type: DataTypes.INTEGER, allowNull: false, field: 'product_id' },

      /* ---------------------- Identity ---------------------- */
      reference:  { type: DataTypes.STRING, unique: true },

      /* ---------------------- Money / terms ---------------------- */
      amount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency:     { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS' },
      interestRate: { type: DataTypes.DECIMAL(10, 4), field: 'interestRate' },

      // term_months in DB → termMonths in model
      termMonths: { type: DataTypes.INTEGER, allowNull: false, field: 'term_months' },

      // DB columns are camelCase for dates in most deployments
      startDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'startDate' },
      endDate:   { type: DataTypes.DATEONLY, allowNull: false, field: 'endDate' },

      repaymentFrequency: {
        type: DataTypes.ENUM('weekly', 'monthly'),
        allowNull: false,
        defaultValue: 'monthly',
        field: 'repaymentFrequency',
      },

      // Your controllers use 'flat' and 'reducing'
      interestMethod: {
        type: DataTypes.ENUM('flat', 'reducing'),
        allowNull: false,
        defaultValue: 'flat',
        field: 'interestMethod',
      },

      /* ---------------------- Status (enum) ---------------------- */
      status: {
        // Keep values in sync with controller & migration
        type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed', 'closed'),
        allowNull: false,
        defaultValue: 'pending',
        field: 'status',
        validate: {
          isIn: [['pending', 'approved', 'rejected', 'disbursed', 'closed']],
          notEmpty: true,
        },
      },

      /* ---------------------- Totals & derived ---------------------- */
      totalInterest: { type: DataTypes.DECIMAL(14, 2), field: 'total_interest' },
      outstanding:   { type: DataTypes.DECIMAL(14, 2), field: 'outstanding' },

      // Optional analytics/ops columns (only used if present in DB)
      arrears:   { type: DataTypes.DECIMAL(14, 2), field: 'arrears' },
      dpd:       { type: DataTypes.INTEGER,        field: 'dpd' },
      nextDueStatus: { type: DataTypes.STRING,     field: 'nextDueStatus' },

      /* ---------------------- Workflow columns ---------------------- */
      // NOTE: keep these as INTEGER to match deployments that use INT user IDs.
      // The controller checks column types at runtime before setting them.
      initiatedBy:      { type: DataTypes.INTEGER, field: 'initiatedBy' },

      approvedBy:       { type: DataTypes.INTEGER, field: 'approvedBy' },
      approvalDate:     { type: DataTypes.DATE,    field: 'approvalDate' },

      rejectedBy:       { type: DataTypes.INTEGER, field: 'rejectedBy' },
      rejectedDate:     { type: DataTypes.DATE,    field: 'rejectedDate' },

      disbursedBy:      { type: DataTypes.INTEGER, field: 'disbursedBy' },
      disbursementDate: { type: DataTypes.DATE,    field: 'disbursementDate' },
      disbursementMethod: { type: DataTypes.STRING, field: 'disbursementMethod' },

      // Close fields (many DBs use snake_case here)
      closedBy:     { type: DataTypes.INTEGER, field: 'closed_by' },
      closedDate:   { type: DataTypes.DATE,    field: 'closed_date' },
      closeReason:  { type: DataTypes.STRING,  field: 'close_reason' }, // only if column exists
    },
    {
      tableName: 'loans',
      timestamps: true,   // createdAt / updatedAt
      underscored: false, // mix of camelCase & snake already mapped via `field`
      hooks: {
        beforeValidate: (loan) => {
          // Ensure enums are never empty-string (prevents 22P02 on enum)
          if (loan.status == null || loan.status === '') loan.status = 'pending';
          if (loan.repaymentFrequency == null || loan.repaymentFrequency === '') loan.repaymentFrequency = 'monthly';
          if (loan.interestMethod == null || loan.interestMethod === '') loan.interestMethod = 'flat';

          // Auto-derive endDate if missing but startDate & termMonths exist
          if (!loan.endDate && loan.startDate && loan.termMonths != null) {
            loan.endDate = addMonthsDateOnly(loan.startDate, Number(loan.termMonths));
          }

          // Fill reference if missing (lightweight)
          if (!loan.reference) {
            const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
            loan.reference = `LN-${(loan.borrowerId || 'X')}-${rnd}`;
          }
        },
      },
    }
  );

  // Local helper for month arithmetic on DATEONLY strings
  function addMonthsDateOnly(dateStr, months) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const targetMonthIndex = dt.getUTCMonth() + Number(months);
    const target = new Date(Date.UTC(dt.getUTCFullYear(), targetMonthIndex, dt.getUTCDate()));
    // Handle end-of-month rollover (e.g., Jan 31 + 1 month)
    if (target.getUTCMonth() !== ((m - 1 + Number(months)) % 12 + 12) % 12) {
      target.setUTCDate(0);
    }
    return target.toISOString().slice(0, 10);
  }

  return Loan;
};
