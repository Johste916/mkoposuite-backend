"use strict";

module.exports = {
  // keep this migration lightweight (no single big transaction)
  useTransaction: false,

  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    // 1) Inspect the table once
    const table = await queryInterface.describeTable({ schema: "public", tableName: "loan_payments" })
      .catch(() => queryInterface.describeTable("loan_payments")); // fallback if schema arg unsupported

    // 2) Add the column only if missing
    if (!table.status) {
      await queryInterface.addColumn(
        { schema: "public", tableName: "loan_payments" },
        "status",
        {
          type: Sequelize.STRING(16), // keep STRING to avoid enum churn
          allowNull: false,
          defaultValue: "approved",
        }
      ).catch(e => {
        // tolerate concurrent/previous runs
        if (!/already exists/i.test(e.message)) throw e;
      });
    }

    // 3) Add index safely
    const idxName = "loan_payments_status_createdAt_idx";
    if (dialect === "postgres") {
      await queryInterface.sequelize.query(
        `CREATE INDEX IF NOT EXISTS "${idxName}" ON "public"."loan_payments" ("status","createdAt");`
      ).catch(() => {});
    } else {
      try {
        // some dialects don’t support IF NOT EXISTS; ignore if it already exists
        await queryInterface.addIndex(
          { schema: "public", tableName: "loan_payments" },
          ["status", "createdAt"],
          { name: idxName }
        );
      } catch (_) {}
    }
  },

  async down(queryInterface /*, Sequelize */) {
    const dialect = queryInterface.sequelize.getDialect();
    const idxName = "loan_payments_status_createdAt_idx";

    // drop index (ignore if missing)
    if (dialect === "postgres") {
      await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${idxName}";`).catch(() => {});
    } else {
      await queryInterface.removeIndex(
        { schema: "public", tableName: "loan_payments" },
        idxName
      ).catch(() => {});
    }

    // drop column if it exists
    const table = await queryInterface.describeTable({ schema: "public", tableName: "loan_payments" })
      .catch(() => queryInterface.describeTable("loan_payments"));
    if (table.status) {
      await queryInterface.removeColumn(
        { schema: "public", tableName: "loan_payments" },
        "status"
      ).catch(() => {});
    }
  },
};
