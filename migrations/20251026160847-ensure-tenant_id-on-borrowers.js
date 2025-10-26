'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'Borrowers';
    const desc = await queryInterface.describeTable(table);

    // Add tenant_id if missing (keep existing tenantId if it exists)
    if (!desc.tenant_id) {
      await queryInterface.addColumn(table, 'tenant_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });

      // If camelCase tenantId exists, copy values into tenant_id
      if (desc.tenantId) {
        await queryInterface.sequelize.query(`
          UPDATE "Borrowers" SET "tenant_id" = "tenantId" WHERE "tenant_id" IS NULL;
        `);
      }

      // helpful index for filters
      try {
        await queryInterface.addIndex(table, ['tenant_id'], { concurrently: true, name: 'borrowers_tenant_id_idx' });
      } catch {
        try { await queryInterface.addIndex(table, ['tenant_id'], { name: 'borrowers_tenant_id_idx' }); } catch {}
      }
    }
  },

  async down(queryInterface) {
    const table = 'Borrowers';
    try { await queryInterface.removeIndex(table, 'borrowers_tenant_id_idx'); } catch {}
    const desc = await queryInterface.describeTable(table);
    if (desc.tenant_id) {
      await queryInterface.removeColumn(table, 'tenant_id');
    }
  },
};
