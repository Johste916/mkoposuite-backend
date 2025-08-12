'use strict';

/**
 * JournalEntry
 *  - date: accounting date (YYYY-MM-DD)
 *  - memo: optional description
 *
 * Has many LedgerEntry (see associations in models/index.js)
 */
module.exports = (sequelize, DataTypes) => {
  const { Model } = require('sequelize');

  class JournalEntry extends Model {}

  JournalEntry.init(
    {
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      memo: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'JournalEntry',
      tableName: 'JournalEntries',
      timestamps: true,
      underscored: false,
      indexes: [
        { fields: ['date'] },
      ],
    }
  );

  return JournalEntry;
};
