'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'invoices', schema: 'public' },
      {
        id:         { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.UUIDV4 },
        tenant_id:  {
          type: Sequelize.UUID, allowNull: false,
          references: { model: { tableName: 'tenants', schema: 'public' }, key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        number:       { type: Sequelize.STRING(64), allowNull: false },
        currency:     { type: Sequelize.STRING(3),  allowNull: false, defaultValue: 'USD' },
        amount_cents: { type: Sequelize.INTEGER,    allowNull: false },
        status: {
          type: Sequelize.ENUM('draft','open','past_due','paid','void'),
          allowNull: false,
          defaultValue: 'draft',
        },
        due_date:   { type: Sequelize.DATEONLY },
        issued_at:  { type: Sequelize.DATE },
        paid_at:    { type: Sequelize.DATE },
        description:{ type: Sequelize.TEXT },
        metadata:   { type: Sequelize.JSONB },

        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      }
    );

    await queryInterface.addIndex({ tableName: 'invoices', schema: 'public' }, ['tenant_id']);
    await queryInterface.addIndex({ tableName: 'invoices', schema: 'public' }, ['tenant_id', 'status']);
    await queryInterface.addConstraint(
      { tableName: 'invoices', schema: 'public' },
      { fields: ['tenant_id', 'number'], type: 'unique', name: 'invoices_tenant_number_uniq' }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'invoices', schema: 'public' });
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_invoices_status') THEN
          DROP TYPE "enum_invoices_status";
        END IF;
      END$$;`);
  },
};
