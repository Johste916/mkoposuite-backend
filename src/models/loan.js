// src/models/loan.js
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      // PK
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // Keep the ones that already worked as-is (to avoid breaking inserts)
      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' },
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branchId' },

      // Your DB already uses product_id (this was correct)
      productId:  { type: DataTypes.INTEGER, allowNull: false, field: 'product_id' },

      reference:  { type: DataTypes.STRING, unique: true },

      amount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency:     { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS' },

      // Leave as-is since your INSERT was already using "interestRate" successfully
      interestRate: { type: DataTypes.DECIMAL(10, 4), field: 'interestRate' },

      termMonths:   { type: DataTypes.INTEGER, allowNull: false, field: 'term_months' },

      startDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'startDate' },
      endDate:   { type: DataTypes.DATEONLY, allowNull: false, field: 'endDate' },

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

      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'pending',
        field: 'status',
      },

      totalInterest: { type: DataTypes.DECIMAL(14, 2), field: 'total_interest' },
      totalPaid:     { type: DataTypes.DECIMAL(14, 2), field: 'total_paid' },
      outstanding:   { type: DataTypes.DECIMAL(14, 2), field: 'outstanding' },

      // User FKs (UUIDs)
      initiatedBy: { type: DataTypes.UUID, field: 'initiated_by' },
      approvedBy:  { type: DataTypes.UUID, field: 'approved_by' },
      rejectedBy:  { type: DataTypes.UUID, field: 'rejected_by' },
      disbursedBy: { type: DataTypes.UUID, field: 'disbursed_by' },

      // 🔧 Problem columns — map to snake_case that exists in DB
      approvalDate:       { type: DataTypes.DATE,  field: 'approval_date' },
      rejectionDate:      { type: DataTypes.DATE,  field: 'rejection_date' }, // renamed (was rejectedDate)
      disbursementDate:   { type: DataTypes.DATE,  field: 'disbursement_date' },
      disbursementMethod: { type: DataTypes.STRING, field: 'disbursement_method' },

      closedBy:    { type: DataTypes.UUID,  field: 'closed_by' },
      closedDate:  { type: DataTypes.DATE,  field: 'closed_date' },
      closeReason: { type: DataTypes.STRING, field: 'close_reason' },

      rescheduledFromId: { type: DataTypes.INTEGER, field: 'rescheduled_from_id' },
      topUpOfId:         { type: DataTypes.INTEGER, field: 'top_up_of_id' },
    },
    {
      tableName: 'loans',
      timestamps: true,
      underscored: false, // keep as-is since your timestamps and many cols are camel in DB
      hooks: {
        beforeValidate: async (loan) => {
          if (!loan.reference) {
            const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
            loan.reference = `LN-${(loan.borrowerId || 'X')}-${rnd}`;
          }
          if (!loan.endDate && loan.startDate && loan.termMonths != null) {
            loan.endDate = addMonthsDateOnly(loan.startDate, Number(loan.termMonths));
          }
        },
      },
    }
  );

  function addMonthsDateOnly(dateStr, months) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const target = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + months, dt.getUTCDate()));
    if (target.getUTCMonth() !== ((m - 1 + months) % 12 + 12) % 12) target.setUTCDate(0);
    return target.toISOString().slice(0, 10);
  }

  return Loan;
};
