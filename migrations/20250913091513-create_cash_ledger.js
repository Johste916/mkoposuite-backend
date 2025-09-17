'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const schema = 'public';
    const ACC = { schema, tableName: 'cash_accounts' };
    const TXN = { schema, tableName: 'cash_transactions' };

    const tableExists = async (tbl) => {
      const [rows] = await queryInterface.sequelize.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = :schema AND table_name = :table
         LIMIT 1;`,
        { replacements: { schema: tbl.schema, table: tbl.tableName } }
      );
      return rows && rows.length > 0;
    };

    // ---------- cash_accounts ----------
    if (!(await tableExists(ACC))) {
      await queryInterface.createTable(ACC, {
        id:               { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        tenant_id:        { type: Sequelize.UUID, allowNull: false },
        name:             { type: Sequelize.STRING(120), allowNull: false },
        branch_id:        { type: Sequelize.UUID, allowNull: true },
        opening_balance:  { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        current_balance:  { type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        currency:         { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'TZS' },
        is_active:        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        meta:             { type: Sequelize.JSONB },
        created_at:       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at:       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });

      // Optional FKs (only if the target table exists)
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='tenants') THEN
            ALTER TABLE "public"."cash_accounts"
              ADD CONSTRAINT cash_accounts_tenant_fk
              FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"(id)
              ON UPDATE CASCADE ON DELETE CASCADE;
          END IF;

          IF EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='branches') THEN
            ALTER TABLE "public"."cash_accounts"
              ADD CONSTRAINT cash_accounts_branch_fk
              FOREIGN KEY ("branch_id") REFERENCES "public"."branches"(id)
              ON UPDATE CASCADE ON DELETE SET NULL;
          END IF;
        END$$;
      `);
    }

    // ---------- cash_transactions ----------
    if (!(await tableExists(TXN))) {
      await queryInterface.createTable(TXN, {
        id:               { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        tenant_id:        { type: Sequelize.UUID, allowNull: false },
        cash_account_id:  { type: Sequelize.UUID, allowNull: false },
        direction:        { type: Sequelize.STRING(8), allowNull: false },    // debit|credit
        type:             { type: Sequelize.STRING(32), allowNull: false },   // deposit|withdrawal|...
        amount:           { type: Sequelize.DECIMAL(18,2), allowNull: false },
        currency:         { type: Sequelize.STRING(8) },
        occurred_at:      { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        reference:        { type: Sequelize.STRING(120) },
        description:      { type: Sequelize.TEXT },
        status:           { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'posted' },
        loan_id:          { type: Sequelize.UUID },
        borrower_id:      { type: Sequelize.UUID },
        created_by:       { type: Sequelize.UUID },
        meta:             { type: Sequelize.JSONB },
        created_at:       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at:       { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });

      // Optional FKs
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='tenants') THEN
            ALTER TABLE "public"."cash_transactions"
              ADD CONSTRAINT cash_txn_tenant_fk
              FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"(id)
              ON UPDATE CASCADE ON DELETE CASCADE;
          END IF;

          IF EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='cash_accounts') THEN
            ALTER TABLE "public"."cash_transactions"
              ADD CONSTRAINT cash_txn_account_fk
              FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"(id)
              ON UPDATE CASCADE ON DELETE CASCADE;
          END IF;
        END$$;
      `);
    }

    // -------- Indexes (discover actual column names first) --------
    const describeAndFind = async (tbl, wantedLower) => {
      const cols = await queryInterface.describeTable(tbl);
      return Object.keys(cols).find((c) => c.toLowerCase() === wantedLower);
    };
    const ensureIndex = async (tbl, name, fields) => {
      const existing = await queryInterface.showIndex(tbl).catch(() => []);
      if (!existing.some((i) => i.name === name)) {
        await queryInterface.addIndex(tbl, fields, { name });
      }
    };

    // cash_accounts indexes
    {
      const tenantCol = await describeAndFind(ACC, 'tenant_id') || await describeAndFind(ACC, 'tenantid');
      const nameCol   = await describeAndFind(ACC, 'name');
      const branchCol = await describeAndFind(ACC, 'branch_id') || await describeAndFind(ACC, 'branchid');

      if (tenantCol) await ensureIndex(ACC, 'cash_accounts_tenant_idx', [tenantCol]);
      if (tenantCol && nameCol) await ensureIndex(ACC, 'cash_accounts_tenant_name_idx', [tenantCol, nameCol]);
      if (branchCol) await ensureIndex(ACC, 'cash_accounts_branch_idx', [branchCol]);
    }

    // cash_transactions indexes
    {
      const tenantCol = await describeAndFind(TXN, 'tenant_id') || await describeAndFind(TXN, 'tenantid');
      const acctCol   = await describeAndFind(TXN, 'cash_account_id') || await describeAndFind(TXN, 'cashaccountid');
      const typeCol   = await describeAndFind(TXN, 'type');
      const statusCol = await describeAndFind(TXN, 'status');
      const occAtCol  = await describeAndFind(TXN, 'occurred_at') || await describeAndFind(TXN, 'occurredat');
      const loanCol   = await describeAndFind(TXN, 'loan_id') || await describeAndFind(TXN, 'loanid');
      const borCol    = await describeAndFind(TXN, 'borrower_id') || await describeAndFind(TXN, 'borrowerid');

      if (tenantCol) await ensureIndex(TXN, 'cash_txn_tenant_idx', [tenantCol]);
      if (acctCol) await ensureIndex(TXN, 'cash_txn_account_idx', [acctCol]);
      if (typeCol) await ensureIndex(TXN, 'cash_txn_type_idx', [typeCol]);
      if (statusCol) await ensureIndex(TXN, 'cash_txn_status_idx', [statusCol]);
      if (occAtCol) await ensureIndex(TXN, 'cash_txn_occurred_at_idx', [occAtCol]);
      if (loanCol) await ensureIndex(TXN, 'cash_txn_loan_idx', [loanCol]);
      if (borCol) await ensureIndex(TXN, 'cash_txn_borrower_idx', [borCol]);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ schema: 'public', tableName: 'cash_transactions' }).catch(() => {});
    await queryInterface.dropTable({ schema: 'public', tableName: 'cash_accounts' }).catch(() => {});
  },
};
