'use strict';
module.exports = (sequelize, DataTypes) => {
  const BankTransaction = sequelize.define('BankTransaction', {
    id:          { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    tenantId:    { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
    bankId:      { type: DataTypes.UUID, allowNull: false, field: 'bank_id' },
    direction:   { type: DataTypes.ENUM('in', 'out'), allowNull: false },
    type:        { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'other' },
    amount:      { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
    currency:    { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS' },
    occurredAt:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'occurred_at' },
    status:      { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'posted' },
    reference:   { type: DataTypes.STRING(120) },
    bankRef:     { type: DataTypes.STRING(120), field: 'bank_ref' },
    description: { type: DataTypes.TEXT },
    note:        { type: DataTypes.TEXT },
    reconciled:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    reconciledAt:{ type: DataTypes.DATE, field: 'reconciled_at' },
    reconciledBy:{ type: DataTypes.UUID, field: 'reconciled_by' },
    loanId:      { type: DataTypes.UUID, field: 'loan_id' },
    borrowerId:  { type: DataTypes.UUID, field: 'borrower_id' },
    createdBy:   { type: DataTypes.UUID, field: 'created_by' },
    meta:        { type: DataTypes.JSONB },
  }, {
    tableName: 'bank_transactions',
    schema: 'public',
    underscored: true,
    // 👇 important
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  });
  return BankTransaction;
};
