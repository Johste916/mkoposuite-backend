'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = { tableName: 'banks', schema: 'public' };
    const exists = await queryInterface.sequelize.query(
      `SELECT to_regclass('public.banks') as oid;`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (!exists[0].oid) {
      await queryInterface.createTable(table, {
        id:               { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        tenant_id:        { type: Sequelize.UUID, allowNull: false },
        name:             { type: Sequelize.STRING(120), allowNull: false },
        code:             { type: Sequelize.STRING(32) },
        branch:           { type: Sequelize.STRING(120) },
        account_name:     { type: Sequelize.STRING(160) },
        account_number:   { type: Sequelize.STRING(64) },
        swift:            { type: Sequelize.STRING(64) },
        phone:            { type: Sequelize.STRING(64) },
        address:          { type: Sequelize.TEXT },

        currency:         { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'TZS' },
        opening_balance:  { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        current_balance:  { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        is_active:        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },

        meta:             { type: Sequelize.JSONB },

        createdAt:        { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:        { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });

      await queryInterface.addIndex(table, ['tenant_id']);
      await queryInterface.addIndex(table, ['tenant_id','name']);
      await queryInterface.addIndex(table, ['tenant_id','account_number']);
      await queryInterface.addIndex(table, ['is_active']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'banks', schema: 'public' });
  }
};
