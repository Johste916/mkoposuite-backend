/* eslint-disable no-unused-vars */
"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, STRING, TEXT, DATE, ENUM, INTEGER, BIGINT } = Sequelize;

    const sql = (q, replacements) =>
      queryInterface.sequelize.query(q, { replacements });

    // Find the *actual* table name (handles "Borrowers" vs "borrowers")
    async function resolveTableName(base) {
      const [rows] = await sql(
        `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND lower(table_name) = lower(:base)
        LIMIT 1
      `,
        { base }
      );
      return rows?.[0]?.table_name || null;
    }

    // Detect id column type for a given table
    async function detectPkType(actualTable) {
      if (!actualTable) return null;
      const [rows] = await sql(
        `
        SELECT data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = :t AND column_name = 'id'
        LIMIT 1
      `,
        { t: actualTable }
      );
      if (!rows || !rows[0]) return null;
      const { data_type, udt_name } = rows[0];
      const dt = String(data_type).toLowerCase();
      const udt = String(udt_name).toLowerCase();
      if (dt === "uuid") return "uuid";
      if (udt === "int8" || dt === "bigint") return "bigint";
      if (udt === "int4" || dt === "integer" || udt === "int2") return "int";
      return null;
    }

    function columnForPk(kind, { primary = false, allowNull = false } = {}) {
      if (kind === "uuid") {
        return {
          type: UUID,
          primaryKey: !!primary,
          allowNull: allowNull === false ? false : true,
          defaultValue: Sequelize.literal("gen_random_uuid()"),
        };
      }
      if (kind === "bigint") {
        return {
          type: BIGINT,
          primaryKey: !!primary,
          allowNull: allowNull === false ? false : true,
          autoIncrement: true,
        };
      }
      return {
        type: INTEGER,
        primaryKey: !!primary,
        allowNull: allowNull === false ? false : true,
        autoIncrement: true,
      };
    }

    function columnForFk(kind, { allowNull = true } = {}) {
      if (kind === "uuid") return { type: UUID, allowNull };
      if (kind === "bigint") return { type: BIGINT, allowNull };
      return { type: INTEGER, allowNull };
    }

    // Resolve actual table names (case-agnostic)
    const borrowersTable = await resolveTableName("Borrowers");
    const branchesTable  = await resolveTableName("Branches");
    const usersTable     = await resolveTableName("Users");

    // Detect PK kinds
    const borrowerIdKind = (await detectPkType(borrowersTable)) || "uuid";
    const branchIdKind   = (await detectPkType(branchesTable))  || "uuid";
    const userIdKind     = (await detectPkType(usersTable))     || "uuid";

    // Ensure pgcrypto if any UUID is in play
    if ([borrowerIdKind, branchIdKind, userIdKind].includes("uuid")) {
      try {
        await sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
      } catch {}
    }

    // --- BorrowerGroups (we keep UUID PK for groups) ------------------------
    const groupIdCol   = columnForPk("uuid", { primary: true, allowNull: false });
    const branchFkCol  = columnForFk(branchIdKind, { allowNull: true });
    const officerFkCol = columnForFk(userIdKind,   { allowNull: true });

    await queryInterface.createTable("BorrowerGroups", {
      id: groupIdCol,

      name: { type: STRING(160), allowNull: false },

      branchId: { ...branchFkCol },
      officerId: { ...officerFkCol },

      meetingDay: {
        type: ENUM(
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday"
        ),
        allowNull: true,
      },
      notes: { type: TEXT, allowNull: true },
      status: {
        type: ENUM("active", "inactive"),
        allowNull: false,
        defaultValue: "active",
      },

      createdAt: { type: DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
      updatedAt: { type: DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
      deletedAt: { type: DATE, allowNull: true },
    });

    await queryInterface.addIndex("BorrowerGroups", ["name"]);
    await queryInterface.addIndex("BorrowerGroups", ["branchId"]);
    await queryInterface.addIndex("BorrowerGroups", ["officerId"]);
    await queryInterface.addIndex("BorrowerGroups", ["status"]);

    // --- BorrowerGroupMembers (UUID PK for rows, FKs match parents) ---------
    const memberIdCol   = columnForPk("uuid", { primary: true, allowNull: false });
    const groupFkCol    = columnForFk("uuid", { allowNull: false });
    const borrowerFkCol = columnForFk(borrowerIdKind, { allowNull: false });

    await queryInterface.createTable("BorrowerGroupMembers", {
      id: memberIdCol,

      groupId: {
        ...groupFkCol,
        references: { model: "BorrowerGroups", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      borrowerId: {
        ...borrowerFkCol,
        // Reference the resolved existing table (Borrowers/borrowers)
        references: { model: { tableName: borrowersTable || "Borrowers", schema: "public" }, key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      role: {
        type: ENUM("member", "chair", "secretary", "treasurer"),
        allowNull: false,
        defaultValue: "member",
      },
      joinedAt: { type: DATE, allowNull: true },
      leftAt:   { type: DATE, allowNull: true },

      createdAt: { type: DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
      updatedAt: { type: DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
      deletedAt: { type: DATE, allowNull: true },
    });

    await queryInterface.addIndex("BorrowerGroupMembers", ["groupId"]);
    await queryInterface.addIndex("BorrowerGroupMembers", ["borrowerId"]);
    await queryInterface.addConstraint("BorrowerGroupMembers", {
      fields: ["groupId", "borrowerId"],
      type: "unique",
      name: "uq_group_member_once",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("BorrowerGroupMembers");
    await queryInterface.dropTable("BorrowerGroups");
    // Optionally drop enums if your setup needs it:
    // await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_BorrowerGroups_meetingDay";`);
    // await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_BorrowerGroups_status";`);
    // await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_BorrowerGroupMembers_role";`);
  },
};
