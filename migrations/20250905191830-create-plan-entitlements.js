'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('plan_entitlements', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()')
      },
      plan_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'plans', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      entitlement_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'entitlements', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.addConstraint('plan_entitlements', {
      fields: ['plan_id', 'entitlement_id'],
      type: 'unique',
      name: 'plan_entitlements_unique_pair'
    });
    await queryInterface.addIndex('plan_entitlements', ['plan_id'], { name: 'plan_entitlements_plan_id_idx' });
    await queryInterface.addIndex('plan_entitlements', ['entitlement_id'], { name: 'plan_entitlements_entitlement_id_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('plan_entitlements');
  }
};
