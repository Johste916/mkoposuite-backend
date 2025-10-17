'use strict';

/**
 * Role model
 * - Adds a unique `code` used by auth middleware and RBAC checks.
 * - Auto-derives `code` from `name` if not provided (slug: lowercase, a–z0–9 and underscores).
 *
 * NOTE: Ensure the DB has the column:
 *   ALTER TABLE "public"."Roles" ADD COLUMN "code" VARCHAR(64);
 *   -- backfill values (example):
 *   UPDATE "public"."Roles" SET "code" = LOWER(REGEXP_REPLACE("name", '\\s+', '_', 'g')) WHERE "code" IS NULL;
 *   -- then enforce uniqueness + NOT NULL
 *   CREATE UNIQUE INDEX roles_code_unique ON "public"."Roles" ("code");
 *   ALTER TABLE "public"."Roles" ALTER COLUMN "code" SET NOT NULL;
 */

module.exports = (sequelize, DataTypes) => {
  // lightweight slug/normalize for code
  const toCode = (value) => {
    if (!value) return value;
    return String(value)
      .trim()
      .toLowerCase()
      // replace whitespace and dashes with underscores
      .replace(/[\s-]+/g, '_')
      // drop any char that's not a-z, 0-9 or underscore
      .replace(/[^a-z0-9_]/g, '')
      // collapse multiple underscores
      .replace(/_+/g, '_')
      // trim leading/trailing underscores
      .replace(/^_+|_+$/g, '')
      // ensure not empty
      || null;
  };

  const Role = sequelize.define(
    'Role',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },

      // ✅ New: machine-friendly unique role code (e.g., "admin", "loan_officer")
      code: {
        type: DataTypes.STRING(64),
        allowNull: false, // after backfill/migration
        unique: true,
        // If you already use a different physical column name, map with `field: 'role_code'`
        // field: 'code',
        set(val) {
          const normalized = toCode(val);
          // if no explicit code provided, try to derive from current name
          if (!normalized) {
            const name = this.getDataValue('name');
            const fallback = toCode(name);
            this.setDataValue('code', fallback);
          } else {
            this.setDataValue('code', normalized);
          }
        },
      },

      name: {
        type: DataTypes.STRING(80),
        allowNull: false,
        unique: true,
        set(val) {
          // keep name tidy and also refresh code if code is empty
          const clean = (val ?? '').toString().trim();
          this.setDataValue('name', clean);
          if (!this.getDataValue('code')) {
            const derived = toCode(clean);
            this.setDataValue('code', derived);
          }
        },
      },

      description: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: '',
      },

      isSystem: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: 'Roles',
      // Use global timestamps from your Sequelize config; keeping explicit is fine too:
      timestamps: true,
      indexes: [
        { unique: true, fields: ['name'] },
        { unique: true, fields: ['code'], name: 'roles_code_unique' },
      ],
      hooks: {
        // Normalize both name and code before validation/insert/update
        beforeValidate(role) {
          // ensure name trimmed
          if (role.name) role.name = role.name.toString().trim();

          // if code missing, derive from name
          if (!role.code && role.name) {
            role.code = toCode(role.name);
          }

          // final guard: never allow empty string for code
          if (role.code === '') role.code = null;
        },
      },
    }
  );

  Role.associate = (models) => {
    // M:N to Permissions if present
    if (models.Permission && models.RolePermission) {
      Role.belongsToMany(models.Permission, {
        through: models.RolePermission,
        foreignKey: 'roleId',
        otherKey: 'permissionId',
        as: 'Permissions',
      });
    }

    // M:N to Users if present (keeps eager-loads tidy)
    if (models.User) {
      Role.belongsToMany(models.User, {
        through: models.UserRole || 'UserRoles',
        foreignKey: 'roleId',
        otherKey: 'userId',
        as: 'Users',
      });
    }
  };

  // Convenience helpers (optional)
  Role.findByCode = async function (code, options = {}) {
    return Role.findOne({ where: { code: toCode(code) }, ...options });
  };

  Role.prototype.toSafeJSON = function () {
    const { id, code, name, description, isSystem, createdAt, updatedAt } = this.get({ plain: true });
    return { id, code, name, description, isSystem, createdAt, updatedAt };
  };

  return Role;
};
