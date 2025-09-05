'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'tenant_limits', schema: 'public' },
      {
        tenant_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: { tableName: 'tenants', schema: 'public' }, key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        key:   { type: Sequelize.STRING(64), allowNull: false },   // seats, borrowers, storage_mb
        value: { type: Sequelize.INTEGER,    allowNull: false },

        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      },
      { uniqueKeys: { uniq_tenant_key: { fields: ['tenant_id', 'key'] } } }
    );
    await queryInterface.addIndex({ tableName: 'tenant_limits', schema: 'public' }, ['tenant_id']);
    await queryInterface.addIndex({ tableName: 'tenant_limits', schema: 'public' }, ['key']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'tenant_limits', schema: 'public' });
  },
};
