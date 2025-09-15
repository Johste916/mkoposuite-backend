'use strict';
module.exports = (sequelize, DataTypes) => {
  const BankTransaction = sequelize.define('BankTransaction', {
    id:            { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    tenantId:      { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
    bankId:        { type: DataTypes.UUID, allowNull: false, field: 'bank_id' },
    direction:     { type: DataTypes.ENUM('in','out'), allowNull: false },
    type:          { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'other' },
    amount:        { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
    currency:      { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS' },
    occurredAt:    { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'occurred_at' },
    status:        { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'posted' },
    reference:     { type: DataTypes.STRING(120), allowNull: true },
    bankRef:       { type: DataTypes.STRING(120), allowNull: true, field: 'bank_ref' },
    description:   { type: DataTypes.TEXT, allowNull: true },
    note:          { type: DataTypes.TEXT, allowNull: true },
    reconciled:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    reconciledAt:  { type: DataTypes.DATE, allowNull: true, field: 'reconciled_at' },
    reconciledBy:  { type: DataTypes.UUID, allowNull: true, field: 'reconciled_by' },
    loanId:        { type: DataTypes.UUID, allowNull: true, field: 'loan_id' },
    borrowerId:    { type: DataTypes.UUID, allowNull: true, field: 'borrower_id' },
    createdBy:     { type: DataTypes.UUID, allowNull: true, field: 'created_by' },
    meta:          { type: DataTypes.JSONB, allowNull: true },
  }, {
    tableName: 'bank_transactions',
    schema: 'public',
    underscored: true,     // keep snake_case for non-timestamp fields
    timestamps: true,
    createdAt: 'createdAt',  // <-- tell Sequelize your DB uses camelCase
    updatedAt: 'updatedAt',
  });
  return BankTransaction;
};
