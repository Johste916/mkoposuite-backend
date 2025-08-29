'use strict';
module.exports = {
  async up(qi, Sequelize) {
    const t = await qi.sequelize.transaction();
    try {
      await qi.createTable('Employees', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        tenant_id: { type: Sequelize.UUID, allowNull: true },
        branchId:  { type: Sequelize.INTEGER, allowNull: true, references: { model: 'branches', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
        first_name:{ type: Sequelize.STRING(64), allowNull: false },
        last_name: { type: Sequelize.STRING(64), allowNull: false },
        email:     { type: Sequelize.STRING(128), allowNull: true, unique: true },
        phone:     { type: Sequelize.STRING(32), allowNull: true },
        position:  { type: Sequelize.STRING(64), allowNull: true },
        hire_date: { type: Sequelize.DATEONLY, allowNull: true },
        status:    { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'active' },
        salary_base:{ type: Sequelize.DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        bank_name: { type: Sequelize.STRING(64), allowNull: true },
        bank_account:{ type: Sequelize.STRING(64), allowNull: true },
        nhif_no:   { type: Sequelize.STRING(64), allowNull: true },
        nssf_no:   { type: Sequelize.STRING(64), allowNull: true },
        tin_no:    { type: Sequelize.STRING(64), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });
      await qi.addIndex('Employees', ['tenant_id'], { transaction: t });
      await qi.addIndex('Employees', ['status'], { transaction: t });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }
  },
  async down(qi) { await qi.dropTable('Employees'); },
};
