"use strict";

const CATALOG = require("../permissions/catalog"); // adjust path if needed

module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const jsonEmpty = dialect === "postgres" ? `'[]'::jsonb` : `'[]'`;

    // flatten catalog
    const actions = [];
    for (const g of CATALOG) for (const a of g.actions) actions.push({ key: a.key, label: a.label });

    // insert missing (no 'id' column used)
    for (const a of actions) {
      await queryInterface.sequelize.query(
        `INSERT INTO permissions (action, description, roles, is_system, created_at, updated_at)
         SELECT :action, :desc, ${jsonEmpty}, TRUE, NOW(), NOW()
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE action = :action)`,
        { replacements: { action: a.key, desc: a.label } }
      ).catch(() => {});
    }

    // backfill empty descriptions
    if (actions.length) {
      const valuesSql = actions.map((_, i) => `($${i*2+1}, $${i*2+2})`).join(",");
      await queryInterface.sequelize.query(
        `UPDATE permissions p
         SET description = x.desc
         FROM (VALUES ${valuesSql}) AS x(action, desc)
         WHERE p.action = x.action AND (p.description IS NULL OR p.description = '')`,
        { bind: actions.flatMap(a => [a.key, a.label]) }
      ).catch(() => {});
    }
  },

  async down(queryInterface) {
    const actions = [];
    for (const g of CATALOG) for (const a of g.actions) actions.push(a.key);
    if (actions.length) {
      await queryInterface.bulkDelete("permissions", { action: actions }, {});
    }
  },
};
