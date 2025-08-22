'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { randomUUID } = require('crypto');
    const now = new Date();

    await queryInterface.bulkInsert('collection_sheets', [
      {
        id: randomUUID(),
        date: '2025-08-20',
        type: 'FIELD',
        collector: 'John Doe',
        loanOfficer: 'Mary Kimaro',
        status: 'PENDING',
        branchId: null,
        collectorId: null,
        loanOfficerId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: randomUUID(),
        date: '2025-08-21',
        type: 'OFFICE',
        collector: 'Asha Mkali',
        loanOfficer: 'Peter Musa',
        status: 'COMPLETED',
        branchId: null,
        collectorId: null,
        loanOfficerId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: randomUUID(),
        date: '2025-08-22',
        type: 'AGENCY',
        collector: 'Samuel N.',
        loanOfficer: 'Neema J.',
        status: 'IN_PROGRESS',
        branchId: null,
        collectorId: null,
        loanOfficerId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('collection_sheets', null, {});
  },
};
