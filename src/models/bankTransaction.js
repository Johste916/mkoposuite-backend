'use strict';

module.exports = (sequelize, DataTypes) => {
  const BankTransaction = sequelize.define('BankTransaction', {
    id:           { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenantId:     { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
    bankId:       { type: DataTypes.UUID, allowNull: false, field: 'bank_id' },

    direction:    { type: DataTypes.STRING(8),  allowNull: false }, // in|out
    type:         { type: DataTypes.STRING(32), allowNull: false },
    amount:       { type: DataTypes.DECIMAL(18,2), allowNull: false },
    currency:     { type: DataTypes.STRING(8), allowNull: true },

    occurredAt:   { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'occurred_at' },
    reference:    { type: DataTypes.STRING(120), allowNull: true },
    description:  { type: DataTypes.TEXT, allowNull: true },
    status:       { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'posted' },

    bankRef:      { type: DataTypes.STRING(120), allowNull: true, field: 'bank_ref' },
    note:         { type: DataTypes.TEXT, allowNull: true },

    reconciled:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    reconciledAt: { type: DataTypes.DATE, allowNull: true, field: 'reconciled_at' },
    reconciledBy: { type: DataTypes.UUID, allowNull: true, field: 'reconciled_by' },

    loanId:       { type: DataTypes.UUID, allowNull: true, field: 'loan_id' },
    borrowerId:   { type: DataTypes.UUID, allowNull: true, field: 'borrower_id' },
    createdBy:    { type: DataTypes.UUID, allowNull: true, field: 'created_by' },

    meta:         { type: DataTypes.JSONB, allowNull: true },
  }, {
    tableName: 'bank_transactions',
    schema: 'public',
    freezeTableName: true,
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['bank_id'] },
      { fields: ['type'] },
      { fields: ['status'] },
      { fields: ['occurred_at'] },
      { fields: ['loan_id'] },
      { fields: ['borrower_id'] },
      { fields: ['reconciled'] },
    ]
  });

  return BankTransaction;
};
