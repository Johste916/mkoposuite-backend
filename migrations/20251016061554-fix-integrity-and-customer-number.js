'use strict';

/** Robust integrity + customerNumber backfill */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;
    const dialect = sequelize.getDialect();
    const t = await sequelize.transaction();

    // ---------- helpers ----------
    const showAll = async () => {
      const list = await qi.showAllTables({ transaction: t });
      // normalize to { schema, tableName } objects for safety
      return list.map((x) => {
        if (typeof x === 'string') return { schema: null, tableName: x };
        if (x && typeof x === 'object') {
          // sequelize v6 may return { tableName, schema } already
          if (x.tableName) return { schema: x.schema || null, tableName: x.tableName };
          if (x.name) return { schema: x.schema || null, tableName: x.name };
        }
        return { schema: null, tableName: String(x) };
      });
    };

    const qname = (obj) => {
      // quote correctly for the current dialect
      const q = (s) =>
        dialect === 'postgres' ? `"${s.replace(/"/g, '""')}"` :
        dialect === 'mysql'    ? `\`${s.replace(/`/g, '``')}\`` :
        dialect === 'mssql'    ? `[${s.replace(/]/g, ']]')}]` :
        `"${s.replace(/"/g, '""')}"`;
      return obj.schema ? `${q(obj.schema)}.${q(obj.tableName)}` : q(obj.tableName);
    };

    const resolveTable = async (candidates) => {
      const all = await showAll();
      // try case-insensitive match against candidates
      for (const cand of candidates) {
        const found = all.find(
          (t) => t.tableName.toLowerCase() === cand.toLowerCase()
        );
        if (found) return found;
      }
      // fallback: contains match
      for (const cand of candidates) {
        const found = all.find(
          (t) => t.tableName.toLowerCase().includes(cand.toLowerCase())
        );
        if (found) return found;
      }
      return null;
    };

    const describeSafe = async (tbl) => {
      if (!tbl) return null;
      try {
        return await qi.describeTable(tbl, { transaction: t });
      } catch {
        try {
          // try passing object form { schema, tableName }
          return await qi.describeTable({ schema: tbl.schema, tableName: tbl.tableName }, { transaction: t });
        } catch {
          return null;
        }
      }
    };

    try {
      // --- find Borrowers & Loans real names ---
      const borrowersTbl =
        (await resolveTable(['Borrowers', 'borrowers', 'borrower'])) ||
        (() => { throw new Error('Borrowers table not found'); })();

      const loansTbl =
        await resolveTable(['Loans', 'loans', 'loan']) /* may be null if no loans table yet */;

      const borrowersDesc = await describeSafe(borrowersTbl);
      if (!borrowersDesc) throw new Error(`No description found for "${qname(borrowersTbl)}"`);

      // ---------- 1) add & backfill customerNumber ----------
      if (!borrowersDesc.customerNumber) {
        await qi.addColumn(
          borrowersTbl,
          'customerNumber',
          { type: Sequelize.STRING(64), allowNull: true },
          { transaction: t }
        );
      }
      // add index (unique but tolerant if dupes exist in test data)
      try {
        await qi.addIndex(borrowersTbl, {
          fields: ['customerNumber'],
          unique: true,
          name: 'uniq_borrowers_customer_number',
          transaction: t,
        });
      } catch {}

      // backfill values
      if (dialect === 'postgres') {
        await sequelize.query(
          `UPDATE ${qname(borrowersTbl)}
              SET "customerNumber" = 'CUST-' || lpad(id::text, 6, '0')
            WHERE "customerNumber" IS NULL`,
          { transaction: t }
        );
      } else if (dialect === 'mysql' || dialect === 'mariadb') {
        await sequelize.query(
          `UPDATE ${qname(borrowersTbl)}
              SET customerNumber = CONCAT('CUST-', LPAD(id, 6, '0'))
            WHERE customerNumber IS NULL`,
          { transaction: t }
        );
      } else if (dialect === 'sqlite') {
        await sequelize.query(
          `UPDATE ${qname(borrowersTbl)}
              SET customerNumber = ('CUST-' || printf('%06d', id))
            WHERE customerNumber IS NULL`,
          { transaction: t }
        );
      } // (mssql etc. could be added similarly)

      // ---------- 2) fix orphan loans + add FK ----------
      if (loansTbl) {
        const loansDesc = await describeSafe(loansTbl);
        if (loansDesc) {
          // borrowerId can be camel or snake; detect it
          const borrowerCol = loansDesc.borrowerId
            ? 'borrowerId'
            : (loansDesc.borrower_id ? 'borrower_id' : null);

          if (borrowerCol) {
            // detach orphans (set NULL). If you want DELETE instead, swap the SQL.
            const borrowerColQuoted =
              dialect === 'postgres' ? `"${borrowerCol}"` :
              dialect === 'mysql'    ? `\`${borrowerCol}\`` :
              dialect === 'mssql'    ? `[${borrowerCol}]` :
              `"${borrowerCol}"`;

            await sequelize.query(
              `UPDATE ${qname(loansTbl)} l
                  SET ${borrowerColQuoted} = NULL
                WHERE ${borrowerColQuoted} IS NOT NULL
                  AND NOT EXISTS (
                        SELECT 1
                          FROM ${qname(borrowersTbl)} b
                         WHERE b.id = l.${borrowerColQuoted}
                  )`,
              { transaction: t }
            );

            // add FK (ignore if exists)
            try {
              await qi.addConstraint(loansTbl, {
                name: 'fk_loans_borrower',
                type: 'foreign key',
                fields: [borrowerCol],
                references: { table: borrowersTbl, field: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'RESTRICT',
                transaction: t,
              });
            } catch {}
          }
        }
      }

      // ---------- 3) sync Borrowers sequence (postgres only) ----------
      if (dialect === 'postgres') {
        await sequelize.query(
          `SELECT setval(
              pg_get_serial_sequence(${sequelize.escape(qname(borrowersTbl))}, 'id'),
              COALESCE((SELECT MAX(id) FROM ${qname(borrowersTbl)}), 0)
           )`,
          { transaction: t }
        );
      }

      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
  },

  async down(queryInterface) {
    const qi = queryInterface;
    try { await qi.removeConstraint('Loans', 'fk_loans_borrower'); } catch {}
    try { await qi.removeIndex('Borrowers', 'uniq_borrowers_customer_number'); } catch {}
    // keep customerNumber column since FE depends on it
  },
};
