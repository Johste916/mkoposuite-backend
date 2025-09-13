'use strict';

module.exports = (sequelize, DataTypes) => {
  const CashAccount = sequelize.define('CashAccount', {
    id:             { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenantId:       { type: DataTypes.UUID, allowNull: false },
    name:           { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'Main Cash' },
    branchId:       { type: DataTypes.UUID, allowNull: true },
    openingBalance: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
    currentBalance: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
    currency:       { type: DataTypes.STRING(8), allowNull: true, defaultValue: 'TZS' },
    isActive:       { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    meta:           { type: DataTypes.JSONB, allowNull: true },
  }, {
    tableName: 'cash_accounts',
    indexes: [
      { fields: ['tenantId'] },
      { fields: ['tenantId', 'name'] },
      { fields: ['branchId'] },
    ],
  });

  return CashAccount;
};
