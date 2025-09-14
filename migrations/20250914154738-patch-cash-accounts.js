'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = { tableName: 'cash_accounts', schema: 'public' };

    // Does table exist?
    let desc = null;
    try {
      desc = await queryInterface.describeTable(table);
    } catch (_) {
      desc = null;
    }

    if (!desc) {
      // Table does not exist → create from scratch
      await queryInterface.createTable(table, {
        id:              { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        tenant_id:       { type: Sequelize.UUID, allowNull: false },
        name:            { type: Sequelize.STRING(160), allowNull: false },
        branch_id:       { type: Sequelize.UUID, allowNull: true },
        opening_balance: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        current_balance: { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        currency:        { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'TZS' },
        is_active:       { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        meta:            { type: Sequelize.JSONB, allowNull: true },
        createdAt:       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    } else {
      // Table exists → ensure required columns are present
      const ensure = async (col, spec) => {
        if (!desc[col]) {
          await queryInterface.addColumn(table, col, spec);
        }
      };

      await ensure('tenant_id',       { type: Sequelize.UUID, allowNull: false, defaultValue: '00000000-0000-0000-0000-000000000000' });
      await ensure('name',            { type: Sequelize.STRING(160), allowNull: false, defaultValue: 'Main Cash' });
      await ensure('branch_id',       { type: Sequelize.UUID, allowNull: true });
      await ensure('opening_balance', { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 });
      await ensure('current_balance', { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 });
      await ensure('currency',        { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'TZS' });
      await ensure('is_active',       { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
      await ensure('meta',            { type: Sequelize.JSONB, allowNull: true });
      // timestamps
      await ensure('createdAt',       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });
      await ensure('updatedAt',       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });

      // If "name" is nullable in old table, tighten it
      try { await queryInterface.changeColumn(table, 'name', { type: Sequelize.STRING(160), allowNull: false }); } catch (_) {}
    }

    // Indices (idempotent)
    const tryIdx = async (cols, name) => {
      try {
        await queryInterface.addIndex(table, cols, { name });
      } catch (_) { /* ignore if it already exists */ }
    };
    await tryIdx(['tenant_id'], 'cash_accounts_tenant_id');
    await tryIdx(['tenant_id','name'], 'cash_accounts_tenant_id_name');
    await tryIdx(['is_active'], 'cash_accounts_is_active');
  },

  async down(queryInterface) {
    // Safe down: only drop indexes we know the name of; keep table.
    const table = { tableName: 'cash_accounts', schema: 'public' };
    const drop = async (name) => { try { await queryInterface.removeIndex(table, name); } catch (_) {} };
    await drop('cash_accounts_tenant_id');
    await drop('cash_accounts_tenant_id_name');
    await drop('cash_accounts_is_active');
  }
};
