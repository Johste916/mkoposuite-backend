// src/models/loan.js
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: 'id' },

      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' },
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branchId' },

      productId:  { type: DataTypes.INTEGER, allowNull: false, field: 'product_id' },

      reference:  { type: DataTypes.STRING, unique: true },

      amount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency:     { type: DataTypes.STRING(8),      allowNull: false, defaultValue: 'TZS' },
      interestRate: { type: DataTypes.DECIMAL(10, 4), field: 'interestRate' },

      termMonths: { type: DataTypes.INTEGER, allowNull: false, field: 'term_months' },

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
        type: DataTypes.ENUM('pending', 'approved', 'rejected', 'disbursed', 'closed'),
        allowNull: false,
        defaultValue: 'pending',
        field: 'status',
      },

      totalInterest: { type: DataTypes.DECIMAL(14, 2), field: 'total_interest' },
      outstanding:   { type: DataTypes.DECIMAL(14, 2), field: 'outstanding' },

      // UUID FKs (snake_case fields)
      initiatedBy:      { type: DataTypes.UUID, allowNull: true, field: 'initiated_by' },
      approvedBy:       { type: DataTypes.UUID, allowNull: true, field: 'approved_by' },
      approvalDate:     { type: DataTypes.DATE, allowNull: true, field: 'approvalDate' },

      rejectedBy:       { type: DataTypes.UUID, allowNull: true, field: 'rejected_by' },
      // ⬇️ IMPORTANT: DB column is "rejectionDate"
      rejectedDate:     { type: DataTypes.DATE, allowNull: true, field: 'rejectionDate' },

      disbursedBy:      { type: DataTypes.UUID, allowNull: true, field: 'disbursed_by' },
      disbursementDate: { type: DataTypes.DATE, allowNull: true, field: 'disbursementDate' },
      disbursementMethod: { type: DataTypes.STRING, allowNull: true, field: 'disbursementMethod' },

      closedBy:    { type: DataTypes.UUID, allowNull: true, field: 'closed_by' },
      closedDate:  { type: DataTypes.DATE, allowNull: true, field: 'closed_date' },
      closeReason: { type: DataTypes.STRING, allowNull: true, field: 'close_reason' },

      rescheduledFromId: { type: DataTypes.INTEGER, allowNull: true, field: 'rescheduledFromId' },
      topUpOfId:         { type: DataTypes.INTEGER, allowNull: true, field: 'topUpOfId' },
    },
    {
      tableName: 'loans',
      timestamps: true,
      underscored: false,
      hooks: {
        beforeValidate: (loan) => {
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
    const targetMonthIndex = dt.getUTCMonth() + Number(months);
    const target = new Date(Date.UTC(dt.getUTCFullYear(), targetMonthIndex, dt.getUTCDate()));
    if (target.getUTCMonth() !== ((m - 1 + Number(months)) % 12 + 12) % 12) {
      target.setUTCDate(0);
    }
    return target.toISOString().slice(0, 10);
  }

  return Loan;
};
