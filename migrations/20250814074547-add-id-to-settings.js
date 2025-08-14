'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;
    const dialect = sequelize.getDialect();
    const table = 'settings';

    // Describe table (returns object, not array). If it fails, table doesn't exist yet.
    let desc = null;
    try {
      desc = await qi.describeTable(table);
    } catch (e) {
      // Table doesn't exist; nothing to alter.
      // You likely create it in another migration or via sequelize.sync().
      console.log(`[add-id-to-settings] Table "${table}" not found, skipping addColumn.`);
      return;
    }

    // If id already exists, nothing to do
    if (desc && desc.id) {
      console.log('[add-id-to-settings] "id" column already exists, skipping.');
      return;
    }

    // Ensure UUID generator exists on Postgres
    if (dialect === 'postgres') {
      await sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";'); // gen_random_uuid()
    }

    // 1) Add the column (nullable first so we can backfill)
    await qi.addColumn(table, 'id', {
      type: Sequelize.UUID,
      allowNull: true,
      defaultValue: null, // set later to avoid accidental defaults during backfill
    });

    // 2) Backfill existing rows
    if (dialect === 'postgres') {
      await sequelize.query(`UPDATE "${table}" SET "id" = gen_random_uuid() WHERE "id" IS NULL;`);
    } else {
      // Fallback: backfill via UUIDV4 for non-pg dialects
      const [rows] = await sequelize.query(`SELECT * FROM ${table} WHERE id IS NULL;`);
      for (const _ of rows || []) {
        await sequelize.query(
          `UPDATE ${table} SET id='${Sequelize.Utils.toDefaultValue(Sequelize.UUIDV4)}' WHERE id IS NULL;`
        );
      }
    }

    // 3) Set NOT NULL
    await qi.changeColumn(table, 'id', {
      type: Sequelize.UUID,
      allowNull: false,
    });

    // 4) Add PK if not present
    // Postgres: need explicit ALTER TABLE ... ADD PRIMARY KEY
    if (dialect === 'postgres') {
      // Check if a PK exists already (simple approach: try/catch)
      try {
        await sequelize.query(`ALTER TABLE "${table}" ADD PRIMARY KEY ("id");`);
      } catch (e) {
        // If it fails because a PK already exists, ignore
        console.log('[add-id-to-settings] PK add skipped:', e.message);
      }
    } else {
      try {
        await qi.addConstraint(table, {
          fields: ['id'],
          type: 'primary key',
          name: 'settings_pkey',
        });
      } catch (e) {
        console.log('[add-id-to-settings] PK constraint skipped:', e.message);
      }
    }

    // 5) Optional: set a default for future inserts
    if (dialect === 'postgres') {
      await sequelize.query(`ALTER TABLE "${table}" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();`);
    } else {
      // Many dialects don’t support UUIDV4 default at the SQL level; Sequelize will handle on insert.
    }

    console.log('[add-id-to-settings] id column created and set as primary key.');
  },

  async down(queryInterface, Sequelize) {
    const qi = queryInterface;
    const table = 'settings';

    let desc = null;
    try {
      desc = await qi.describeTable(table);
    } catch (e) {
      console.log(`[add-id-to-settings:down] Table "${table}" not found, nothing to revert.`);
      return;
    }

    if (desc && desc.id) {
      // Drop PK first if necessary (best-effort)
      try {
        await qi.removeConstraint(table, 'settings_pkey');
      } catch {}
      try {
        await qi.removeColumn(table, 'id');
      } catch (e) {
        console.log('[add-id-to-settings:down] removeColumn skipped:', e.message);
      }
    }
  },
};
