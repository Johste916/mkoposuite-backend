'use strict';

module.exports = (sequelize, DataTypes) => {
  const Bank = sequelize.define('Bank', {
    id:            { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenantId:      { type: DataTypes.UUID, allowNull: false },
    name:          { type: DataTypes.STRING(120), allowNull: false },
    code:          { type: DataTypes.STRING(32),  allowNull: true },
    branch:        { type: DataTypes.STRING(120), allowNull: true },
    accountName:   { type: DataTypes.STRING(160), allowNull: true },
    accountNumber: { type: DataTypes.STRING(64),  allowNull: true },
    swift:         { type: DataTypes.STRING(64),  allowNull: true },
    phone:         { type: DataTypes.STRING(64),  allowNull: true },
    address:       { type: DataTypes.TEXT,        allowNull: true },

    // ✅ New column that your queries already expect
    currency: {
      type: DataTypes.STRING(8),
      allowNull: false,
      defaultValue: 'TZS',
      set(v) {
        if (typeof v === 'string') this.setDataValue('currency', v.trim().toUpperCase());
        else this.setDataValue('currency', v);
      }
    },

    openingBalance:{ type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
    currentBalance:{ type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
    isActive:      { type: DataTypes.BOOLEAN,      allowNull: false, defaultValue: true },
    meta:          { type: DataTypes.JSONB,        allowNull: true },
  }, {
    tableName: 'banks',
    indexes: [
      { fields: ['tenantId'] },
      { fields: ['tenantId', 'name'] },
      { fields: ['tenantId', 'accountNumber'], unique: false },
      { fields: ['isActive'] },
    ],
  });

  return Bank;
};
