// e.g., 20240926-alter-loans-add-workflow-dates.js
'use strict';
module.exports = {
  async up(q, Sequelize) {
    const desc = await q.describeTable('loans');

    const addIfMissing = async (name, def) => {
      if (!desc[name]) await q.addColumn('loans', name, def);
    };

    await addIfMissing('approvalDate',     { type: Sequelize.DATE, allowNull: true });
    await addIfMissing('disbursementDate', { type: Sequelize.DATE, allowNull: true });
    await addIfMissing('closedDate',       { type: Sequelize.DATE, allowNull: true });
    await addIfMissing('closeReason',      { type: Sequelize.STRING, allowNull: true });
  },
  async down(q) {
    const desc = await q.describeTable('loans');
    const dropIfExists = async (name) => { if (desc[name]) await q.removeColumn('loans', name); };
    await dropIfExists('approvalDate');
    await dropIfExists('disbursementDate');
    await dropIfExists('closedDate');
    await dropIfExists('closeReason');
  }
};
