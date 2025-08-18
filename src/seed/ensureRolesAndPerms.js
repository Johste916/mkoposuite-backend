// backend/src/seed/ensureRolesAndPerms.js
module.exports.ensureRolesAndPerms = async (db) => {
  const { Role, Permission, User, UserRole, sequelize } = db;

  const t = await sequelize.transaction();
  try {
    // 1) Ensure baseline roles
    const roleNames = ["admin", "manager", "teller"];
    const roleMap = {};
    for (const name of roleNames) {
      const [row] = await Role.findOrCreate({
        where: { name },
        defaults: { name, description: `${name} role`, isSystem: name === "admin" },
        transaction: t,
      });
      roleMap[name] = row;
    }

    // 2) Ensure baseline permissions (admin allowed by default)
    const PERMS = [
      { action: "manageSettings", roles: ["admin"], description: "Can manage Admin settings pages" },
      { action: "staff.read",     roles: ["admin"], description: "View staff list" },
      { action: "staff.create",   roles: ["admin"], description: "Create staff" },
      { action: "staff.update",   roles: ["admin"], description: "Update staff" },
    ];

    for (const p of PERMS) {
      // upsert by action
      const existing = await Permission.findOne({ where: { action: p.action }, transaction: t });
      if (existing) {
        existing.roles = Array.from(new Set([...(existing.roles || []), ...p.roles]));
        existing.description = existing.description || p.description || "";
        await existing.save({ transaction: t });
      } else {
        await Permission.create({ action: p.action, roles: p.roles, description: p.description || "" }, { transaction: t });
      }
    }

    // 3) Ensure the current admin user has the admin role
    // Prefer ADMIN_EMAIL from env; else first user.
    let adminUser = null;
    if (process.env.ADMIN_EMAIL) {
      adminUser = await User.findOne({ where: { email: process.env.ADMIN_EMAIL }, transaction: t });
    }
    if (!adminUser) {
      adminUser = await User.findOne({ order: [["id", "ASC"]], transaction: t });
    }
    if (adminUser && roleMap.admin) {
      const hasJoin = await UserRole.findOne({
        where: { userId: adminUser.id, roleId: roleMap.admin.id },
        transaction: t,
      });
      if (!hasJoin) {
        await UserRole.create({ userId: adminUser.id, roleId: roleMap.admin.id }, { transaction: t });
      }
    }

    await t.commit();
    console.log("✅ ensureRolesAndPerms: roles, permissions, and admin assignment ready");
  } catch (e) {
    await t.rollback();
    console.error("❌ ensureRolesAndPerms failed:", e);
    throw e;
  }
};
