'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const isPg = dialect === 'postgres';
    const JSON_TYPE = isPg ? Sequelize.JSONB : Sequelize.JSON;

    // helper: add a column if it doesn't exist
    const safeAddColumn = async (table, col, def) => {
      const desc = await queryInterface.describeTable(table).catch(() => ({}));
      if (!desc[col]) {
        await queryInterface.addColumn(table, col, def);
        console.log(`✅ added ${table}.${col}`);
      } else {
        console.log(`⏭️  skip ${table}.${col} (already exists)`);
      }
    };

    // helper: add an index if it doesn't exist (Postgres/SQL-compliant raw)
    const safeAddIndex = async (table, cols, options = {}) => {
      const name =
        options.name ||
        `${table}_${Array.isArray(cols) ? cols.join('_') : String(cols)}_idx`;

      if (isPg) {
        await queryInterface.sequelize.query(
          `CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" (${[]
            .concat(cols)
            .map((c) => `"${c}"`)
            .join(', ')})`
        );
      } else {
        // Fallback: try addIndex and ignore duplicate errors
        try {
          await queryInterface.addIndex(table, cols, { ...options, name });
        } catch (e) {
          console.warn(`⚠️  index ${name} skipped: ${e.message}`);
        }
      }
    };

    // 1) status (ENUM in PG)
    //    If the column already exists, this no-ops.
    await safeAddColumn('loan_payments', 'status', {
      type: isPg
        ? Sequelize.ENUM('pending', 'approved', 'rejected', 'voided')
        : Sequelize.STRING, // safe cross-dialect fall-back; existing PG keeps ENUM
      allowNull: false,
      defaultValue: 'approved',
    });

    // 2) applied
    await safeAddColumn('loan_payments', 'applied', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    // 3) reference
    await safeAddColumn('loan_payments', 'reference', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // 4) receiptNo
    await safeAddColumn('loan_payments', 'receiptNo', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // 5) currency
    await safeAddColumn('loan_payments', 'currency', {
      type: Sequelize.STRING(8),
      allowNull: true,
    });

    // 6) gateway
    await safeAddColumn('loan_payments', 'gateway', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // 7) gatewayRef
    await safeAddColumn('loan_payments', 'gatewayRef', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // 8) allocation
    await safeAddColumn('loan_payments', 'allocation', {
      type: JSON_TYPE,
      allowNull: true,
      defaultValue: isPg ? Sequelize.literal(`'{}'::jsonb`) : {},
    });

    // 9) voidReason
    await safeAddColumn('loan_payments', 'voidReason', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    // indexes (idempotent)
    await safeAddIndex('loan_payments', ['status'], { name: 'loan_payments_status_idx' });
    await safeAddIndex('loan_payments', ['reference'], { name: 'loan_payments_reference_idx' });
    await safeAddIndex('loan_payments', ['gatewayRef'], { name: 'loan_payments_gatewayRef_idx' });
  },

  async down(queryInterface, Sequelize) {
    const dropColIfExists = async (table, col) => {
      const desc = await queryInterface.describeTable(table).catch(() => ({}));
      if (desc[col]) {
        await queryInterface.removeColumn(table, col);
        console.log(`🗑️  removed ${table}.${col}`);
      } else {
        console.log(`⏭️  skip remove ${table}.${col} (not present)`);
      }
    };

    const dropIndexIfExists = async (name) => {
      // Postgres: drop index if exists by name
      await queryInterface.sequelize
        .query(`DROP INDEX IF EXISTS "${name}"`)
        .catch(() => {});
    };

    await dropIndexIfExists('loan_payments_gatewayRef_idx');
    await dropIndexIfExists('loan_payments_reference_idx');
    await dropIndexIfExists('loan_payments_status_idx');

    await dropColIfExists('loan_payments', 'voidReason');
    await dropColIfExists('loan_payments', 'allocation');
    await dropColIfExists('loan_payments', 'gatewayRef');
    await dropColIfExists('loan_payments', 'gateway');
    await dropColIfExists('loan_payments', 'currency');
    await dropColIfExists('loan_payments', 'receiptNo');
    await dropColIfExists('loan_payments', 'reference');
    await dropColIfExists('loan_payments', 'applied');

    // for status: if we remove it on Postgres, also drop the enum type (if unused)
    const desc = await queryInterface.describeTable('loan_payments').catch(() => ({}));
    if (desc.status) {
      await queryInterface.removeColumn('loan_payments', 'status');
      if (queryInterface.sequelize.getDialect() === 'postgres') {
        await queryInterface.sequelize
          .query(`DROP TYPE IF EXISTS "enum_loan_payments_status";`)
          .catch(() => {});
      }
    }
  },
};
