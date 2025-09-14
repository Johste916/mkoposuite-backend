'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = { tableName: 'bank_transactions', schema: 'public' };
    const desc = await queryInterface.describeTable(table);

    const addIfMissing = async (name, spec) => {
      if (!desc[name]) await queryInterface.addColumn(table, name, spec);
    };

    await addIfMissing('bank_ref',      { type: Sequelize.STRING(120), allowNull: true });
    await addIfMissing('note',          { type: Sequelize.TEXT,        allowNull: true });
    await addIfMissing('reconciled',    { type: Sequelize.BOOLEAN,     allowNull: false, defaultValue: false });
    await addIfMissing('reconciled_at', { type: Sequelize.DATE,        allowNull: true });
    await addIfMissing('reconciled_by', { type: Sequelize.UUID,        allowNull: true });

    // Index on reconciled
    const idxName = 'bank_transactions_reconciled';
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${idxName}'
        ) THEN
          CREATE INDEX "${idxName}" ON public.bank_transactions (reconciled);
        END IF;
      END$$;
    `);
  },

  async down(queryInterface) {
    const table = { tableName: 'bank_transactions', schema: 'public' };
    // remove index if exists
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'bank_transactions_reconciled'
        ) THEN
          DROP INDEX "public"."bank_transactions_reconciled";
        END IF;
      END$$;
    `);

    // remove columns (guarded)
    const desc = await queryInterface.describeTable(table);
    const dropIfExists = async (name) => {
      if (desc[name]) await queryInterface.removeColumn(table, name);
    };
    await dropIfExists('reconciled_by');
    await dropIfExists('reconciled_at');
    await dropIfExists('reconciled');
    await dropIfExists('note');
    await dropIfExists('bank_ref');
  }
};
