'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'Borrowers';
    const t = await queryInterface.sequelize.transaction();
    try {
      const desc = await queryInterface.describeTable(table);
      const addIfMissing = async (name, spec) => {
        if (!desc[name]) await queryInterface.addColumn(table, name, spec, { transaction: t });
      };

      await addIfMissing('maritalStatus',     { type: Sequelize.STRING(50),  allowNull: true });
      await addIfMissing('educationLevel',    { type: Sequelize.STRING(100), allowNull: true });
      await addIfMissing('customerNumber',    { type: Sequelize.STRING(100), allowNull: true });
      await addIfMissing('tin',               { type: Sequelize.STRING(100), allowNull: true });
      await addIfMissing('nationality',       { type: Sequelize.STRING(100), allowNull: true });
      await addIfMissing('loanType',          { type: Sequelize.STRING(32),  allowNull: true, defaultValue: 'individual' });
      await addIfMissing('regDate',           { type: Sequelize.DATEONLY,    allowNull: true });
      await addIfMissing('groupId',           { type: Sequelize.STRING(100), allowNull: true });

      // Next of kin
      await addIfMissing('nextKinName',           { type: Sequelize.STRING(255), allowNull: true });
      await addIfMissing('nextKinPhone',          { type: Sequelize.STRING(60),  allowNull: true });
      await addIfMissing('nextOfKinRelationship', { type: Sequelize.STRING(120), allowNull: true });

      // ID details (if your model uses them)
      await addIfMissing('idType',        { type: Sequelize.STRING(50),  allowNull: true });
      await addIfMissing('idIssuedDate',  { type: Sequelize.DATEONLY,    allowNull: true });
      await addIfMissing('idExpiryDate',  { type: Sequelize.DATEONLY,    allowNull: true });

      // light indexes
      try { await queryInterface.addIndex(table, ['customerNumber'], { name: 'idx_borrowers_customer_number', transaction: t }); } catch {}
      try { await queryInterface.addIndex(table, ['nationalId'],     { name: 'idx_borrowers_national_id',     transaction: t }); } catch {}

      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
  },

  async down(queryInterface /*, Sequelize */) {
    const table = 'Borrowers';
    const t = await queryInterface.sequelize.transaction();
    try {
      const desc = await queryInterface.describeTable(table);
      const dropIfExists = async (name) => {
        if (desc[name]) await queryInterface.removeColumn(table, name, { transaction: t });
      };

      // reverse in rough order
      await dropIfExists('idExpiryDate');
      await dropIfExists('idIssuedDate');
      await dropIfExists('idType');
      await dropIfExists('nextOfKinRelationship');
      await dropIfExists('nextKinPhone');
      await dropIfExists('nextKinName');
      await dropIfExists('groupId');
      await dropIfExists('regDate');
      await dropIfExists('loanType');
      await dropIfExists('nationality');
      await dropIfExists('tin');
      await dropIfExists('customerNumber');
      await dropIfExists('educationLevel');
      await dropIfExists('maritalStatus');

      try { await queryInterface.removeIndex(table, 'idx_borrowers_customer_number', { transaction: t }); } catch {}
      try { await queryInterface.removeIndex(table, 'idx_borrowers_national_id',     { transaction: t }); } catch {}

      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }
};
