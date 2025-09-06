'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;

    // create only if missing
    const [rows] = await q.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name=$1
       ) AS present;`,
      { bind: ['plan_entitlements'] }
    );
    if (rows?.[0]?.present) return;

    await queryInterface.createTable('plan_entitlements', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      plan_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'plans', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      entitlement_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'entitlements', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addConstraint('plan_entitlements', {
      fields: ['plan_id', 'entitlement_id'],
      type: 'unique',
      name: 'plan_entitlements_plan_id_entitlement_id_uq',
    });
    await queryInterface.addIndex('plan_entitlements', ['plan_id']);
    await queryInterface.addIndex('plan_entitlements', ['entitlement_id']);
  },

  async down(queryInterface) {
    try { await queryInterface.dropTable('plan_entitlements'); } catch {}
  },
};
