'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const TBL = { tableName: 'payments', schema: 'public' };

    // helper: does table exist?
    const tableExists = async () => {
      const [rows] = await queryInterface.sequelize.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = :schema AND table_name = :table
         LIMIT 1;`,
        { replacements: { schema: TBL.schema, table: TBL.tableName } }
      );
      return rows && rows.length > 0;
    };

    // 1) Create the table if it doesn't exist
    if (!(await tableExists())) {
      await queryInterface.createTable(TBL, {
        id:         { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },

        // Use snake_case here; we'll discover actual column names later when indexing
        tenant_id:  { type: Sequelize.UUID, allowNull: false },
        invoice_id: { type: Sequelize.UUID, allowNull: true },

        amount_cents: { type: Sequelize.INTEGER, allowNull: false },
        currency:     { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
        method:       { type: Sequelize.STRING(32) },        // mpesa, card, bank, ...
        reference:    { type: Sequelize.STRING(128) },
        received_at:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
        notes:        { type: Sequelize.TEXT },
        metadata:     { type: Sequelize.JSONB },

        created_at:   { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
        updated_at:   { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      });

      // Conditionally add FKs only if referenced tables exist (prevents failures on out-of-order runs)
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='tenants') THEN
            ALTER TABLE "public"."payments"
              ADD CONSTRAINT payments_tenant_id_fkey
              FOREIGN KEY ("tenant_id")
              REFERENCES "public"."tenants"(id)
              ON UPDATE CASCADE ON DELETE CASCADE;
          END IF;

          IF EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='invoices') THEN
            ALTER TABLE "public"."payments"
              ADD CONSTRAINT payments_invoice_id_fkey
              FOREIGN KEY ("invoice_id")
              REFERENCES "public"."invoices"(id)
              ON UPDATE CASCADE ON DELETE SET NULL;
          END IF;
        END$$;
      `);
    }

    // 2) Discover actual column names (handles tenant_id vs tenantId, etc.)
    const cols = await queryInterface.describeTable(TBL);
    const findCol = (wantedLower) =>
      Object.keys(cols).find((c) => c.toLowerCase() === wantedLower);

    const tenantCol  = findCol('tenant_id')  || findCol('tenantid');
    const invoiceCol = findCol('invoice_id') || findCol('invoiceid');
    const referenceCol = findCol('reference');

    // 3) Add indexes only if the target columns actually exist (and index not already present)
    const existingIdx = await queryInterface.showIndex(TBL).catch(() => []);

    const ensureIndex = async (name, fields) => {
      if (!existingIdx.some((i) => i.name === name)) {
        await queryInterface.addIndex(TBL, fields, { name });
      }
    };

    if (tenantCol)  await ensureIndex('payments_tenant_idx',   [tenantCol]);
    if (invoiceCol) await ensureIndex('payments_invoice_idx',  [invoiceCol]);
    if (referenceCol) await ensureIndex('payments_reference_idx', [referenceCol]);
  },

  async down(queryInterface) {
    // Drop the table (drops indexes & FKs too)
    await queryInterface.dropTable({ tableName: 'payments', schema: 'public' }).catch(() => {});
  },
};
