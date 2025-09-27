// src/models/loan.js
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      /* PK (looks integer in your logs; keep explicit) */
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: 'id' },

      /* Core FKs */
      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' },
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branchId' },

      /* product_id in DB → productId in model */
      productId:  { type: DataTypes.INTEGER, allowNull: false, field: 'product_id' },

      /* Reference (used in receipts, etc.) */
      reference:  { type: DataTypes.STRING, unique: true },

      /* Money / terms */
      amount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency:     { type: DataTypes.STRING(8),      allowNull: false, defaultValue: 'TZS' },
      interestRate: { type: DataTypes.DECIMAL(10, 4), field: 'interestRate' },

      /* term_months in DB → termMonths in model */
      termMonths: { type: DataTypes.INTEGER, allowNull: false, field: 'term_months' },

      /* Dates (camelCase exist in your DB for these) */
      startDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'startDate' },
      endDate:   { type: DataTypes.DATEONLY, allowNull: false, field: 'endDate' },

      /* Repayments / method */
      repaymentFrequency: {
        type: DataTypes.ENUM('weekly', 'monthly'),
        allowNull: false,
        defaultValue: 'monthly',
        field: 'repaymentFrequency',
      },
      interestMethod: {
        type: DataTypes.ENUM('flat', 'reducing'),
        allowNull: false,
        defaultValue: 'flat',
        field: 'interestMethod',
      },

      /* Status enum matches enum_loans_status values in DB */
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed', 'closed'),
        allowNull: false,
        defaultValue: 'pending',
        field: 'status',
      },

      /* Totals present in DB */
      totalInterest: { type: DataTypes.DECIMAL(14, 2), field: 'total_interest' },
      outstanding:   { type: DataTypes.DECIMAL(14, 2), field: 'outstanding' },

      /* 🟢 Workflow FKs: **UUID** + **snake_case** fields (match constraints) */
      initiatedBy:      { type: DataTypes.UUID, allowNull: true, field: 'initiated_by' },
      approvedBy:       { type: DataTypes.UUID, allowNull: true, field: 'approved_by' },
      approvalDate:     { type: DataTypes.DATE, allowNull: true, field: 'approvalDate' },
      rejectedBy:       { type: DataTypes.UUID, allowNull: true, field: 'rejected_by' },
      rejectedDate:     { type: DataTypes.DATE, allowNull: true, field: 'rejectedDate' },
      disbursedBy:      { type: DataTypes.UUID, allowNull: true, field: 'disbursed_by' },
      disbursementDate: { type: DataTypes.DATE, allowNull: true, field: 'disbursementDate' },
      disbursementMethod: { type: DataTypes.STRING, allowNull: true, field: 'disbursementMethod' },
      closedBy:         { type: DataTypes.UUID, allowNull: true, field: 'closed_by' },
      closedDate:       { type: DataTypes.DATE, allowNull: true, field: 'closed_date' },
      closeReason:      { type: DataTypes.STRING, allowNull: true, field: 'close_reason' },

      /* Optional self-reference columns shown in constraints */
      rescheduledFromId: { type: DataTypes.INTEGER, allowNull: true, field: 'rescheduledFromId' },
      topUpOfId:         { type: DataTypes.INTEGER, allowNull: true, field: 'topUpOfId' },
    },
    {
      tableName: 'loans',
      timestamps: true,
      underscored: false, // your table mixes camel & snake; keep false
      hooks: {
        beforeValidate: (loan) => {
          // Fill reference if missing
          if (!loan.reference) {
            const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
            loan.reference = `LN-${(loan.borrowerId || 'X')}-${rnd}`;
          }
          // Derive endDate if missing but startDate & termMonths exist
          if (!loan.endDate && loan.startDate && loan.termMonths != null) {
            loan.endDate = addMonthsDateOnly(loan.startDate, Number(loan.termMonths));
          }
        },
      },
    }
  );

  // Local helper for hook
  function addMonthsDateOnly(dateStr, months) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const targetMonthIndex = dt.getUTCMonth() + Number(months);
    const target = new Date(Date.UTC(dt.getUTCFullYear(), targetMonthIndex, dt.getUTCDate()));
    // end-of-month rollover
    if (target.getUTCMonth() !== ((m - 1 + Number(months)) % 12 + 12) % 12) {
      target.setUTCDate(0);
    }
    return target.toISOString().slice(0, 10);
  }

  return Loan;
};
