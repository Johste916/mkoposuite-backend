'use strict';

module.exports = (sequelize, DataTypes) => {
  const BankTransaction = sequelize.define('BankTransaction', {
    id:          { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenantId:    { type: DataTypes.UUID, allowNull: false },
    bankId:      { type: DataTypes.UUID, allowNull: false },

    // direction: 'in' adds to balance; 'out' reduces balance
    direction:   { type: DataTypes.STRING(8), allowNull: false }, // 'in' | 'out'
    type:        { type: DataTypes.STRING(32), allowNull: false }, // deposit, withdrawal, loan_repayment, disbursement, fee, transfer_in, transfer_out, other
    amount:      { type: DataTypes.DECIMAL(18,2), allowNull: false },
    currency:    { type: DataTypes.STRING(8), allowNull: true, defaultValue: 'TZS' },

    occurredAt:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    reference:   { type: DataTypes.STRING(120), allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status:      { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'posted' }, // pending|posted|void

    // Links (optional for loan/counterparty analytics)
    loanId:      { type: DataTypes.UUID, allowNull: true },
    borrowerId:  { type: DataTypes.UUID, allowNull: true },

    // audit/meta
    createdBy:   { type: DataTypes.UUID, allowNull: true },
    meta:        { type: DataTypes.JSONB, allowNull: true },
  }, {
    tableName: 'bank_transactions',
    indexes: [
      { fields: ['tenantId'] },
      { fields: ['bankId'] },
      { fields: ['loanId'] },
      { fields: ['borrowerId'] },
      { fields: ['type'] },
      { fields: ['status'] },
      { fields: ['occurredAt'] },
    ],
  });

  // Helper to detect model attr presence
  const has = (m, k) => !!(m && m.rawAttributes && (m.rawAttributes[k] || Object.values(m.rawAttributes).some(a => a.field === k)));

  // Balance + optional loan repayment auto-link
  BankTransaction.afterCreate(async (tx, options) => {
    if (tx.status === 'void') return;

    const sign = (tx.direction === 'out' ? -1 : 1);
    const Bank = sequelize.models.Bank;

    try {
      // Update currentBalance atomically
      await Bank.update(
        { currentBalance: sequelize.literal(`"currentBalance" + (${sign} * ${Number(tx.amount)})`) },
        { where: { id: tx.bankId }, transaction: options?.transaction }
      );
    } catch (e) {
      // non-fatal
    }

    // If this is a loan repayment, try to create a repayment row in existing tables
    if (tx.type === 'loan_repayment' && tx.loanId) {
      const { Loan, LoanPayment, LoanRepayment } = sequelize.models;
      const t = options?.transaction;

      // Create LoanPayment if present
      if (LoanPayment) {
        const payload = {};
        if (has(LoanPayment, 'loanId'))     payload.loanId = tx.loanId;
        if (has(LoanPayment, 'amount'))     payload.amount = tx.amount;
        if (has(LoanPayment, 'paidAt'))     payload.paidAt = tx.occurredAt;
        if (has(LoanPayment, 'paymentDate')) payload.paymentDate = tx.occurredAt;
        if (has(LoanPayment, 'method'))     payload.method = 'bank';
        if (has(LoanPayment, 'reference'))  payload.reference = tx.reference || `BANK:${tx.id}`;
        if (has(LoanPayment, 'createdBy'))  payload.createdBy = tx.createdBy || null;
        try { await LoanPayment.create(payload, { transaction: t }); } catch {}
      }
      // Or create LoanRepayment if present
      else if (LoanRepayment) {
        const payload = {};
        if (has(LoanRepayment, 'loanId'))   payload.loanId = tx.loanId;
        if (has(LoanRepayment, 'amount'))   payload.amount = tx.amount;
        if (has(LoanRepayment, 'date'))     payload.date = tx.occurredAt;
        if (has(LoanRepayment, 'paidAt'))   payload.paidAt = tx.occurredAt;
        if (has(LoanRepayment, 'method'))   payload.method = 'bank';
        if (has(LoanRepayment, 'reference'))payload.reference = tx.reference || `BANK:${tx.id}`;
        if (has(LoanRepayment, 'createdBy'))payload.createdBy = tx.createdBy || null;
        try { await LoanRepayment.create(payload, { transaction: t }); } catch {}
      }

      // Best-effort: reduce a "balance" column on Loan if it exists
      const LoanModel = sequelize.models.Loan;
      if (LoanModel && has(LoanModel, 'balance')) {
        try {
          await LoanModel.update(
            { balance: sequelize.literal(`GREATEST(0, "balance" - ${Number(tx.amount)})`) },
            { where: { id: tx.loanId }, transaction: t }
          );
        } catch {}
      }
    }
  });

  return BankTransaction;
};
