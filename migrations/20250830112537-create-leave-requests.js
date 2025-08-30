"use strict";
module.exports = {
  up: async (q, S) => {
    await q.createTable("LeaveRequests", {
      id:{ type:S.INTEGER, autoIncrement:true, primaryKey:true },
      employeeId:{ type:S.INTEGER, allowNull:false, references:{ model:"Employees", key:"id" }, onDelete:"CASCADE" },
      typeId:{ type:S.INTEGER, allowNull:false, references:{ model:"LeaveTypes", key:"id" } },
      from:{ type:S.DATEONLY, allowNull:false },
      to:{ type:S.DATEONLY, allowNull:false },
      paid:{ type:S.BOOLEAN, defaultValue:true },
      reason:S.TEXT,
      status:{ type:S.STRING, defaultValue:"pending" }, // pending | approved | rejected
      createdAt:S.DATE, updatedAt:S.DATE,
    });
  },
  down: async (q)=>{ await q.dropTable("LeaveRequests"); }
};
