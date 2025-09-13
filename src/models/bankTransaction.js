'use strict';

module.exports = (sequelize, DataTypes) => {
  const BankTransaction = sequelize.define('BankTransaction', {
    id:          { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenantId:    { type: DataTypes.UUID, allowNull: false },
    bankId:      { type: DataTypes.UUID, allowNull: false },

    direction:   { type: DataTypes.STRING(8), allowNull: false }, // 'in' | 'out'
    type:        { type: DataTypes.STRING(32), allowNull: false }, // deposit, withdrawal, loan_repayment, disbursement, fee, transfer_in, transfer_out, other
    amount:      { type: DataTypes.DECIMAL(18,2), allowNull: false },
    currency:    { type: DataTypes.STRING(8), allowNull: true, defaultValue: 'TZS' },

    occurredAt:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    reference:   { type: DataTypes.STRING(120), allowNull: true },
    bankRef:     { type: DataTypes.STRING(120), allowNull: true }, // external bank statement ref
    description: { type: DataTypes.TEXT, allowNull: true },
    note:        { type: DataTypes.TEXT, allowNull: true },
    status:      { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'posted' }, // pending|posted|void

    loanId:      { type: DataTypes.UUID, allowNull: true },
    borrowerId:  { type: DataTypes.UUID, allowNull: true },

    // reconciliation
    reconciled:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    reconciledAt: { type: DataTypes.DATE, allowNull: true },
    reconciledBy: { type: DataTypes.UUID, allowNull: true },

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
      { fields: ['reconciled'] },
    ],
  });

  // helper
  const has = (m, k) => !!(m && m.rawAttributes && (m.rawAttributes[k] || Object.values(m.rawAttributes).some(a => a.field === k)));

  // Balance & optional loan repayment creation
  BankTransaction.afterCreate(async (tx, options) => {
    if (tx.status === 'void') return;

    const sign = (tx.direction === 'out' ? -1 : 1);
    const Bank = sequelize.models.Bank;

    try {
      await Bank.update(
        { currentBalance: sequelize.literal(`"currentBalance" + (${sign} * ${Number(tx.amount)})`) },
        { where: { id: tx.bankId }, transaction: options?.transaction }
      );
    } catch {}

    if (tx.type === 'loan_repayment' && tx.loanId) {
      const { Loan, LoanPayment, LoanRepayment } = sequelize.models;
      const t = options?.transaction;

      if (LoanPayment) {
        const payload = {};
        if (has(LoanPayment, 'loanId'))      payload.loanId = tx.loanId;
        if (has(LoanPayment, 'amount'))      payload.amount = tx.amount;
        if (has(LoanPayment, 'paidAt'))      payload.paidAt = tx.occurredAt;
        if (has(LoanPayment, 'paymentDate')) payload.paymentDate = tx.occurredAt;
        if (has(LoanPayment, 'method'))      payload.method = 'bank';
        if (has(LoanPayment, 'reference'))   payload.reference = tx.reference || `BANK:${tx.id}`;
        if (has(LoanPayment, 'createdBy'))   payload.createdBy = tx.createdBy || null;
        try { await LoanPayment.create(payload, { transaction: t }); } catch {}
      } else if (LoanRepayment) {
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
