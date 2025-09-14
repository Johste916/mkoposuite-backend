'use strict';

module.exports = (sequelize, DataTypes) => {
  const Bank = sequelize.define('Bank', {
    id:            { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenantId:      { type: DataTypes.UUID, allowNull: false, field: 'tenant_id' },

    name:          { type: DataTypes.STRING(120), allowNull: false },
    code:          { type: DataTypes.STRING(32),  allowNull: true },
    branch:        { type: DataTypes.STRING(120), allowNull: true },

    accountName:   { type: DataTypes.STRING(160), allowNull: true, field: 'account_name' },
    accountNumber: { type: DataTypes.STRING(64),  allowNull: true, field: 'account_number' },
    swift:         { type: DataTypes.STRING(64),  allowNull: true },
    phone:         { type: DataTypes.STRING(64),  allowNull: true },
    address:       { type: DataTypes.TEXT,        allowNull: true },

    currency: {
      type: DataTypes.STRING(8),
      allowNull: false,
      defaultValue: 'TZS',
      set(v) {
        if (typeof v === 'string') this.setDataValue('currency', v.trim().toUpperCase());
        else this.setDataValue('currency', v);
      }
    },

    openingBalance:{ type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'opening_balance' },
    currentBalance:{ type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0, field: 'current_balance' },
    isActive:      { type: DataTypes.BOOLEAN,      allowNull: false, defaultValue: true, field: 'is_active' },

    meta:          { type: DataTypes.JSONB,        allowNull: true },
  }, {
    tableName: 'banks',
    schema: 'public',
    freezeTableName: true,
    // keep default camelCase timestamps since your table appears to have createdAt/updatedAt
    indexes: [
      { fields: ['tenant_id'] },
      { fields: ['tenant_id', 'name'] },
      { fields: ['tenant_id', 'account_number'], unique: false },
      { fields: ['is_active'] },
    ],
  });

  return Bank;
};
