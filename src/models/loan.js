// src/models/loan.js
module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },

      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' },
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branchId' },
      productId:  { type: DataTypes.INTEGER, allowNull: false, field: 'product_id' },

      reference:  { type: DataTypes.STRING, unique: true },

      amount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency:     { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS' },
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

      // keep as string; PG column is enum and will validate labels
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'pending',
        field: 'status',
      },

      totalInterest: { type: DataTypes.DECIMAL(14, 2), field: 'total_interest' },
      outstanding:   { type: DataTypes.DECIMAL(14, 2), field: 'outstanding' },

      // UUID FKs (you showed Users.id is uuid)
      initiatedBy:  { type: DataTypes.UUID, field: 'initiated_by' },
      approvedBy:   { type: DataTypes.UUID, field: 'approved_by' },
      rejectedBy:   { type: DataTypes.UUID, field: 'rejected_by' },
      disbursedBy:  { type: DataTypes.UUID, field: 'disbursed_by' },

      approvalDate:     { type: DataTypes.DATE, field: 'approvalDate' },
      rejectedDate:     { type: DataTypes.DATE, field: 'rejectionDate' }, // <-- maps correctly
      disbursementDate: { type: DataTypes.DATE, field: 'disbursementDate' },
      disbursementMethod: { type: DataTypes.STRING, field: 'disbursementMethod' },

      closedBy:     { type: DataTypes.UUID, field: 'closed_by' },
      closedDate:   { type: DataTypes.DATE,  field: 'closed_date' },
      closeReason:  { type: DataTypes.STRING, field: 'closeReason' },     // <-- camel in DB

      rescheduledFromId: { type: DataTypes.UUID, field: 'rescheduledFromId' },
      topUpOfId:         { type: DataTypes.UUID, field: 'topUpOfId' },
    },
    {
      tableName: 'loans',
      timestamps: true,
      underscored: false,
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
