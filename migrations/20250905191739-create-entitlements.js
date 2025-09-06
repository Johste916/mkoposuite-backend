'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;
    const [rows] = await q.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name=$1
       ) AS present;`,
      { bind: ['entitlements'] }
    );
    if (rows?.[0]?.present) return;

    await queryInterface.createTable('entitlements', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      key: {
        type: Sequelize.STRING(120),
        allowNull: false,
        unique: true,
      },
      label: {
        type: Sequelize.STRING(160),
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex('entitlements', ['key'], {
      unique: true,
      name: 'entitlements_key_uindex',
    });
  },

  async down(queryInterface) {
    try { await queryInterface.dropTable('entitlements'); } catch {}
  },
};
