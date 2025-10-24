'use strict';

module.exports = (sequelize, DataTypes) => {
  const Loan = sequelize.define(
    'Loan',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // FKs — match DB reality
      borrowerId: { type: DataTypes.INTEGER, allowNull: false, field: 'borrowerId' },  // DB camel
      productId:  { type: DataTypes.INTEGER, allowNull: true,  field: 'product_id' },  // DB snake
      branchId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'branchId' },    // 👈 DB camel
      tenantId:   { type: DataTypes.INTEGER, allowNull: true,  field: 'tenant_id' },   // DB snake

      // Officer (either loan_officer_id or disbursed_by)
      loanOfficerId: { type: DataTypes.UUID, allowNull: true, field: 'loan_officer_id' },
      disbursedBy:   { type: DataTypes.UUID, allowNull: true, field: 'disbursed_by' },
      officerId: {
        type: DataTypes.VIRTUAL,
        get() { return this.getDataValue('loanOfficerId') || this.getDataValue('disbursedBy') || null; },
        set() {},
      },

      reference: { type: DataTypes.STRING, unique: true, field: 'reference' },

      // Money & terms
      amount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'amount' },
      currency:     { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS', field: 'currency' },
      interestRate: { type: DataTypes.DECIMAL(10, 4), field: 'interestRate' },   // DB camel? keep as-is if exists
      termMonths:   { type: DataTypes.INTEGER, field: 'term_months' },           // DB snake

      // Dates
      startDate:         { type: DataTypes.DATEONLY, field: 'start_date' },
      endDate:           { type: DataTypes.DATEONLY, field: 'end_date' },
      approvalDate:      { type: DataTypes.DATE,     field: 'approval_date' },
      rejectionDate:     { type: DataTypes.DATE,     field: 'rejection_date' },
      disbursementDate:  { type: DataTypes.DATE,     field: 'disbursement_date' }, // DB snake
      disbursementMethod:{ type: DataTypes.STRING,   field: 'disbursementMethod' }, // DB camel? keep as-is if exists

      // Status & aggregates
      status:        { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending', field: 'status' },
      totalInterest: { type: DataTypes.DECIMAL(14, 2), field: 'total_interest' },
      totalPaid:     { type: DataTypes.DECIMAL(14, 2), field: 'total_paid' },
      outstanding:   { type: DataTypes.DECIMAL(14, 2), field: 'outstanding' },

      // Close info
      closedBy:          { type: DataTypes.UUID,   field: 'closed_by' },
      closedDate:        { type: DataTypes.DATE,   field: 'closed_date' },
      closeReason:       { type: DataTypes.STRING, field: 'close_reason' },
      rescheduledFromId: { type: DataTypes.INTEGER, field: 'rescheduled_from_id' },
      topUpOfId:         { type: DataTypes.INTEGER, field: 'top_up_of_id' },
    },
    {
      tableName: 'loans',
      freezeTableName: true,
      // Your "index" setup uses camel timestamps globally; but logs show loans has created_at/updated_at.
      // We'll keep underscored timestamps here specifically for loans:
      timestamps: true,
      underscored: true,                 // created_at / updated_at in this table
      createdAt: 'created_at',
      updatedAt: 'updated_at',
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
        { fields: ['borrowerId'] },         // camel - exists in DB
        { fields: ['product_id'] },         // snake - exists in DB
        { fields: ['branchId'] },           // 👈 camel - fix from branch_id
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

  // ❌ Remove per-model associations to avoid alias conflicts.
  // We'll rely on models/index.js to wire associations consistently.
  // Loan.associate = (models) => { /* intentionally empty */ };

  return Loan;
};
