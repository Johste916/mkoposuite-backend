'use strict';
module.exports = (sequelize, DataTypes) => {
  const CashAccount = sequelize.define('CashAccount', {
    id:              { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    tenantId:        { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
    name:            { type: DataTypes.STRING(160), allowNull: false },
    branchId:        { type: DataTypes.UUID, allowNull: true, field: 'branch_id' },
    openingBalance:  { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'opening_balance' },
    currentBalance:  { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'current_balance' },
    currency:        { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS' },
    isActive:        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    meta:            { type: DataTypes.JSONB, allowNull: true },
  }, {
    tableName: 'cash_accounts',
    schema: 'public',
    underscored: true,
  });

  return CashAccount;
};
