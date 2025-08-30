"use strict";
module.exports = {
  up: async (q, S) => {
    await q.createTable("Attendance", {
      id:{ type:S.INTEGER, autoIncrement:true, primaryKey:true },
      date:{ type:S.DATEONLY, allowNull:false },
      employeeId:{ type:S.INTEGER, allowNull:false, references:{ model:"Employees", key:"id" }, onDelete:"CASCADE" },
      status:{ type:S.STRING, defaultValue:"present" }, // present | absent | leave | sick | holiday
      timeIn:S.STRING, timeOut:S.STRING,
      createdAt:S.DATE, updatedAt:S.DATE,
    });
  },
  down: async (q)=>{ await q.dropTable("Attendance"); }
};
