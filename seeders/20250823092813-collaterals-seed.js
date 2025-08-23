'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    await queryInterface.bulkInsert('collaterals', [
      {
        id: Sequelize.literal('gen_random_uuid()'),
        itemName: 'HP Laptop 840 G5',
        category: 'Electronics',
        model: '840 G5',
        serialNumber: 'SN-HP-001',
        estValue: 1200000,
        status: 'ACTIVE',
        location: 'Head Office',
        notes: 'Assigned to borrower asset record',
        borrowerId: null,
        loanId: null,
        createdAt: now, updatedAt: now,
      },
      {
        id: Sequelize.literal('gen_random_uuid()'),
        itemName: 'Motorcycle Boxer',
        category: 'Vehicle',
        model: 'Bajaj 125',
        serialNumber: 'MC-BAJAJ-002',
        estValue: 3200000,
        status: 'ACTIVE',
        location: 'Branch A',
        notes: '',
        borrowerId: null,
        loanId: null,
        createdAt: now, updatedAt: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('collaterals', null, {});
  }
};
