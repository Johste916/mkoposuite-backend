/* eslint-disable no-unused-vars */
"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = (q, replacements) =>
      queryInterface.sequelize.query(q, { replacements });

    const tableExists = async (t) => {
      const [rows] = await sql(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name=:t`,
        { t }
      );
      return rows.length > 0;
    };

    const getCol = async (t, c) => {
      const [rows] = await sql(
        `SELECT data_type, udt_name
         FROM information_schema.columns
         WHERE table_schema='public' AND table_name=:t AND column_name=:c`,
        { t, c }
      );
      return rows[0] || null;
    };

    const colExists = async (t, c) => !!(await getCol(t, c));

    const alterTypeIf = async (table, column, wantTypeSQL, usingSQL) => {
      // Try changing type only if different (best-effort)
      try {
        await sql(
          `ALTER TABLE "public"."${table}"
             ALTER COLUMN "${column}" TYPE ${wantTypeSQL}
             USING ${usingSQL}`
        );
      } catch (e) {
        // ignore if already compatible or cannot be changed safely
      }
    };

    // ---------------- BorrowerGroups ----------------
    const groups = "BorrowerGroups";
    if (!(await tableExists(groups))) {
      // Create exactly like the live DB you showed
      await queryInterface.createTable(groups, {
        id: { type: Sequelize.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true },
        name: { type: Sequelize.STRING(160), allowNull: false },
        branchId: { type: Sequelize.INTEGER, allowNull: true },
        officerId: { type: Sequelize.UUID, allowNull: true },
        meetingDay: { type: Sequelize.TEXT, allowNull: true }, // keep TEXT to avoid enum name coupling
        notes: { type: Sequelize.TEXT, allowNull: true },
        status: { type: Sequelize.TEXT, allowNull: false, defaultValue: "active" },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
        deletedAt: { type: Sequelize.DATE, allowNull: true },
      });

      await queryInterface.addIndex(groups, ["name"]);
      await queryInterface.addIndex(groups, ["branchId"]);
      await queryInterface.addIndex(groups, ["officerId"]);
      await queryInterface.addIndex(groups, ["status"]);
    } else {
      // Ensure required columns exist
      if (!(await colExists(groups, "name"))) {
        await queryInterface.addColumn(groups, "name", { type: Sequelize.STRING(160), allowNull: false });
      }
      if (!(await colExists(groups, "branchId"))) {
        await queryInterface.addColumn(groups, "branchId", { type: Sequelize.INTEGER, allowNull: true });
      }
      if (!(await colExists(groups, "officerId"))) {
        await queryInterface.addColumn(groups, "officerId", { type: Sequelize.UUID, allowNull: true });
      }
      if (!(await colExists(groups, "meetingDay"))) {
        await queryInterface.addColumn(groups, "meetingDay", { type: Sequelize.TEXT, allowNull: true });
      }
      if (!(await colExists(groups, "notes"))) {
        await queryInterface.addColumn(groups, "notes", { type: Sequelize.TEXT, allowNull: true });
      }
      if (!(await colExists(groups, "status"))) {
        await queryInterface.addColumn(groups, "status", { type: Sequelize.TEXT, allowNull: false, defaultValue: "active" });
      }
      if (!(await colExists(groups, "createdAt"))) {
        await queryInterface.addColumn(groups, "createdAt", { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") });
      }
      if (!(await colExists(groups, "updatedAt"))) {
        await queryInterface.addColumn(groups, "updatedAt", { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") });
      }
      if (!(await colExists(groups, "deletedAt"))) {
        await queryInterface.addColumn(groups, "deletedAt", { type: Sequelize.DATE, allowNull: true });
      }

      // Type alignments (best-effort)
      const idC = await getCol(groups, "id");
      if (idC && idC.data_type !== "integer") {
        // Convert to integer if your data is convertible; otherwise skip.
        await alterTypeIf(groups, "id", "INTEGER", `CASE WHEN "${groups}"."id" ~ '^[0-9]+$' THEN ("id"::integer) ELSE NULL END`);
        try {
          await sql(`ALTER SEQUENCE IF EXISTS "BorrowerGroups_id_seq" OWNED BY "BorrowerGroups"."id";`);
        } catch {}
      }
      const brC = await getCol(groups, "branchId");
      if (brC && brC.data_type !== "integer") {
        await alterTypeIf(groups, "branchId", "INTEGER", `"branchId"::integer`);
      }
      const offC = await getCol(groups, "officerId");
      if (offC && offC.udt_name !== "uuid") {
        await alterTypeIf(groups, "officerId", "UUID", `"officerId"::uuid`);
      }

      // Helpful indexes (ignore if dup)
      for (const cols of [["name"], ["branchId"], ["officerId"], ["status"]]) {
        try { await queryInterface.addIndex(groups, cols); } catch {}
      }
    }

    // ---------------- BorrowerGroupMembers ----------------
    const members = "BorrowerGroupMembers";
    if (!(await tableExists(members))) {
      await queryInterface.createTable(members, {
        groupId: { type: Sequelize.INTEGER, allowNull: false, primaryKey: true },
        borrowerId: { type: Sequelize.INTEGER, allowNull: false, primaryKey: true },
        role: { type: Sequelize.TEXT, allowNull: false, defaultValue: "member" },
        joinedAt: { type: Sequelize.DATE, allowNull: true },
        leftAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
        deletedAt: { type: Sequelize.DATE, allowNull: true },
      });
      await queryInterface.addIndex(members, ["groupId"]);
      await queryInterface.addIndex(members, ["borrowerId"]);
      try {
        await queryInterface.addConstraint(members, {
          fields: ["groupId", "borrowerId"],
          type: "unique",
          name: "uq_bgm_once",
        });
      } catch {}
    } else {
      // normalize camelCase
      const [hasGroup_id] = await sql(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=:t AND column_name='group_id'`,
        { t: members }
      );
      if (hasGroup_id?.length) {
        await queryInterface.renameColumn(members, "group_id", "groupId");
      }
      const [hasBorrower_id] = await sql(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=:t AND column_name='borrower_id'`,
        { t: members }
      );
      if (hasBorrower_id?.length) {
        await queryInterface.renameColumn(members, "borrower_id", "borrowerId");
      }

      // ensure columns & types
      if (!(await colExists(members, "groupId"))) {
        await queryInterface.addColumn(members, "groupId", { type: Sequelize.INTEGER, allowNull: false });
      } else {
        const gC = await getCol(members, "groupId");
        if (gC.data_type !== "integer") {
          await alterTypeIf(members, "groupId", "INTEGER", `"groupId"::integer`);
        }
      }
      if (!(await colExists(members, "borrowerId"))) {
        await queryInterface.addColumn(members, "borrowerId", { type: Sequelize.INTEGER, allowNull: false });
      }

      // uniqueness (ignore if exists)
      try {
        await queryInterface.addConstraint(members, {
          fields: ["groupId", "borrowerId"],
          type: "unique",
          name: "uq_bgm_once",
        });
      } catch {}
      for (const cols of [["groupId"], ["borrowerId"]]) {
        try { await queryInterface.addIndex(members, cols); } catch {}
      }
    }
  },

  async down() {
    // No-op: alignment migration is intentionally non-destructive.
  },
};
