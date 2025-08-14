'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, DATEONLY, DECIMAL, STRING } = Sequelize;

    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.createTable('LedgerEntries', {
        id: { type: INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },

        journalEntryId: {
          type: INTEGER,
          allowNull: false,
          references: { model: 'JournalEntries', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE', // deleting a journal deletes its lines
        },

        accountId: {
          type: INTEGER,
          allowNull: false,
          references: { model: 'Accounts', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT', // prevent deleting account if lines exist
        },

        date: { type: DATEONLY, allowNull: false },
        debit: { type: DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        credit: { type: DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        description: { type: STRING(255), allowNull: true },

        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });

      // Indexes for performance
      await queryInterface.addIndex('LedgerEntries', ['date'], { transaction: t });
      await queryInterface.addIndex('LedgerEntries', ['accountId'], { transaction: t });
      await queryInterface.addIndex('LedgerEntries', ['journalEntryId'], { transaction: t });

      // CHECK constraints (Postgres) to guard amounts
      // debit >= 0, credit >= 0
      await queryInterface.sequelize.query(
        `ALTER TABLE "LedgerEntries"
         ADD CONSTRAINT "ck_ledger_non_negative"
         CHECK ((debit >= 0) AND (credit >= 0));`,
        { transaction: t }
      );

      // either debit OR credit must be > 0 (but not both)
      await queryInterface.sequelize.query(
        `ALTER TABLE "LedgerEntries"
         ADD CONSTRAINT "ck_ledger_debit_xor_credit"
         CHECK (
           ( (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0) )
         );`,
        { transaction: t }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.dropTable('LedgerEntries', { transaction: t });
    });
  },
};
