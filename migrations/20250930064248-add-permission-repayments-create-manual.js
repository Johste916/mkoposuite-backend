'use strict';

const { randomUUID } = require('crypto');

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    // 1) Work out table + id type
    const tableName = 'Permissions'; // your error shows capitalized "Permissions"
    const desc = await qi.describeTable(tableName);
    if (!desc || !desc.id) {
      throw new Error(`Table "${tableName}" must have an 'id' column`);
    }

    const idType = String(desc.id.type || '').toUpperCase();

    // 2) Generate an id compatible with the column type
    let newId = null;
    if (idType.includes('UUID')) {
      // UUID primary key
      newId = randomUUID(); // avoids needing pg extensions
    } else if (idType.includes('INT')) {
      // Integer primary key without default: emulate a sequence by max+1
      const [results] = await qi.sequelize.query(
        `SELECT COALESCE(MAX("id"), 0) + 1 AS next_id FROM "${tableName}";`
      );
      newId = results?.[0]?.next_id || 1;
    } else {
      // Fallback: try to insert without id (will fail if NOT NULL), so bail early
      throw new Error(
        `Unsupported id type for "${tableName}". Found: ${desc.id.type}. Add a default or use UUID/INTEGER.`
      );
    }

    // 3) Insert the permission row with explicit id
    const now = new Date();
    await qi.bulkInsert(
      tableName,
      [
        {
          id: newId,
          action: 'repayments:create:manual',
          // include all roles allowed to post manual repayments today
          roles: JSON.stringify([
            'admin',
            'loanofficer',
            'loan_officer',
            'loan-officer',
            'cashier',
            'cash_officer',
            'cash-officer',
          ]),
          createdAt: now,
          updatedAt: now,
          // if you have multi-tenant columns, add them here (e.g., tenantId)
        },
      ],
      {}
    );
  },

  async down(queryInterface, Sequelize) {
    const tableName = 'Permissions';
    await queryInterface.bulkDelete(tableName, { action: 'repayments:create:manual' }, {});
  },
};
