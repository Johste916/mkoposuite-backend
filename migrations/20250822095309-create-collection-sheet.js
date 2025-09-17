'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(qi, Sequelize) {
    const dialect = qi.sequelize.getDialect();
    const isPg = dialect === 'postgres';

    // -------- helpers --------
    const mapType = (t) => {
      const s = String(t || '').toLowerCase();
      if (s.includes('uuid')) return Sequelize.UUID;
      if (s.includes('bigint')) return Sequelize.BIGINT;
      return Sequelize.INTEGER;
    };

    const tableExists = async (name) => {
      if (isPg) {
        const [rows] = await qi.sequelize.query(
          `SELECT to_regclass('public."${name}"') AS reg;`
        );
        return !!rows?.[0]?.reg;
      }
      // fallback (non-PG)
      try {
        await qi.describeTable(name);
        return true;
      } catch {
        return false;
      }
    };

    const indexExists = async (table, name) => {
      try {
        const idx = await qi.showIndex(table);
        return idx.some((i) => i.name === name);
      } catch {
        return false;
      }
    };

    // -------- detect PK types for FKs (non-breaking) --------
    let hasBranches = true;
    let hasUsers = true;
    let branchPkType = Sequelize.INTEGER;
    let userPkType = Sequelize.INTEGER;

    try {
      const branches = await qi.describeTable('branches');
      branchPkType = mapType(branches?.id?.type);
    } catch {
      hasBranches = false;
    }
    try {
      const users = await qi.describeTable('users');
      userPkType = mapType(users?.id?.type);
    } catch {
      hasUsers = false;
    }

    // -------- ensure enum type exists on PG (don’t drop it) --------
    if (isPg) {
      await qi.sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_collection_sheets_status') THEN
            CREATE TYPE enum_collection_sheets_status AS ENUM ('pending','completed','cancelled');
          END IF;
        END$$;
      `);
    }

    // -------- create table if missing --------
    const tableName = 'collection_sheets';
    if (!(await tableExists(tableName))) {
      const branchIdCol = { type: branchPkType, allowNull: true };
      if (hasBranches) {
        branchIdCol.references = { model: 'branches', key: 'id' };
        branchIdCol.onUpdate = 'CASCADE';
        branchIdCol.onDelete = 'SET NULL';
      }

      const collectorIdCol = { type: userPkType, allowNull: true };
      const loanOfficerIdCol = { type: userPkType, allowNull: true };
      if (hasUsers) {
        collectorIdCol.references = { model: 'users', key: 'id' };
        collectorIdCol.onUpdate = 'CASCADE';
        collectorIdCol.onDelete = 'SET NULL';

        loanOfficerIdCol.references = { model: 'users', key: 'id' };
        loanOfficerIdCol.onUpdate = 'CASCADE';
        loanOfficerIdCol.onDelete = 'SET NULL';
      }

      await qi.createTable(tableName, {
        id: {
          type: Sequelize.UUID,
          allowNull: false,
          primaryKey: true,
          // model may set default UUIDV4; leaving DB default out is fine
        },
        date: { type: Sequelize.DATEONLY, allowNull: false },
        type: { type: Sequelize.STRING, allowNull: false },

        collector: { type: Sequelize.STRING, allowNull: true },
        loanOfficer: { type: Sequelize.STRING, allowNull: true },

        status: isPg
          ? Sequelize.ENUM({
              name: 'enum_collection_sheets_status',
              values: ['pending', 'completed', 'cancelled'],
            })
          : Sequelize.ENUM('pending', 'completed', 'cancelled'),

        branchId: branchIdCol,
        collectorId: collectorIdCol,
        loanOfficerId: loanOfficerIdCol,

        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    } else {
      // table exists -> ensure the status enum has all values (PG only)
      if (isPg) {
        // Add any missing enum labels (idempotent)
        for (const val of ['pending', 'completed', 'cancelled']) {
          await qi.sequelize
            .query(
              `DO $$
               BEGIN
                 IF NOT EXISTS (
                   SELECT 1
                   FROM pg_enum e
                   JOIN pg_type t ON e.enumtypid = t.oid
                   WHERE t.typname = 'enum_collection_sheets_status' AND e.enumlabel = '${val}'
                 ) THEN
                   ALTER TYPE enum_collection_sheets_status ADD VALUE IF NOT EXISTS '${val}';
                 END IF;
               END$$;`
            )
            .catch(() => {});
        }
      }
    }

    // -------- indexes (safe/no-throw) --------
    const idxDate = 'collection_sheets_date_idx';
    const idxStatus = 'collection_sheets_status_idx';
    const idxType = 'collection_sheets_type_idx';

    if (!(await indexExists(tableName, idxDate))) {
      await qi.addIndex(tableName, ['date'], { name: idxDate }).catch(() => {});
    }
    if (!(await indexExists(tableName, idxStatus))) {
      await qi.addIndex(tableName, ['status'], { name: idxStatus }).catch(() => {});
    }
    if (!(await indexExists(tableName, idxType))) {
      await qi.addIndex(tableName, ['type'], { name: idxType }).catch(() => {});
    }
  },

  async down(qi /*, Sequelize */) {
    const isPg = qi.sequelize.getDialect() === 'postgres';

    // Drop table first (removes dependency on enum)
    await qi.dropTable('collection_sheets').catch(() => {});

    // Now it’s safe to drop the enum (if no other deps)
    if (isPg) {
      await qi.sequelize
        .query(`DROP TYPE IF EXISTS enum_collection_sheets_status;`)
        .catch(() => {});
    }
  },
};
