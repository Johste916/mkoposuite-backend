// migrations/20250812083438-create-ledger-entries.js
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Helpers
    const tableExists = async (name) => {
      const [rows] = await queryInterface.sequelize.query(`
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
        LIMIT 1
      `, { bind: [name], type: Sequelize.QueryTypes.SELECT });
      return !!rows;
    };

    const ensureCheckConstraint = async () => {
      // Add the check constraint only if missing
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM   pg_constraint c
            WHERE  c.conname = 'ck_ledger_non_negative'
            AND    c.conrelid = '"LedgerEntries"'::regclass
          ) THEN
            ALTER TABLE "public"."LedgerEntries"
            ADD CONSTRAINT ck_ledger_non_negative
            CHECK (COALESCE("debit", 0) >= 0 AND COALESCE("credit", 0) >= 0);
          END IF;
        END$$;
      `);
    };

    const exists = await tableExists('LedgerEntries');

    if (!exists) {
      // Create table once. (If it already exists, we won't touch the shape.)
      await queryInterface.createTable('LedgerEntries', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },

        journalEntryId: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: 'JournalEntries', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },

        accountId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: 'Accounts', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },

        debit:  { type: Sequelize.DECIMAL(18, 2), allowNull: true, defaultValue: 0 },
        credit: { type: Sequelize.DECIMAL(18, 2), allowNull: true, defaultValue: 0 },

        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }

    // Always ensure the check constraint exists (no-op if already there)
    await ensureCheckConstraint();

    // Optional: add a helpful composite index if missing (idempotent)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_ledger_entries_journal_account'
          AND   n.nspname = 'public'
        ) THEN
          CREATE INDEX idx_ledger_entries_journal_account
          ON "public"."LedgerEntries" ("journalEntryId", "accountId");
        END IF;
      END$$;
    `);
  },

  async down(queryInterface, Sequelize) {
    // Drop check constraint iff it exists
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM   pg_constraint c
          WHERE  c.conname = 'ck_ledger_non_negative'
          AND    c.conrelid = '"LedgerEntries"'::regclass
        ) THEN
          ALTER TABLE "public"."LedgerEntries"
          DROP CONSTRAINT ck_ledger_non_negative;
        END IF;
      END$$;
    `);

    // Drop the optional index iff it exists
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_ledger_entries_journal_account'
          AND   n.nspname = 'public'
        ) THEN
          DROP INDEX "public".idx_ledger_entries_journal_account;
        END IF;
      END$$;
    `);

    // Drop table iff it exists (keeps other features safe if it’s used elsewhere)
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'LedgerEntries'
        ) THEN
          DROP TABLE "public"."LedgerEntries";
        END IF;
      END$$;
    `);
  }
};
