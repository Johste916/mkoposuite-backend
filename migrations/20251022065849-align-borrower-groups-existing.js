/* eslint-disable no-unused-vars */
"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = (q, replacements) =>
      queryInterface.sequelize.query(q, { replacements });

    async function tableExists(t) {
      const [rows] = await sql(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name=:t`,
        { t }
      );
      return rows.length > 0;
    }
    async function colExists(t, c) {
      const [rows] = await sql(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=:t AND column_name=:c`,
        { t, c }
      );
      return rows.length > 0;
    }

    // ---------- BorrowerGroups ----------
    const groupsTable = "BorrowerGroups";
    const groupsExists = await tableExists(groupsTable);

    if (!groupsExists) {
      // Create the table to match the DB you observed (BIGINT ids, TEXT enums)
      await queryInterface.createTable(groupsTable, {
        id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
        name: { type: Sequelize.STRING(160), allowNull: false },
        branchId: { type: Sequelize.BIGINT, allowNull: true },
        officerId: { type: Sequelize.BIGINT, allowNull: true },
        meetingDay: { type: Sequelize.TEXT, allowNull: true }, // TEXT (not ENUM) to match current DB
        notes: { type: Sequelize.TEXT, allowNull: true },
        status: { type: Sequelize.TEXT, allowNull: false, defaultValue: "active" },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
        deletedAt: { type: Sequelize.DATE, allowNull: true },
      });

      await queryInterface.addIndex(groupsTable, ["branchId"]);
      await queryInterface.addIndex(groupsTable, ["officerId"]);
      await queryInterface.addIndex(groupsTable, ["status"]);
      await queryInterface.addIndex(groupsTable, ["name"]);
    } else {
      // Patch what might be missing / misnamed
      // 1) rename loanOfficerId -> officerId if needed
      const hasLoanOfficerId = await colExists(groupsTable, "loanOfficerId");
      const hasOfficerId = await colExists(groupsTable, "officerId");
      if (hasLoanOfficerId && !hasOfficerId) {
        await queryInterface.renameColumn(groupsTable, "loanOfficerId", "officerId");
      }

      // 2) ensure officerId exists
      if (!(await colExists(groupsTable, "officerId"))) {
        await queryInterface.addColumn(groupsTable, "officerId", { type: Sequelize.BIGINT, allowNull: true });
      }
      // 3) ensure branchId exists
      if (!(await colExists(groupsTable, "branchId"))) {
        await queryInterface.addColumn(groupsTable, "branchId", { type: Sequelize.BIGINT, allowNull: true });
      }
      // 4) ensure meetingDay/status as TEXT (skip changing type if they are already TEXT/ENUM; keep data)
      //    If they were ENUM previously, leave them — Sequelize can read them as strings.
      if (!(await colExists(groupsTable, "meetingDay"))) {
        await queryInterface.addColumn(groupsTable, "meetingDay", { type: Sequelize.TEXT, allowNull: true });
      }
      if (!(await colExists(groupsTable, "status"))) {
        await queryInterface.addColumn(groupsTable, "status", { type: Sequelize.TEXT, allowNull: false, defaultValue: "active" });
      }
      // 5) ensure timestamps exist
      if (!(await colExists(groupsTable, "createdAt"))) {
        await queryInterface.addColumn(groupsTable, "createdAt", { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") });
      }
      if (!(await colExists(groupsTable, "updatedAt"))) {
        await queryInterface.addColumn(groupsTable, "updatedAt", { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") });
      }
      if (!(await colExists(groupsTable, "deletedAt"))) {
        await queryInterface.addColumn(groupsTable, "deletedAt", { type: Sequelize.DATE, allowNull: true });
      }

      // 6) indexes (best-effort; ignore duplicates)
      for (const cols of [["branchId"], ["officerId"], ["status"], ["name"]]) {
        try { await queryInterface.addIndex(groupsTable, cols); } catch {}
      }
    }

    // ---------- BorrowerGroupMembers ----------
    const membersTable = "BorrowerGroupMembers";
    const membersExists = await tableExists(membersTable);

    if (!membersExists) {
      // Create with composite PK (groupId, borrowerId), no synthetic id — safest for joins
      await queryInterface.createTable(membersTable, {
        groupId: { type: Sequelize.BIGINT, allowNull: false },
        borrowerId: { type: Sequelize.BIGINT, allowNull: false },
        role: { type: Sequelize.TEXT, allowNull: false, defaultValue: "member" },
        joinedAt: { type: Sequelize.DATE, allowNull: true },
        leftAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
        deletedAt: { type: Sequelize.DATE, allowNull: true },
      });

      await queryInterface.addConstraint(membersTable, {
        fields: ["groupId", "borrowerId"],
        type: "primary key",
        name: "pk_bgm_grp_brr",
      });

      await queryInterface.addIndex(membersTable, ["groupId"]);
      await queryInterface.addIndex(membersTable, ["borrowerId"]);
      await queryInterface.addConstraint(membersTable, {
        fields: ["groupId", "borrowerId"],
        type: "unique",
        name: "uq_bgm_once",
      });
    } else {
      // Fix snake_case cols if present
      const hasGroup_id = await colExists(membersTable, "group_id");
      const hasGroupId = await colExists(membersTable, "groupId");
      if (hasGroup_id && !hasGroupId) {
        await queryInterface.renameColumn(membersTable, "group_id", "groupId");
      }
      const hasBorrower_id = await colExists(membersTable, "borrower_id");
      const hasBorrowerId = await colExists(membersTable, "borrowerId");
      if (hasBorrower_id && !hasBorrowerId) {
        await queryInterface.renameColumn(membersTable, "borrower_id", "borrowerId");
      }

      // Ensure the key columns exist (BIGINT to match groups/borrowers)
      if (!(await colExists(membersTable, "groupId"))) {
        await queryInterface.addColumn(membersTable, "groupId", { type: Sequelize.BIGINT, allowNull: false });
      }
      if (!(await colExists(membersTable, "borrowerId"))) {
        await queryInterface.addColumn(membersTable, "borrowerId", { type: Sequelize.BIGINT, allowNull: false });
      }

      // Ensure uniqueness (best-effort)
      try {
        await queryInterface.addConstraint(membersTable, {
          fields: ["groupId", "borrowerId"],
          type: "unique",
          name: "uq_bgm_once",
        });
      } catch {}
      for (const cols of [["groupId"], ["borrowerId"]]) {
        try { await queryInterface.addIndex(membersTable, cols); } catch {}
      }
    }
  },

  async down(queryInterface, Sequelize) {
    // Non-destructive down (leave aligned schema in place).
    // If you need to revert, add specific drops here, but by default we no-op.
  },
};
