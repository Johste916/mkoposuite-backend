'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const JSON_TYPE = dialect === 'postgres' ? Sequelize.JSONB : Sequelize.JSON;

    // Helper: check if a table exists
    const tableExists = async (name) => {
      const [rows] = await queryInterface.sequelize.query(
        `
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
        LIMIT 1
        `,
        { bind: [name] }
      );
      return Array.isArray(rows) && rows.length > 0;
    };

    const exists = await tableExists('settings');

    if (!exists) {
      // Create the table (unique on `key` handled here; no explicit addIndex)
      await queryInterface.createTable('settings', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal(
            dialect === 'postgres' ? 'gen_random_uuid()' : 'uuid()'
          ),
          allowNull: false,
          primaryKey: true,
        },
        key: {
          type: Sequelize.STRING(200),
          allowNull: false,
          unique: true, // <-- this will create a unique constraint/index
        },
        value: {
          type: JSON_TYPE,
          allowNull: false,
          defaultValue:
            dialect === 'postgres'
              ? Sequelize.literal(`'{}'::jsonb`)
              : {},
        },
        description: {
          type: Sequelize.STRING(500),
          allowNull: false,
          defaultValue: '',
        },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue:
            dialect === 'postgres'
              ? Sequelize.literal('NOW()')
              : Sequelize.fn('NOW'),
        },
        updatedAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue:
            dialect === 'postgres'
              ? Sequelize.literal('NOW()')
              : Sequelize.fn('NOW'),
        },
      });
    }

    // Add the GIN index on value (Postgres only), idempotently
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        CREATE INDEX IF NOT EXISTS settings_value_gin_idx
        ON "public"."settings"
        USING GIN ("value");
      `);
    }

    // IMPORTANT: do NOT call addIndex('settings', ['key'], { unique: true })
    // because the unique index/constraint already exists from the column definition
  },

  async down(queryInterface /*, Sequelize */) {
    // Dropping the table will also drop indexes/constraints
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'settings'
        ) THEN
          DROP TABLE "public"."settings" CASCADE;
        END IF;
      END$$;
    `);
  },
};
