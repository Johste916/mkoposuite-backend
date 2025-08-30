"use strict";
module.exports = {
  up: async (q, S) => {
    await q.createTable("Contracts", {
      id:{ type:S.INTEGER, autoIncrement:true, primaryKey:true },
      employeeId:{ type:S.INTEGER, allowNull:false, references:{ model:"Employees", key:"id" }, onDelete:"CASCADE" },
      title:S.STRING,
      startDate:S.DATEONLY,
      endDate:S.DATEONLY,
      fileUrl:S.STRING,
      status:{ type:S.STRING, defaultValue:"active" }, // active | expired | terminated
      createdAt:S.DATE, updatedAt:S.DATE,
    });
  },
  down: async (q)=>{ await q.dropTable("Contracts"); }
};
