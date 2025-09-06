'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;

    const tableExists = async (t) => {
      const [rows] = await q.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema='public' AND table_name=$1
         ) AS present;`,
        { bind: [t] }
      );
      return !!rows?.[0]?.present;
    };

    if (!(await tableExists('tenants'))) return;

    const [cols] = await q.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='tenants';
    `);
    const have = new Set(cols.map((c) => c.column_name));

    // ensure plans table exists before adding FK
    const hasPlans = await tableExists('plans');

    if (!have.has('plan_id') && hasPlans) {
      await queryInterface.addColumn('tenants', 'plan_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'plans', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      });
    }

    if (!have.has('plan_code')) {
      await queryInterface.addColumn('tenants', 'plan_code', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
      await queryInterface.addIndex('tenants', ['plan_code'], { name: 'tenants_plan_code_idx' });
    }
  },

  async down(queryInterface) {
    try { await queryInterface.removeIndex('tenants', 'tenants_plan_code_idx'); } catch {}
    try { await queryInterface.removeColumn('tenants', 'plan_code'); } catch {}
    try { await queryInterface.removeColumn('tenants', 'plan_id'); } catch {}
  },
};
