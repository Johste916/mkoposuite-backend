'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const T = { schema: 'public', tableName: 'bank_transactions' };

    // Helper: add a column only if it's missing
    const safeAddColumn = async (tbl, col, def) => {
      try {
        const desc = await queryInterface.describeTable(tbl);
        // describeTable returns plain column names (no schema)
        if (!Object.prototype.hasOwnProperty.call(desc, col)) {
          await queryInterface.addColumn(tbl, col, def);
          console.log(`✅ Added column ${col} on ${tbl.schema}.${tbl.tableName}`);
        } else {
          console.log(`⏭️  Skipped ${col} (already exists on ${tbl.schema}.${tbl.tableName})`);
        }
      } catch (err) {
        // If table doesn’t exist yet in some env, surface the error
        console.warn(`⚠️  Could not add ${col} on ${tbl.schema}.${tbl.tableName}: ${err.message}`);
        throw err;
      }
    };

    // Helper: create index only if missing
    const safeAddIndex = async (tbl, fields, opts) => {
      const name = opts?.name;
      const existing = await queryInterface.showIndex(tbl).catch(() => []);
      if (name && existing.some((i) => i.name === name)) {
        console.log(`⏭️  Skipped index ${name} (already exists)`);
        return;
      }
      await queryInterface.addIndex(tbl, fields, opts);
      console.log(`✅ Added index ${name || fields.join('_')} on ${tbl.schema}.${tbl.tableName}`);
    };

    // Add the new columns only if absent
    await safeAddColumn(T, 'bankRef', {
      type: Sequelize.STRING(120),
      allowNull: true,
    });

    await safeAddColumn(T, 'note', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await safeAddColumn(T, 'reconciled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await safeAddColumn(T, 'reconciledAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await safeAddColumn(T, 'reconciledBy', {
      type: Sequelize.UUID,
      allowNull: true,
    });

    // Add index on reconciled (named for idempotency)
    await safeAddIndex(T, ['reconciled'], { name: 'bank_transactions_reconciled_idx' });
  },

  async down(queryInterface) {
    const T = { schema: 'public', tableName: 'bank_transactions' };

    // Best-effort removals — safe for environments where some columns didn’t exist
    const safeRemoveIndex = async (tbl, nameOrFields) => {
      try {
        const name = typeof nameOrFields === 'string' ? nameOrFields : undefined;
        if (name) {
          await queryInterface.removeIndex(tbl, name);
        } else {
          await queryInterface.removeIndex(tbl, nameOrFields);
        }
      } catch (_) {}
    };

    const safeRemoveColumn = async (tbl, col) => {
      try {
        await queryInterface.removeColumn(tbl, col);
      } catch (_) {}
    };

    await safeRemoveIndex(T, 'bank_transactions_reconciled_idx');
    await safeRemoveColumn(T, 'reconciledBy');
    await safeRemoveColumn(T, 'reconciledAt');
    await safeRemoveColumn(T, 'reconciled');
    await safeRemoveColumn(T, 'note');
    await safeRemoveColumn(T, 'bankRef');
  },
};
