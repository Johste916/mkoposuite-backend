'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tryDescribe = async (table) => {
      try { return await queryInterface.describeTable(table); }
      catch (e) { return null; }
    };

    // Try common table names (snake_case and PascalCase)
    const candidates = ['loan_payments', 'LoanPayments'];

    await queryInterface.sequelize.transaction(async (t) => {
      for (const table of candidates) {
        const desc = await tryDescribe(table);
        if (!desc) continue; // table name not found in this env

        // Add only if missing
        if (!desc.applied) {
          await queryInterface.addColumn(
            table,
            'applied',
            { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            { transaction: t }
          );
        } else {
          // Ensure NOT NULL + default (optional hardening; ignore if it fails)
          try {
            await queryInterface.changeColumn(
              table,
              'applied',
              { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
              { transaction: t }
            );
          } catch {}
        }
        // If we successfully handled one matching table name, stop.
        break;
      }
    });
  },

  async down(queryInterface) {
    const tryDescribe = async (table) => {
      try { return await queryInterface.describeTable(table); }
      catch (e) { return null; }
    };

    const candidates = ['loan_payments', 'LoanPayments'];

    await queryInterface.sequelize.transaction(async (t) => {
      for (const table of candidates) {
        const desc = await tryDescribe(table);
        if (!desc) continue;
        if (desc.applied) {
          await queryInterface.removeColumn(table, 'applied', { transaction: t });
          break;
        }
      }
    });
  },
};
