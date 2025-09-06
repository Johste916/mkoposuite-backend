'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // create if missing
    await queryInterface.createTable('invoices', {
      id:          { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      tenant_id:   { type: Sequelize.UUID, allowNull: false },
      number:      { type: Sequelize.STRING(60), allowNull: false, unique: true },
      amount_cents:{ type: Sequelize.INTEGER, allowNull: false },
      currency:    { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'USD' },
      due_date:    { type: Sequelize.DATEONLY, allowNull: true },
      status:      { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'open' }, // open|paid|void
      meta:        { type: Sequelize.JSONB, allowNull: true },
      created_at:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('invoices', ['tenant_id', 'status'], { name: 'invoices_tenant_status_idx' });

    // ensure feature_flags composite uniqueness if not already present
    try {
      await queryInterface.addConstraint('feature_flags', {
        fields: ['tenant_id', 'key'],
        type: 'unique',
        name: 'feature_flags_tenant_key_uindex'
      });
    } catch {}
  },

  async down(queryInterface) {
    try { await queryInterface.removeIndex('invoices', 'invoices_tenant_status_idx'); } catch {}
    await queryInterface.dropTable('invoices');
  }
};
