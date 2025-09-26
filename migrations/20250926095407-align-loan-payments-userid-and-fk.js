'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;

    const describe = async (table) => {
      try { return await qi.describeTable(table); } catch { return {}; }
    };
    const pgType = (x) => String(x || '').toLowerCase();

    // Detect Users PK type
    const usersDesc = await describe('Users');
    const usersIdType = pgType(usersDesc?.id?.type || '');
    const isUsersUuid = usersIdType.includes('uuid');

    // Ensure loan_payments exists (your earlier migrations create it if missing)
    const lpDesc = await describe('loan_payments');
    if (!lpDesc || Object.keys(lpDesc).length === 0) {
      // Nothing to do if table not present (your other migrations will create it)
      return;
    }

    // If Users.id is UUID, make loan_payments.userId UUID too (when not already)
    if (isUsersUuid) {
      const userIdType = pgType(lpDesc?.userId?.type || '');
      if (!userIdType.includes('uuid')) {
        // Drop any dependent FK first (if it exists)
        await sequelize.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM information_schema.table_constraints
              WHERE constraint_type='FOREIGN KEY'
                AND table_schema=current_schema()
                AND table_name='loan_payments'
                AND constraint_name='loan_payments_userId_fkey'
            ) THEN
              ALTER TABLE "public"."loan_payments" DROP CONSTRAINT "loan_payments_userId_fkey";
            END IF;
          END
          $$;
        `);

        // Convert to UUID safely (ints cannot cast to uuid → use NULL)
        await sequelize.query(`
          ALTER TABLE "public"."loan_payments"
          ALTER COLUMN "userId" DROP DEFAULT,
          ALTER COLUMN "userId" TYPE uuid USING NULL
        `);
      }

      // (Re)add FK to Users(id) if Users table exists
      await sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'Users'
          ) THEN
            -- ensure not already present
            IF NOT EXISTS (
              SELECT 1
              FROM information_schema.table_constraints
              WHERE constraint_type='FOREIGN KEY'
                AND table_schema=current_schema()
                AND table_name='loan_payments'
                AND constraint_name='loan_payments_userId_fkey'
            ) THEN
              ALTER TABLE "public"."loan_payments"
              ADD CONSTRAINT "loan_payments_userId_fkey"
              FOREIGN KEY ("userId") REFERENCES "public"."Users"(id)
              ON UPDATE SET NULL ON DELETE SET NULL;
            END IF;
          END IF;
        END
        $$;
      `);
    }
  },

  async down(/* queryInterface, Sequelize */) {
    // No-op: we keep UUID + FK if established.
  },

  // Some PG setups dislike DDL inside tx for type changes
  config: { transaction: false },
};
