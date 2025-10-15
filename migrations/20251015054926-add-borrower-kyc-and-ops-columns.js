'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = 'Borrowers';
    const existing = await queryInterface.describeTable(table);

    const addIfMissing = async (name, def) => {
      if (!existing[name]) {
        await queryInterface.addColumn(table, name, def);
      }
    };

    await addIfMissing('email',        { type: Sequelize.STRING, allowNull: true });
    await addIfMissing('loanOfficerId',{ type: Sequelize.INTEGER, allowNull: true });
    await addIfMissing('gender',       { type: Sequelize.STRING(16), allowNull: true });
    await addIfMissing('birthDate',    { type: Sequelize.DATEONLY, allowNull: true });
    await addIfMissing('employmentStatus', { type: Sequelize.STRING(32), allowNull: true });
    await addIfMissing('occupation',   { type: Sequelize.STRING, allowNull: true });
    await addIfMissing('idType',       { type: Sequelize.STRING(32), allowNull: true });
    await addIfMissing('idIssuedDate', { type: Sequelize.DATEONLY, allowNull: true });
    await addIfMissing('idExpiryDate', { type: Sequelize.DATEONLY, allowNull: true });
    await addIfMissing('nextKinName',  { type: Sequelize.STRING, allowNull: true });
    await addIfMissing('nextKinPhone', { type: Sequelize.STRING, allowNull: true });
    await addIfMissing('nextOfKinRelationship', { type: Sequelize.STRING, allowNull: true });
    await addIfMissing('groupId',      { type: Sequelize.INTEGER, allowNull: true });
    await addIfMissing('loanType',     { type: Sequelize.STRING(32), allowNull: true });
    await addIfMissing('regDate',      { type: Sequelize.DATEONLY, allowNull: true });
    await addIfMissing('maritalStatus',{ type: Sequelize.STRING(32), allowNull: true });
    await addIfMissing('educationLevel',{ type: Sequelize.STRING(64), allowNull: true });
    await addIfMissing('customerNumber',{ type: Sequelize.STRING(64), allowNull: true });
    await addIfMissing('tin',          { type: Sequelize.STRING(32), allowNull: true });
    await addIfMissing('nationality',  { type: Sequelize.STRING(64), allowNull: true });
    await addIfMissing('photoUrl',     { type: Sequelize.STRING, allowNull: true });

    // NOTE: branchId already exists as column `branch_id` in your schema.
  },

  down: async (queryInterface/*, Sequelize*/) => {
    const table = 'Borrowers';
    const existing = await queryInterface.describeTable(table);

    const dropIfExists = async (name) => {
      if (existing[name]) {
        await queryInterface.removeColumn(table, name);
      }
    };

    await dropIfExists('email');
    await dropIfExists('loanOfficerId');
    await dropIfExists('gender');
    await dropIfExists('birthDate');
    await dropIfExists('employmentStatus');
    await dropIfExists('occupation');
    await dropIfExists('idType');
    await dropIfExists('idIssuedDate');
    await dropIfExists('idExpiryDate');
    await dropIfExists('nextKinName');
    await dropIfExists('nextKinPhone');
    await dropIfExists('nextOfKinRelationship');
    await dropIfExists('groupId');
    await dropIfExists('loanType');
    await dropIfExists('regDate');
    await dropIfExists('maritalStatus');
    await dropIfExists('educationLevel');
    await dropIfExists('customerNumber');
    await dropIfExists('tin');
    await dropIfExists('nationality');
    await dropIfExists('photoUrl');
  }
};
