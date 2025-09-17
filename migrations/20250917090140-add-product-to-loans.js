// migrations/20250810110051-add-product-to-loans.js
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) Add column only if it doesn't exist
    const table = await queryInterface.describeTable('loans');
    if (!table.product_id) {
      await queryInterface.addColumn('loans', 'product_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }

    // 2) Add FK only if it doesn't exist
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM   pg_constraint c
          JOIN   pg_class t ON t.oid = c.conrelid
          WHERE  c.conname = 'fk_loans_product_id'
          AND    t.relname = 'loans'
        ) THEN
          ALTER TABLE public.loans
          ADD CONSTRAINT fk_loans_product_id
          FOREIGN KEY ("product_id")
          REFERENCES public.loan_products(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL;
        END IF;
      END$$;
    `);
  },

  async down(queryInterface) {
    // 1) Drop FK if it exists
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM   pg_constraint c
          JOIN   pg_class t ON t.oid = c.conrelid
          WHERE  c.conname = 'fk_loans_product_id'
          AND    t.relname = 'loans'
        ) THEN
          ALTER TABLE public.loans
          DROP CONSTRAINT fk_loans_product_id;
        END IF;
      END$$;
    `);

    // 2) Drop column if it exists
    try {
      const table = await queryInterface.describeTable('loans');
      if (table.product_id) {
        await queryInterface.removeColumn('loans', 'product_id');
      }
    } catch (_) {
      // ignore
    }
  }
};
