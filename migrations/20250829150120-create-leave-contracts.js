'use strict';
module.exports = {
  async up(qi, Sequelize) {
    const t = await qi.sequelize.transaction();
    try {
      await qi.createTable('LeaveRequests', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        tenant_id: { type: Sequelize.UUID, allowNull: true },
        employee_id:{ type: Sequelize.INTEGER, allowNull: false, references: { model: 'Employees', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
        type: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'annual' },
        start_date: { type: Sequelize.DATEONLY, allowNull: false },
        end_date:   { type: Sequelize.DATEONLY, allowNull: false },
        days:       { type: Sequelize.DECIMAL(5,2), allowNull: true },
        status:     { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
        reason:     { type: Sequelize.STRING(255), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });

      await qi.createTable('Contracts', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        tenant_id: { type: Sequelize.UUID, allowNull: true },
        employee_id:{ type: Sequelize.INTEGER, allowNull: false, references: { model: 'Employees', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
        title: { type: Sequelize.STRING(128), allowNull: true },
        start_date: { type: Sequelize.DATEONLY, allowNull: false },
        end_date:   { type: Sequelize.DATEONLY, allowNull: true },
        salary_base:{ type: Sequelize.DECIMAL(18,2), allowNull: true },
        file_url:   { type: Sequelize.STRING(255), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });

      await t.commit();
    } catch (e) { await t.rollback(); throw e; }
  },
  async down(qi) {
    await qi.dropTable('Contracts');
    await qi.dropTable('LeaveRequests');
  },
};
