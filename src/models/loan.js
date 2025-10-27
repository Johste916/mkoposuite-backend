'use strict';

module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // FKs
      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' }, // camel in DB
      productId:  { type: DataTypes.INTEGER, allowNull: true,  field: 'product_id' }, // snake in DB
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branchId' },   // camel in DB

      // Business refs / users
      approvedBy:  { type: DataTypes.UUID, allowNull: true, field: 'approved_by' },  // snake exists
      rejectedBy:  { type: DataTypes.UUID, allowNull: true, field: 'rejected_by' },
      disbursedBy: { type: DataTypes.UUID, allowNull: true, field: 'disbursed_by' },

      // Core
      reference:     { type: DataTypes.STRING(255), allowNull: true, field: 'reference' },
      amount:        { type: DataTypes.DOUBLE, allowNull: false, field: 'amount' },
      currency:      { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS', field: 'currency' },
      interestRate:  { type: DataTypes.DOUBLE, allowNull: false, field: 'interestRate' }, // camel in DB
      startDate:     { type: DataTypes.DATEONLY, allowNull: false, field: 'startDate' },  // camel in DB
      endDate:       { type: DataTypes.DATEONLY, allowNull: false, field: 'endDate' },    // camel in DB

      repaymentFrequency: { type: DataTypes.STRING, allowNull: false, field: 'repaymentFrequency' }, // enum in DB
      interestMethod:     { type: DataTypes.STRING, allowNull: false, field: 'interestMethod' },     // enum in DB
      status:             { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending', field: 'status' },

      // Dates (dual forms in table — prefer snake where it exists)
      approvalDate:     { type: DataTypes.DATE, allowNull: true, field: 'approval_date' },
      rejectionDate:    { type: DataTypes.DATE, allowNull: true, field: 'rejection_date' },
      disbursementDate: { type: DataTypes.DATE, allowNull: true, field: 'disbursement_date' },

      // Aggregates
      totalInterest:     { type: DataTypes.DECIMAL, allowNull: true, defaultValue: 0, field: 'total_interest' },
      totalPaid:         { type: DataTypes.DECIMAL, allowNull: true, defaultValue: 0, field: 'total_paid' },
      outstanding:       { type: DataTypes.DECIMAL, allowNull: true, defaultValue: 0, field: 'outstanding' },
      outstandingAmount: { type: DataTypes.DECIMAL, allowNull: true, field: 'outstandingAmount' }, // camel exists
      nextDueDate:       { type: DataTypes.DATEONLY, allowNull: true, field: 'nextDueDate' },      // camel exists
      nextDueAmount:     { type: DataTypes.DECIMAL, allowNull: true, field: 'nextDueAmount' },     // camel exists

      // Term
      termMonths: { type: DataTypes.INTEGER, allowNull: true, field: 'term_months' },

      // Close / reschedule
      closedBy:          { type: DataTypes.INTEGER, allowNull: true, field: 'closed_by' },
      closedDate:        { type: DataTypes.DATE, allowNull: true, field: 'closed_date' },
      closeReason:       { type: DataTypes.STRING(255), allowNull: true, field: 'close_reason' },
      rescheduledFromId: { type: DataTypes.INTEGER, allowNull: true, field: 'rescheduled_from_id' },
      topUpOfId:         { type: DataTypes.INTEGER, allowNull: true, field: 'top_up_of_id' },

      // Timestamps in your DB are camelCase columns
      createdAt: { type: DataTypes.DATE, allowNull: true, field: 'createdAt' },
      updatedAt: { type: DataTypes.DATE, allowNull: true, field: 'updatedAt' },
    },
    {
      tableName: 'loans',
      freezeTableName: true,
      timestamps: true,          // uses createdAt/updatedAt by default
      underscored: false,        // your table uses camel for timestamps & many cols
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
      indexes: [
        { fields: ['borrowerId'] },
        { fields: ['product_id'] },
        { fields: ['branchId'] },
        { fields: ['status'] },
        { fields: ['disbursement_date'] },
        { fields: ['createdAt'] },   // camel in your table
      ],
    }
  );

  function addMonthsDateOnly(dateStr, months) {
    if (!dateStr) return null;
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d || 1));
    const target = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + months, dt.getUTCDate()));
    if (target.getUTCMonth() !== ((m - 1 + months) % 12 + 12) % 12) target.setUTCDate(0);
    return target.toISOString().slice(0, 10);
  }

  return Loan;
};
