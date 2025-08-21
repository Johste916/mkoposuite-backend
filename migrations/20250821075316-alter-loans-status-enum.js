// migrations/20250821075316-alter-loans-status-enum.js
'use strict';

module.exports = {
  async up(queryInterface) {
    const enumName = 'enum_loans_status';

    // helper that adds a value only if missing
    const addValueIfMissing = async (val) => {
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            WHERE t.typname = '${enumName}' AND e.enumlabel = '${val}'
          ) THEN
            -- Note: no BEFORE/AFTER here for broad compatibility
            ALTER TYPE "${enumName}" ADD VALUE '${val}';
          END IF;
        END
        $$;
      `);
    };

    await addValueIfMissing('active');
    await addValueIfMissing('delinquent'); // keep if your app ever uses it
    await addValueIfMissing('closed');
  },

  async down(/* queryInterface */) {
    // No-op: removing enum values requires a type rebuild; intentionally omitted.
  },
};

// IMPORTANT: Some Postgres versions don't allow ALTER TYPE ... ADD VALUE
// inside a transaction. This tells sequelize-cli not to wrap this migration.
module.exports.config = { transaction: false };
