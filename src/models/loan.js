'use strict';

module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // FKs (DB reality)
      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' }, // confirmed camelCase exists
      productId:  { type: DataTypes.INTEGER, allowNull: true,  field: 'product_id' }, // DB uses product_id
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branch_id' },  // prefer branch_id
      tenantId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'tenant_id' },

      // Officer: either explicit loan_officer_id (int/uuid) or disbursed_by (uuid user)
      loanOfficerId: { type: DataTypes.UUID, allowNull: true, field: 'loan_officer_id' },
      disbursedBy:   { type: DataTypes.UUID, allowNull: true, field: 'disbursed_by' },
      officerId: {
        type: DataTypes.VIRTUAL,
        get() {
          // Controller will also read officerId from payments if needed; this is a convenience.
          return this.getDataValue('loanOfficerId') || this.getDataValue('disbursedBy') || null;
        },
        set() {},
      },

      reference: { type: DataTypes.STRING, unique: true, field: 'reference' },

      // Money & terms
      amount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'amount' },
      currency:     { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS', field: 'currency' },
      interestRate: { type: DataTypes.DECIMAL(10, 4), field: 'interestRate' },
      termMonths:   { type: DataTypes.INTEGER, allowNull: true,  field: 'term_months' },

      // Dates — Prefer snake_case columns where present
      startDate:         { type: DataTypes.DATEONLY, allowNull: true, field: 'start_date' },
      endDate:           { type: DataTypes.DATEONLY, allowNull: true, field: 'end_date' },
      approvalDate:      { type: DataTypes.DATE,     allowNull: true, field: 'approval_date' },
      rejectionDate:     { type: DataTypes.DATE,     allowNull: true, field: 'rejection_date' },
      disbursementDate:  { type: DataTypes.DATE,     allowNull: true, field: 'disbursement_date' }, // PG hinted this exists
      disbursementMethod:{ type: DataTypes.STRING,   allowNull: true, field: 'disbursementMethod' }, // you mentioned camelCase

      // Status & aggregates
      status:        { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending', field: 'status' },
      totalInterest: { type: DataTypes.DECIMAL(14, 2), field: 'total_interest' },
      totalPaid:     { type: DataTypes.DECIMAL(14, 2), field: 'total_paid' },
      outstanding:   { type: DataTypes.DECIMAL(14, 2), field: 'outstanding' },

      // Close info
      closedBy:    { type: DataTypes.UUID,  field: 'closed_by' },
      closedDate:  { type: DataTypes.DATE,  field: 'closed_date' },
      closeReason: { type: DataTypes.STRING, field: 'close_reason' },
      rescheduledFromId: { type: DataTypes.INTEGER, field: 'rescheduled_from_id' },
      topUpOfId:         { type: DataTypes.INTEGER, field: 'top_up_of_id' },
    },
    {
      tableName: 'loans',
      freezeTableName: true,
      timestamps: true,
      underscored: true, // created_at / updated_at in PG are common
      hooks: {
        beforeValidate: (loan) => {
          if (!loan.reference) {
            const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
            loan.reference = `LN-${(loan.borrowerId || 'X')}-${rnd}`;
          }
          // backfill endDate if we have startDate + termMonths
          if (!loan.endDate && loan.startDate && loan.termMonths != null) {
            loan.endDate = addMonthsDateOnly(loan.startDate, Number(loan.termMonths));
          }
        },
      },
      indexes: [
        { fields: ['borrowerId'] },
        { fields: ['product_id'] },
        { fields: ['branch_id'] },
        { fields: ['status'] },
        { fields: ['disbursement_date'] },
        { fields: ['created_at'] },
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

  Loan.associate = (models) => {
    if (models.Borrower && !Loan.associations?.Borrower) {
      Loan.belongsTo(models.Borrower, { as: 'Borrower', foreignKey: 'borrowerId', targetKey: 'id' });
    }
    if (models.User && !Loan.associations?.DisbursedBy) {
      Loan.belongsTo(models.User, { as: 'DisbursedBy', foreignKey: 'disbursedBy', targetKey: 'id', constraints: false });
    }
    if (models.Branch && !Loan.associations?.Branch) {
      Loan.belongsTo(models.Branch, { as: 'Branch', foreignKey: 'branchId', targetKey: 'id', constraints: false });
    }
  };

  return Loan;
};
