'use strict';

module.exports = {
  async up(qi, Sequelize) {
    await qi.addColumn('Borrowers', 'blacklistReason', { type: Sequelize.TEXT, allowNull: true });
    await qi.addColumn('Borrowers', 'blacklistUntil',  { type: Sequelize.DATEONLY, allowNull: true });
    await qi.addColumn('Borrowers', 'blacklistedAt',   { type: Sequelize.DATE, allowNull: true });
    // optional index to find expiring blacklists fast:
    await qi.addIndex('Borrowers', ['status', 'blacklistUntil']);
  },

  async down(qi) {
    await qi.removeIndex('Borrowers', ['status', 'blacklistUntil']).catch(() => {});
    await qi.removeColumn('Borrowers', 'blacklistedAt');
    await qi.removeColumn('Borrowers', 'blacklistUntil');
    await qi.removeColumn('Borrowers', 'blacklistReason');
  }
};
