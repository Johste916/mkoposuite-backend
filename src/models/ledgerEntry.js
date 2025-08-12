'use strict';

/**
 * LedgerEntry
 *  - journalEntryId: FK -> JournalEntry
 *  - accountId: FK -> Account
 *  - date: entry date (typically same as JournalEntry.date)
 *  - debit: decimal(18,2)
 *  - credit: decimal(18,2)
 *  - description: optional line memo
 */
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');

  class LedgerEntry extends Model {}

  LedgerEntry.init(
    {
      journalEntryId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      accountId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      debit: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      credit: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'LedgerEntry',
      tableName: 'LedgerEntries',
      timestamps: true,
      underscored: false,
      indexes: [
        { fields: ['date'] },
        { fields: ['accountId'] },
        { fields: ['journalEntryId'] },
      ],
    }
  );

  return LedgerEntry;
};
