'use strict';

const { randomUUID } = require('crypto');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // Inspect the table so we only insert columns that actually exist
    const columns = await queryInterface.describeTable('collection_sheets');
    const has = (name) => Object.prototype.hasOwnProperty.call(columns, name);

    const base = (row) => {
      const r = {
        id: randomUUID(),                 // table has no DB default, so we set UUID here
        date: row.date,
        type: row.type,
        collector: row.collector || null,
        loanOfficer: row.loanOfficer || null,
        status: row.status || 'pending',
        createdAt: now,
        updatedAt: now,
      };
      if (has('branchId')) r.branchId = null;
      if (has('collectorId')) r.collectorId = null;
      if (has('loanOfficerId')) r.loanOfficerId = null;
      if (has('createdBy')) r.createdBy = null;   // only if column exists
      if (has('updatedBy')) r.updatedBy = null;   // only if column exists
      return r;
    };

    await queryInterface.bulkInsert('collection_sheets', [
      base({ date: '2025-08-20', type: 'FIELD',  collector: 'John Doe',   loanOfficer: 'Mary Kimaro', status: 'pending' }),
      base({ date: '2025-08-21', type: 'OFFICE', collector: 'Asha Mkali', loanOfficer: 'Peter Musa',  status: 'completed' }),
      base({ date: '2025-08-22', type: 'AGENCY', collector: 'Samuel N.',  loanOfficer: 'Neema J.',    status: 'pending' }),
    ], {});
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('collection_sheets', null, {});
  },
};
