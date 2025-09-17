'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, DATEONLY, STRING, TEXT, DECIMAL, ENUM } = Sequelize;

    // 1) Create table (no FKs here; keeps it non-breaking for existing data)
    await queryInterface.createTable(
      { tableName: 'expenses', schema: 'public' },
      {
        id:         { type: UUID, primaryKey: true, defaultValue: UUIDV4 },
        tenantId:   { type: UUID, allowNull: false },
        branchId:   { type: UUID, allowNull: true },

        date:       { type: DATEONLY, allowNull: false },
        type:       { type: STRING, allowNull: true },
        vendor:     { type: STRING, allowNull: true },
        reference:  { type: STRING, allowNull: true },
        amount:     { type: DECIMAL(18, 2), allowNull: false },
        note:       { type: TEXT, allowNull: true },

        status:     { type: ENUM('POSTED', 'VOID'), allowNull: false, defaultValue: 'POSTED' },

        createdBy:  { type: UUID, allowNull: true },
        updatedBy:  { type: UUID, allowNull: true },

        createdAt:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }
    );

    // 2) Add indexes ONLY if the columns exist, using the actual names seen by the DB
    const cols = await queryInterface.describeTable({ tableName: 'expenses', schema: 'public' });
    const findCol = (wantedLower) =>
      Object.keys(cols).find((c) => c.toLowerCase() === wantedLower);

    const tenantCol  = findCol('tenantid');
    const branchCol  = findCol('branchid');
    const dateCol    = findCol('date');

    // helper to add index if not already there
    const ensureIndex = async (name, fields) => {
      const existing = await queryInterface.showIndex({ tableName: 'expenses', schema: 'public' }).catch(() => []);
      if (!existing.some((i) => i.name === name)) {
        await queryInterface.addIndex({ tableName: 'expenses', schema: 'public' }, fields, { name });
      }
    };

    if (tenantCol) {
      await ensureIndex('expenses_tenantId_idx', [tenantCol]);
    }
    if (tenantCol && dateCol) {
      await ensureIndex('expenses_tenantId_date_idx', [tenantCol, dateCol]);
    }
    if (tenantCol && branchCol) {
      await ensureIndex('expenses_tenantId_branchId_idx', [tenantCol, branchCol]);
    }
  },

  async down(queryInterface, Sequelize) {
    // Drop table first (this also drops its indexes)
    await queryInterface.dropTable({ tableName: 'expenses', schema: 'public' }).catch(() => {});

    // On Postgres, Sequelize creates an enum type for status — clean it up safely.
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize
        .query('DROP TYPE IF EXISTS "enum_expenses_status";')
        .catch(() => {});
    }
  },
};
