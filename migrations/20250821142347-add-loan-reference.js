'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) Add nullable column first
    await queryInterface.addColumn('loans', 'reference', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // 2) Backfill existing rows with a generated reference (Postgres-friendly)
    //    Format: LN-<borrowerId>-<6-char>
    //    Use md5(random()) for a simple short token.
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        UPDATE "public"."loans"
           SET "reference" = 'LN-' || COALESCE("borrowerId"::text, 'X') || '-' ||
                             SUBSTRING(md5(random()::text), 1, 6)
         WHERE "reference" IS NULL;
      `);
    } else {
      // generic fallback (no-op). If you run MySQL/SQLite, consider writing a quick script to backfill.
    }

    // 3) Add a unique index (partial unique for PG to avoid conflicts with future nulls)
    if (dialect === 'postgres') {
      await queryInterface.addIndex('loans', {
        fields: ['reference'],
        unique: true,
        name: 'loans_reference_unique_idx',
        where: { reference: { [Sequelize.Op.ne]: null } },
      });
    } else {
      // Non-PG: regular unique index (will fail if nulls present/duplicates exist)
      await queryInterface.addIndex('loans', {
        fields: ['reference'],
        unique: true,
        name: 'loans_reference_unique_idx',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('loans', 'loans_reference_unique_idx').catch(() => {});
    await queryInterface.removeColumn('loans', 'reference');
  },
};
