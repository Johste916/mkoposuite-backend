'use strict';
module.exports = (sequelize, DataTypes) => {
  const CashTransaction = sequelize.define('CashTransaction', {
    id:             { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    tenantId:       { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
    cashAccountId:  { type: DataTypes.UUID, allowNull: false, field: 'cash_account_id' },
    direction:      { type: DataTypes.ENUM('in', 'out'), allowNull: false },
    type:           { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'other' },
    amount:         { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
    currency:       { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS' },
    occurredAt:     { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'occurred_at' },
    status:         { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'posted' },
    reference:      { type: DataTypes.STRING(120) },
    description:    { type: DataTypes.TEXT },
    loanId:         { type: DataTypes.UUID, field: 'loan_id' },
    borrowerId:     { type: DataTypes.UUID, field: 'borrower_id' },
    createdBy:      { type: DataTypes.UUID, field: 'created_by' },
    reconciled:     { type: DataTypes.BOOLEAN },
    reconciledAt:   { type: DataTypes.DATE, field: 'reconciled_at' },
    reconciledBy:   { type: DataTypes.UUID, field: 'reconciled_by' },
    meta:           { type: DataTypes.JSONB },
  }, {
    tableName: 'cash_transactions',
    schema: 'public',
    underscored: true,
    // 👇 important
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  });
  return CashTransaction;
};
