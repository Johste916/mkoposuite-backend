'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      // Chart of accounts (minimal)
      const [cash]  = await queryInterface.sequelize.query(
        `INSERT INTO "Accounts" ("code","name","type","createdAt","updatedAt")
         VALUES ('1000','Cash','cash',NOW(),NOW())
         ON CONFLICT ("code") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"
         RETURNING id;`, { transaction: t }
      );
      const [sales] = await queryInterface.sequelize.query(
        `INSERT INTO "Accounts" ("code","name","type","createdAt","updatedAt")
         VALUES ('4000','Sales Income','income',NOW(),NOW())
         ON CONFLICT ("code") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"
         RETURNING id;`, { transaction: t }
      );
      const [rent]  = await queryInterface.sequelize.query(
        `INSERT INTO "Accounts" ("code","name","type","createdAt","updatedAt")
         VALUES ('6000','Rent Expense','expense',NOW(),NOW())
         ON CONFLICT ("code") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"
         RETURNING id;`, { transaction: t }
      );

      const cashId  = cash?.[0]?.id || cash?.id;
      const salesId = sales?.[0]?.id || sales?.id;
      const rentId  = rent?.[0]?.id || rent?.id;

      // One balanced journal
      const [journal] = await queryInterface.sequelize.query(
        `INSERT INTO "JournalEntries" ("date","memo","createdAt","updatedAt")
         VALUES (CURRENT_DATE,'Seeder example',NOW(),NOW())
         RETURNING id, "date";`, { transaction: t }
      );
      const journalId = journal?.[0]?.id || journal?.id;
      const journalDate = journal?.[0]?.date || journal?.date;

      await queryInterface.bulkInsert('LedgerEntries', [
        {
          journalEntryId: journalId,
          accountId: cashId,
          date: journalDate,
          debit: 100000,
          credit: 0,
          description: 'Cash received',
          createdAt: new Date(), updatedAt: new Date(),
        },
        {
          journalEntryId: journalId,
          accountId: salesId,
          date: journalDate,
          debit: 0,
          credit: 100000,
          description: 'Sales',
          createdAt: new Date(), updatedAt: new Date(),
        },
      ], { transaction: t });

      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
  },

  async down (queryInterface) {
    // Non-destructive: keep demo data
    // If you want to remove, you can delete by memo or codes
    await queryInterface.sequelize.query(
      `DELETE FROM "LedgerEntries" WHERE description IN ('Cash received','Sales');`
    );
    await queryInterface.sequelize.query(
      `DELETE FROM "JournalEntries" WHERE memo = 'Seeder example';`
    );
    // Do not remove accounts by default
  }
};
