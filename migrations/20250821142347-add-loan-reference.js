'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // add 'reference' column and unique index
    await queryInterface.addColumn('loans', 'reference', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: false, // add index separately for cross-db safety
    });
    await queryInterface.addIndex('loans', {
      fields: ['reference'],
      unique: true,
      name: 'loans_reference_unique_idx',
      where: { reference: { [Sequelize.Op.ne]: null } }, // optional: partial unique in PG
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('loans', 'loans_reference_unique_idx').catch(() => {});
    await queryInterface.removeColumn('loans', 'reference');
  },
};
