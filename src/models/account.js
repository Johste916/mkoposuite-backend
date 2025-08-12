'use strict';

/**
 * Account
 *  - code: unique code (e.g., 1000)
 *  - name: human-friendly name (e.g., Cash)
 *  - type: 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'cash'
 *  - parentId: optional parent account for hierarchy
 */
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');

  class Account extends Model {}

  Account.init(
    {
      code: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
        validate: { len: [1, 32] },
      },
      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
        validate: { len: [1, 128] },
      },
      /**
       * Mark bank/cash accounts as 'cash' to drive cashflow endpoint.
       * You can keep this as a free string if you don't want ENUM constraints.
       */
      type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        validate: { len: [1, 32] },
        // Example if you want to enforce allowed values:
        // validate: { isIn: [['asset','liability','equity','income','expense','cash']] }
      },
      parentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Account',
      tableName: 'Accounts',
      timestamps: true,
      // If you want snake_case columns, set underscored: true (kept false to match your style)
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
