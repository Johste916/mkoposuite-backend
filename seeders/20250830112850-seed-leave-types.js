// seeders/*-seed-leave-types.js
"use strict";
module.exports = {
  up: async (q)=> q.bulkInsert("LeaveTypes", [
    { name:"Annual", days:21, paid:true, createdAt:new Date(), updatedAt:new Date() },
    { name:"Sick", days:7, paid:true, createdAt:new Date(), updatedAt:new Date() },
    { name:"Unpaid", days:0, paid:false, createdAt:new Date(), updatedAt:new Date() },
  ]),
  down: async (q)=> q.bulkDelete("LeaveTypes", null, {})
};
