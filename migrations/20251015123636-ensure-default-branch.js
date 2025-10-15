'use strict';

module.exports = {
  async up(queryInterface /*, Sequelize */) {
    // Insert a default Branch with id=1 only if there is no row with id=1
    await queryInterface.sequelize.query(`
      INSERT INTO "Branches" ("id","name","createdAt","updatedAt")
      SELECT 1, 'Head Office', NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM "Branches" WHERE "id" = 1);
    `);
  },

  async down(queryInterface /*, Sequelize */) {
    // No-op by default (safe). If you insist:
    await queryInterface.sequelize.query(`
      DELETE FROM "Branches"
      WHERE "id" = 1
        AND NOT EXISTS (SELECT 1 FROM "Borrowers" WHERE "branchId" = 1);
    `);
  }
};
