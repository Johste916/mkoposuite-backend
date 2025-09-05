'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'payments', schema: 'public' },
      {
        id:         { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
        tenant_id:  {
          type: Sequelize.UUID, allowNull: false,
          references: { model: { tableName: 'tenants', schema: 'public' }, key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        invoice_id: {
          type: Sequelize.UUID, allowNull: true,
          references: { model: { tableName: 'invoices', schema: 'public' }, key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'SET NULL',
        },

        amount_cents: { type: Sequelize.INTEGER, allowNull: false },
        currency:     { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
        method:       { type: Sequelize.STRING(32) },   // mpesa, card, bank, ...
        reference:    { type: Sequelize.STRING(128) },
        received_at:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
        notes:        { type: Sequelize.TEXT },
        metadata:     { type: Sequelize.JSONB },

        created_at:   { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
        updated_at:   { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      }
    );

    await queryInterface.addIndex({ tableName: 'payments', schema: 'public' }, ['tenant_id']);
    await queryInterface.addIndex({ tableName: 'payments', schema: 'public' }, ['invoice_id']);
    await queryInterface.addIndex({ tableName: 'payments', schema: 'public' }, ['reference']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'payments', schema: 'public' });
  },
};
