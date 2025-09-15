'use strict';
module.exports = (sequelize, DataTypes) => {
  const Bank = sequelize.define('Bank', {
    id:         { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    tenantId:   { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
    name:       { type: DataTypes.STRING(160), allowNull: false },
    code:       { type: DataTypes.STRING(64) },
    branch:     { type: DataTypes.STRING(160) },
    accountName:{ type: DataTypes.STRING(160), field: 'account_name' },
    accountNumber:{ type: DataTypes.STRING(64), field: 'account_number' },
    swift:      { type: DataTypes.STRING(64) },
    phone:      { type: DataTypes.STRING(64) },
    address:    { type: DataTypes.TEXT },
    currency:   { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'TZS' },
    openingBalance: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'opening_balance' },
    currentBalance: { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'current_balance' },
    isActive:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    meta:       { type: DataTypes.JSONB },
  }, {
    tableName: 'banks',
    schema: 'public',
    underscored: true,
    // 👇 important
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  });
  return Bank;
};
