'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // If someone has an old singular table, rename it so we standardize on "tenants".
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'tenant'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'tenants'
        ) THEN
          EXECUTE 'ALTER TABLE public.tenant RENAME TO tenants';
        END IF;
      END$$;
    `);

    // Create "tenants" if it still doesn't exist
    await queryInterface.createTable(
      { tableName: 'tenants', schema: 'public' },
      {
        id: {
          type: Sequelize.UUID,
          allowNull: false,
          primaryKey: true,
          defaultValue: Sequelize.UUIDV4, // no pgcrypto required
        },
        name:                   { type: Sequelize.STRING(255), allowNull: false, defaultValue: 'Organization' },
        status:                 { type: Sequelize.STRING(32),  allowNull: false, defaultValue: 'trial' },  // trial|active|suspended|deleted
        plan_code:              { type: Sequelize.STRING(32),  allowNull: false, defaultValue: 'basic' },
        trial_ends_at:          { type: Sequelize.DATEONLY,    allowNull: true  },
        auto_disable_overdue:   { type: Sequelize.BOOLEAN,     allowNull: false, defaultValue: false },
        grace_days:             { type: Sequelize.INTEGER,     allowNull: false, defaultValue: 7 },
        billing_email:          { type: Sequelize.STRING(255), allowNull: true  },

        created_at:             { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
        updated_at:             { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      }
    );

    await queryInterface.addIndex({ tableName: 'tenants', schema: 'public' }, ['status']);
    await queryInterface.addIndex({ tableName: 'tenants', schema: 'public' }, ['plan_code']);
  },

  async down(queryInterface) {
    // Drop only if "tenants" exists (ignore legacy table name)
    await queryInterface.dropTable({ tableName: 'tenants', schema: 'public' });
  },
};
