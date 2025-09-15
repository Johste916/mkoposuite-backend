'use strict';

module.exports = (sequelize, DataTypes) => {
  const CashTransaction = sequelize.define('CashTransaction', {
    id:             { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    tenantId:       { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
    cashAccountId:  { type: DataTypes.UUID, allowNull: false, field: 'cash_account_id' },

    direction:      { type: DataTypes.ENUM('in','out'), allowNull: false },
    type:           { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'other' },
    amount:         { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
    currency:       { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS' },

    occurredAt:     { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'occurred_at' },
    status:         { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'posted' },

    reference:      { type: DataTypes.STRING(120), allowNull: true },
    description:    { type: DataTypes.TEXT, allowNull: true },

    loanId:         { type: DataTypes.UUID, allowNull: true, field: 'loan_id' },
    borrowerId:     { type: DataTypes.UUID, allowNull: true, field: 'borrower_id' },
    createdBy:      { type: DataTypes.UUID, allowNull: true, field: 'created_by' },

    // cash reconciliation fields (if present in your DB)
    reconciled:     { type: DataTypes.BOOLEAN, allowNull: true },
    reconciledAt:   { type: DataTypes.DATE, allowNull: true, field: 'reconciled_at' },
    reconciledBy:   { type: DataTypes.UUID, allowNull: true, field: 'reconciled_by' },

    meta:           { type: DataTypes.JSONB, allowNull: true },
  }, {
    tableName: 'cash_transactions',
    schema: 'public',
    underscored: true,
    timestamps: true,
    createdAt: 'createdAt',   // <-- maps to camelCase column created by migrations
    updatedAt: 'updatedAt',
  });

  return CashTransaction;
};
