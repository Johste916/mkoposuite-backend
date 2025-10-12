"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const t = "audit_logs";
    const qi = queryInterface;

    // Add columns if not present (Postgres)
    await qi.sequelize.transaction(async (trx) => {
      const table = await qi.describeTable(t);

      if (!table.entity)    await qi.addColumn(t, "entity",   { type: Sequelize.STRING(64), allowNull: true }, { transaction: trx });
      if (!table.entity_id) await qi.addColumn(t, "entity_id",{ type: Sequelize.STRING(64), allowNull: true }, { transaction: trx });
      if (!table.before)    await qi.addColumn(t, "before",   { type: Sequelize.TEXT,       allowNull: true }, { transaction: trx });
      if (!table.after)     await qi.addColumn(t, "after",    { type: Sequelize.TEXT,       allowNull: true }, { transaction: trx });
      if (!table.meta)      await qi.addColumn(t, "meta",     { type: Sequelize.TEXT,       allowNull: true }, { transaction: trx });
    });
  },

  async down(queryInterface) {
    const t = "audit_logs";
    const qi = queryInterface;
    await qi.removeColumn(t, "entity").catch(()=>{});
    await qi.removeColumn(t, "entity_id").catch(()=>{});
    await qi.removeColumn(t, "before").catch(()=>{});
    await qi.removeColumn(t, "after").catch(()=>{});
    await qi.removeColumn(t, "meta").catch(()=>{});
  }
};
