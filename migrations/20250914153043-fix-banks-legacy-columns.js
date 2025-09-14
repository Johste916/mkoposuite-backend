'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = { tableName: 'banks', schema: 'public' };

    let desc = null;
    try { desc = await queryInterface.describeTable(table); } catch (_) { return; }

    const have = (c) => !!desc && !!desc[c];

    // ensure snake_case columns exist
    if (!have('account_name'))   await queryInterface.addColumn(table, 'account_name',   { type: Sequelize.STRING(160), allowNull: true });
    if (!have('account_number')) await queryInterface.addColumn(table, 'account_number', { type: Sequelize.STRING(64),  allowNull: true });

    // relax legacy camelCase columns if they exist and are NOT NULL
    const relax = async (col) => {
      try {
        const def = desc[col];
        if (def && def.allowNull === false) {
          await queryInterface.changeColumn(table, col, { type: def.type, allowNull: true });
        }
      } catch (_) {}
    };
    await relax('accountName');
    await relax('accountNumber');

    // make sure currency & balances exist (some DBs miss them)
    if (!have('currency'))        await queryInterface.addColumn(table, 'currency',        { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'TZS' });
    if (!have('opening_balance')) await queryInterface.addColumn(table, 'opening_balance', { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 });
    if (!have('current_balance')) await queryInterface.addColumn(table, 'current_balance', { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 });
    if (!have('is_active'))       await queryInterface.addColumn(table, 'is_active',       { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });

    // indexes
    const addIdx = async (cols, name) => { try { await queryInterface.addIndex(table, cols, { name }); } catch (_) {} };
    await addIdx(['tenant_id', 'name'], 'banks_tenant_id_name');
    await addIdx(['tenant_id', 'account_number'], 'banks_tenant_id_account_number');
  },

  async down(queryInterface) {
    const table = { tableName: 'banks', schema: 'public' };
    const drop = async (name) => { try { await queryInterface.removeIndex(table, name); } catch (_) {} };
    await drop('banks_tenant_id_name');
    await drop('banks_tenant_id_account_number');
    // keep columns; no destructive down.
  }
};
