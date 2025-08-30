"use strict";
module.exports = {
  up: async (q, S) => {
    await q.createTable("LeaveTypes", {
      id:{ type:S.INTEGER, autoIncrement:true, primaryKey:true },
      name:S.STRING, days:{ type:S.INTEGER, defaultValue:0 }, paid:{ type:S.BOOLEAN, defaultValue:true },
      createdAt:S.DATE, updatedAt:S.DATE,
    });
  },
  down: async (q)=>{ await q.dropTable("LeaveTypes"); }
};
