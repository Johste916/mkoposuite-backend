// backend/src/seed/setupRolesAndPerms.js
const { Role, Permission } = require('../models');

async function ensureRolesAndPerms() {
  const baseRoles = ['admin', 'manager', 'user'];

  for (const name of baseRoles) {
    const [role] = await Role.findOrCreate({
      where: { name },
      defaults: { name, isSystem: true, description: `${name} role` },
    });
  }

  // Example permissions you can tweak in UI later
  const perms = [
    { action: 'manageSettings', roles: ['admin'] },
    { action: 'viewStaff', roles: ['admin', 'manager'] },
    { action: 'manageStaff', roles: ['admin'] },
  ];

  for (const p of perms) {
    const row = await Permission.findOne({ where: { action: p.action } });
    if (!row) {
      await Permission.create(p);
    }
  }
}

module.exports = { ensureRolesAndPerms };
