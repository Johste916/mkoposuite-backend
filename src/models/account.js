'use strict';

/**
 * Account
 *  - code: unique code (e.g., 1000)
 *  - name: human-friendly name (e.g., Cash)
 *  - type: 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'cash' | 'bank'
 *  - parentId: optional parent for hierarchy
 */
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');

  class Account extends Model {}

  Account.init(
    {
      code:  { type: DataTypes.STRING(32),  allowNull: false, unique: true, validate: { len: [1, 32] } },
      name:  { type: DataTypes.STRING(128), allowNull: false, validate: { len: [1, 128] } },
      type:  { type: DataTypes.STRING(32),  allowNull: false, validate: { len: [1, 32] } },
      parentId: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Account',
      tableName: 'Accounts',
      timestamps: true,
      underscored: false,
      indexes: [
        { unique: true, fields: ['code'] },
        { fields: ['type'] },
        { fields: ['parentId'] },
      ],
    }
  );

  return Account;
};
