'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const desc = await queryInterface.describeTable('loans');

    if (desc.closeReason) {
      // already correct – do nothing
      return;
    }

    if (desc.close_reason) {
      // rename snake_case -> camelCase
      await queryInterface.renameColumn('loans', 'close_reason', 'closeReason');
      return;
    }

    // neither exists -> add the correct camelCase column
    await queryInterface.addColumn('loans', 'closeReason', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    const desc = await queryInterface.describeTable('loans');

    // only revert if we added the column (don't break a working DB)
    if (desc.closeReason && !desc.close_reason) {
      await queryInterface.removeColumn('loans', 'closeReason');
    }
  },
};
