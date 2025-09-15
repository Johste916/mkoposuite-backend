'use strict';

module.exports = (sequelize, DataTypes) => {
  const Bank = sequelize.define('Bank', {
    id:              { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
    tenantId:        { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },
    name:            { type: DataTypes.STRING(160), allowNull: false },
    code:            { type: DataTypes.STRING(64), allowNull: true },
    branch:          { type: DataTypes.STRING(160), allowNull: true },

    accountName:     { type: DataTypes.STRING(160), allowNull: true, field: 'account_name' },
    accountNumber:   { type: DataTypes.STRING(64),  allowNull: true, field: 'account_number' },

    // legacy physical columns (safe to keep mapped if they still exist)
    accountNameLegacy:   { type: DataTypes.STRING(160), allowNull: true, field: 'accountName' },
    accountNumberLegacy: { type: DataTypes.STRING(64),  allowNull: true, field: 'accountNumber' },

    swift:           { type: DataTypes.STRING(64), allowNull: true },
    phone:           { type: DataTypes.STRING(64), allowNull: true },
    address:         { type: DataTypes.TEXT,        allowNull: true },

    currency:        { type: DataTypes.STRING(8),   allowNull: false, defaultValue: 'TZS' },
    openingBalance:  { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'opening_balance' },
    currentBalance:  { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'current_balance' },
    isActive:        { type: DataTypes.BOOLEAN,     allowNull: false, defaultValue: true, field: 'is_active' },
  }, {
    tableName: 'banks',
    schema: 'public',

    // Keep snake_case for non-timestamp fields
    underscored: true,

    // ✅ IMPORTANT: Your DB has camelCase timestamp columns (createdAt/updatedAt)
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',

    // If any list uses default ordering by creation time, do it with the attribute name
    defaultScope: {
      order: [['createdAt', 'DESC']],
    },
  });

  return Bank;
};
