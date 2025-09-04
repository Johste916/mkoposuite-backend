// backend/src/models/account.js
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

  class Account extends Model {
    static associate(models) {
      // Optional self-referencing hierarchy
      Account.hasMany(Account, { as: 'children', foreignKey: 'parentId' });
      Account.belongsTo(Account, { as: 'parent',   foreignKey: 'parentId' });

      // One account has many ledger entries
      if (models.LedgerEntry) {
        Account.hasMany(models.LedgerEntry, { foreignKey: 'accountId', as: 'entries' });
      }
    }
  }

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
      type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        validate: { len: [1, 32] },
        comment: "Mark bank/cash accounts as 'cash' or 'bank' to drive cashflow.",
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
