"use strict";
module.exports = {
  up: async (q, Sequelize) => {
    await q.createTable("Employees", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      firstName: Sequelize.STRING,
      lastName: Sequelize.STRING,
      email: { type: Sequelize.STRING, unique: true },
      staffNo: Sequelize.STRING,
      role: { type: Sequelize.STRING, defaultValue: "staff" }, // staff | payroll_admin | branch_manager | admin | director
      baseSalary: { type: Sequelize.DECIMAL(18,2), defaultValue: 0 },
      photoUrl: Sequelize.STRING,
      active: { type: Sequelize.BOOLEAN, defaultValue: true },
      createdAt: Sequelize.DATE, updatedAt: Sequelize.DATE,
    });
  },
  down: async (q)=> { await q.dropTable("Employees"); }
};
