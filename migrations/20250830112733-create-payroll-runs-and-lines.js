"use strict";
module.exports = {
  up: async (q, S) => {
    await q.createTable("PayrollRuns", {
      id:{ type:S.INTEGER, autoIncrement:true, primaryKey:true },
      runId:{ type:S.STRING, unique:true }, // batch code
      periodFrom:S.DATEONLY, periodTo:S.DATEONLY,
      createdBy:S.INTEGER, // userId
      createdAt:S.DATE, updatedAt:S.DATE,
    });
    await q.createTable("PayrollLines", {
      id:{ type:S.INTEGER, autoIncrement:true, primaryKey:true },
      runId:{ type:S.STRING, allowNull:false, references:{ model:"PayrollRuns", key:"runId" }, onDelete:"CASCADE" },
      employeeId:{ type:S.INTEGER, allowNull:false, references:{ model:"Employees", key:"id" }, onDelete:"CASCADE" },
      base:{ type:S.DECIMAL(18,2), defaultValue:0 },
      allowances:{ type:S.DECIMAL(18,2), defaultValue:0 },
      overtime:{ type:S.DECIMAL(18,2), defaultValue:0 },
      deductions:{ type:S.DECIMAL(18,2), defaultValue:0 },
      advances:{ type:S.DECIMAL(18,2), defaultValue:0 },
      savings:{ type:S.DECIMAL(18,2), defaultValue:0 },
      loans:{ type:S.DECIMAL(18,2), defaultValue:0 },
      gross:{ type:S.DECIMAL(18,2), defaultValue:0 },
      net:{ type:S.DECIMAL(18,2), defaultValue:0 },
      payslipUrl:S.STRING,
      status:{ type:S.STRING, defaultValue:"finalized" },
      createdAt:S.DATE, updatedAt:S.DATE,
    });
  },
  down: async (q)=>{ await q.dropTable("PayrollLines"); await q.dropTable("PayrollRuns"); }
};
