// migrations/20240925-extend-loan-products-for-term-fees-and-period.js
/* eslint-disable consistent-return */
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const t = await queryInterface.sequelize.transaction();
    try {
      // 1) interest_period: weekly|monthly|yearly (default monthly)
      await queryInterface.addColumn(
        'loan_products',
        'interest_period',
        {
          type: Sequelize.ENUM('weekly', 'monthly', 'yearly'),
          allowNull: false,
          defaultValue: 'monthly',
        },
        { transaction: t }
      );

      // 2) term_value: integer (nullable)
      await queryInterface.addColumn(
        'loan_products',
        'term_value',
        {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        { transaction: t }
      );

      // 3) term_unit: days|weeks|months|years (default months)
      await queryInterface.addColumn(
        'loan_products',
        'term_unit',
        {
          type: Sequelize.ENUM('days', 'weeks', 'months', 'years'),
          allowNull: false,
          defaultValue: 'months',
        },
        { transaction: t }
      );

      // 4) fee fields (normalized)
      await queryInterface.addColumn(
        'loan_products',
        'fee_type',
        {
          type: Sequelize.ENUM('amount', 'percent'),
          allowNull: false,
          defaultValue: 'amount',
        },
        { transaction: t }
      );

      await queryInterface.addColumn(
        'loan_products',
        'fee_amount',
        {
          type: Sequelize.DECIMAL(14, 2),
          allowNull: true,
        },
        { transaction: t }
      );

      await queryInterface.addColumn(
        'loan_products',
        'fee_percent',
        {
          type: Sequelize.DECIMAL(10, 4),
          allowNull: true,
        },
        { transaction: t }
      );

      // 5) meta JSONB (safe landing zone)
      await queryInterface.addColumn(
        'loan_products',
        'meta',
        {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: {},
        },
        { transaction: t }
      );

      // 6) Backfill (best-effort):
      // - If term_value missing but min_term_months has a single value (or equals max), copy it.
      // - Ensure enums have a value even if older rows were inserted oddly.
      await queryInterface.sequelize.query(
        `
        UPDATE loan_products
        SET term_value = COALESCE(term_value, min_term_months)
        WHERE term_value IS NULL
          AND min_term_months IS NOT NULL
          AND (max_term_months IS NULL OR max_term_months = min_term_months);
        `,
        { transaction: t }
      );

      await queryInterface.sequelize.query(
        `
        UPDATE loan_products
        SET interest_period = 'monthly'
        WHERE interest_period IS NULL;
        `,
        { transaction: t }
      );

      await queryInterface.sequelize.query(
        `
        UPDATE loan_products
        SET term_unit = 'months'
        WHERE term_unit IS NULL;
        `,
        { transaction: t }
      );

      await queryInterface.sequelize.query(
        `
        UPDATE loan_products
        SET fee_type = 'amount'
        WHERE fee_type IS NULL;
        `,
        { transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const t = await queryInterface.sequelize.transaction();
    try {
      // Remove columns in reverse order
      await queryInterface.removeColumn('loan_products', 'meta', { transaction: t });
      await queryInterface.removeColumn('loan_products', 'fee_percent', { transaction: t });
      await queryInterface.removeColumn('loan_products', 'fee_amount', { transaction: t });
      await queryInterface.removeColumn('loan_products', 'fee_type', { transaction: t });
      await queryInterface.removeColumn('loan_products', 'term_unit', { transaction: t });
      await queryInterface.removeColumn('loan_products', 'term_value', { transaction: t });
      await queryInterface.removeColumn('loan_products', 'interest_period', { transaction: t });

      // Drop enum types (Postgres only) — names follow Sequelize's convention
      // If your dialect is not Postgres, these DROP TYPE statements are safe to skip.
      const dropEnum = async (typeName) => {
        await queryInterface.sequelize.query(`DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_type WHERE typname = '${typeName}') THEN
            DROP TYPE "${typeName}";
          END IF;
        END $$;`, { transaction: t });
      };

      await dropEnum('enum_loan_products_interest_period');
      await dropEnum('enum_loan_products_term_unit');
      await dropEnum('enum_loan_products_fee_type');

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
