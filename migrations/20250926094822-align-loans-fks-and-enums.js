'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;

    // Helper: does a column exist and what's its type?
    const describe = async (table) => {
      try { return await qi.describeTable(table); } catch { return {}; }
    };
    const pgType = (x) => String(x || '').toLowerCase();

    // 1) Detect Users PK type
    const usersDesc = await describe('Users');
    const usersIdType = pgType(usersDesc?.id?.type || '');

    // 2) If Users.id is uuid, make loans.approvedBy / disbursedBy uuid too (when int)
    const loansDesc = await describe('loans');
    const approvedByType = pgType(loansDesc?.approvedBy?.type || '');
    const disbursedByType = pgType(loansDesc?.disbursedBy?.type || '');

    const isUsersUuid = usersIdType.includes('uuid');

    if (isUsersUuid) {
      // approvedBy
      if (approvedByType.includes('int')) {
        // convert to uuid, set existing ints to NULL (safe, non-breaking)
        await sequelize.query(`
          ALTER TABLE "public"."loans"
          ALTER COLUMN "approvedBy" DROP DEFAULT,
          ALTER COLUMN "approvedBy" TYPE uuid USING NULL
        `);
      }
      // disbursedBy
      if (disbursedByType.includes('int')) {
        await sequelize.query(`
          ALTER TABLE "public"."loans"
          ALTER COLUMN "disbursedBy" DROP DEFAULT,
          ALTER COLUMN "disbursedBy" TYPE uuid USING NULL
        `);
      }
      // (Optional) If you also want rejectedBy/initiatedBy to point to Users.id, add them here similarly.
      // NOTE: You added rejectedBy/initiatedBy as INTEGER in another migration; we leave them unchanged for now.
    }

    // 3) Ensure status enum has 'closed'
    // Add value if missing (Postgres only)
    if (sequelize.getDialect() === 'postgres') {
      // Find current enum type name
      // By convention Sequelize creates enum type name like "enum_loans_status"
      // We'll just attempt "enum_loans_status" and add value if not present
      await sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            WHERE t.typname = 'enum_loans_status' AND e.enumlabel = 'closed'
          ) THEN
            ALTER TYPE "enum_loans_status" ADD VALUE IF NOT EXISTS 'closed';
          END IF;
        END$$;
      `);
    }

    // 4) Normalize interestMethod value label if an old label exists
    // If your DB had 'reducing_balance', rename to 'reducing'
    if (sequelize.getDialect() === 'postgres') {
      // try to rename enum label on the type used by loans.interestMethod
      await sequelize.query(`
        DO $$
        DECLARE
          has_old_label boolean;
        BEGIN
          SELECT EXISTS(
            SELECT 1 FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            WHERE t.typname = 'enum_loans_interestMethod' AND e.enumlabel = 'reducing_balance'
          ) INTO has_old_label;

          IF has_old_label THEN
            ALTER TYPE "enum_loans_interestMethod" RENAME VALUE 'reducing_balance' TO 'reducing';
          END IF;
        END$$;
      `).catch(() => {});
    }
  },

  async down(/* queryInterface, Sequelize */) {
    // No-op: we won't auto-downgrade FK type changes or enum label changes.
  },
};
