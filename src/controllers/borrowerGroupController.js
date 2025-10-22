"use strict";

/**
 * Controller under /api/borrowers/groups
 * Shapes are aligned to your UI normalizers.
 */
module.exports = ({ models }) => {
  const {
    BorrowerGroup,
    BorrowerGroupMember,
    Borrower,
    Branch,
    User,
    sequelize,
    Sequelize,
  } = models;

  const allowedDays = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  const allowedStatus = ["active","inactive"];
  const clean = (v) => (v === "" ? null : v);
  const toIntOrNull = (v) => (v === "" || v == null ? null : Number(v));
  const coalesceOfficerId = (body) =>
    body?.officerId ?? body?.loanOfficerId ?? body?.loan_officer_id ?? null;

  // ---------- helpers ----------
  // defensively compute outstanding per borrower from a Loans table if present
  async function computeOutstandingForBorrowers(borrowerIds, t) {
    const result = { perBorrower: {}, total: 0 };

    if (!borrowerIds?.length) return result;

    // find a model that looks like "Loans"
    const Loan =
      models.Loans ||
      models.Loan ||
      models.LoanApplication ||
      models.LoanApplications ||
      null;

    if (!Loan) return result;

    // We’ll try raw SQL to support multiple column names.
    // SUM(COALESCE(outstanding, balance, remaining, amount_due, "amountRemaining", 0))
    // and treat status not in ('closed','repaid') as active if column exists.
    const qi = sequelize.getQueryInterface();
    const table = Loan.getTableName(); // works for model
    const tableName =
      typeof table === "object" ? `"${table.schema || "public"}"."${table.tableName}"` : `"${table}"`;

    const idList = borrowerIds.map((id) => Number(id)).filter((n) => Number.isFinite(n));
    if (idList.length === 0) return result;

    const sql = `
      SELECT
        "borrowerId",
        SUM(
          COALESCE(
            try_outstanding,
            try_balance,
            try_remaining,
            try_amount_due,
            try_amountRemaining,
            0
          )
        ) AS outstanding
      FROM (
        SELECT
          "borrowerId",
          -- Try common column names; missing columns come back as NULL
          NULLIF((CASE WHEN true THEN "outstanding" END), NULL) AS try_outstanding,
          NULLIF((CASE WHEN true THEN "balance" END), NULL)     AS try_balance,
          NULLIF((CASE WHEN true THEN "remaining" END), NULL)   AS try_remaining,
          NULLIF((CASE WHEN true THEN "amount_due" END), NULL)  AS try_amount_due,
          NULLIF((CASE WHEN true THEN "amountRemaining" END), NULL) AS try_amountRemaining
        FROM ${tableName}
        WHERE "borrowerId" IN (:ids)
          AND (
            -- If status column exists, exclude closed/repaid; otherwise ignore
            (CASE
              WHEN EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema='public'
                             AND table_name=split_part(${sequelize.escape(tableName)},'.',2)::text
                             AND column_name='status')
              THEN (COALESCE(LOWER(status), '') NOT IN ('closed','repaid'))
              ELSE TRUE
            END)
          )
      ) AS t
      GROUP BY "borrowerId"
    `;

    try {
      const [rows] = await sequelize.query(sql, {
        replacements: { ids: idList },
        transaction: t,
      });
      for (const r of rows) {
        const o = Number(r.outstanding || 0);
        result.perBorrower[String(r.borrowerId)] = o;
        result.total += o;
      }
    } catch {
      // If any error (e.g., table/columns don’t exist), return empty summary
      return result;
    }
    return result;
  }

  // ---------- list ----------
  const list = async (req, res) => {
    try {
      const groups = await BorrowerGroup.findAll({
        paranoid: false,
        include: [
          {
            model: BorrowerGroupMember,
            as: "groupMembers",
            attributes: ["groupId", "borrowerId"],
            paranoid: false,
          },
          Branch ? { model: Branch, as: "branch", attributes: ["id", "name"], paranoid: false } : null,
        ].filter(Boolean),
        order: [["createdAt", "DESC"]],
      });

      const rows = groups.map((g) => ({
        id: g.id,
        name: g.name,
        branchName: g.branch?.name || null,
        membersCount: Array.isArray(g.groupMembers) ? g.groupMembers.length : 0,
        loanCount: 0,
        outstanding: 0,
      }));

      res.json({ items: rows, total: rows.length });
    } catch (e) {
      console.error("Groups list error:", e);
      res.status(500).json({ error: "Failed to load groups" });
    }
  };

  // ---------- create ----------
  const create = async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const payload = {
        name: (req.body?.name || "").trim(),
        branchId: toIntOrNull(req.body?.branchId),
        officerId: coalesceOfficerId(req.body),
        meetingDay: req.body?.meetingDay === "" ? null : req.body?.meetingDay,
        notes: req.body?.notes === "" ? null : req.body?.notes,
        status: (req.body?.status || "active") || "active",
      };

      if (!payload.name) {
        await t.rollback();
        return res.status(400).json({ error: "name is required" });
      }

      if (payload.meetingDay) {
        payload.meetingDay = String(payload.meetingDay).toLowerCase();
        if (!allowedDays.includes(payload.meetingDay)) {
          await t.rollback();
          return res.status(400).json({ error: "meetingDay must be monday…sunday" });
        }
      }

      if (payload.status) {
        payload.status = String(payload.status).toLowerCase();
        if (!allowedStatus.includes(payload.status)) {
          await t.rollback();
          return res.status(400).json({ error: "status must be active|inactive" });
        }
      }

      if (payload.branchId != null && models.Branch) {
        const branch = await models.Branch.findByPk(payload.branchId, { transaction: t, paranoid: false });
        if (!branch) {
          await t.rollback();
          return res.status(400).json({ error: `Invalid branchId: ${payload.branchId} (branch not found)` });
        }
      }

      if (payload.officerId != null && models.User) {
        const officer = await models.User.findByPk(payload.officerId, { transaction: t, paranoid: false });
        if (!officer) {
          await t.rollback();
          return res.status(400).json({ error: `Invalid officerId: ${payload.officerId} (user not found)` });
        }
      }

      const g = await models.BorrowerGroup.create(payload, { transaction: t });
      await t.commit();
      return res.status(201).json({ id: g.id, name: g.name });
    } catch (e) {
      await t.rollback();
      if (e?.name === "SequelizeForeignKeyConstraintError") {
        const isBranch = String(e?.index || e?.constraint || "").toLowerCase().includes("branch");
        const isOfficer = String(e?.index || e?.constraint || "").toLowerCase().includes("officer");
        const which = isBranch ? "branchId" : isOfficer ? "officerId" : "foreign key";
        return res.status(400).json({ error: `Invalid ${which} (referenced row does not exist)` });
      }
      console.error("Create group error:", e);
      return res.status(500).json({ error: "Failed to create group" });
    }
  };

  // ---------- getOne ----------
  const getOne = async (req, res) => {
    try {
      const { id } = req.params;
      const group = await BorrowerGroup.findByPk(id, {
        paranoid: false,
        include: [
          {
            model: BorrowerGroupMember,
            as: "groupMembers",
            attributes: ["groupId", "borrowerId", "role", "joinedAt", "leftAt"],
            paranoid: false,
            include: [
              Borrower
                ? { model: Borrower, as: "borrower", attributes: ["id", "firstName", "lastName", "name", "phone"], paranoid: false }
                : null,
            ].filter(Boolean),
          },
          Branch ? { model: Branch, as: "branch", attributes: ["id", "name"], paranoid: false } : null,
          User ? { model: User, as: "officer", attributes: ["id", "name", "email"], paranoid: false } : null,
        ].filter(Boolean),
      });

      if (!group) return res.status(404).json({ error: "Group not found" });

      const members = (group.groupMembers || []).map((m) => {
        const b = m.borrower || {};
        const name = b.name || [b.firstName, b.lastName].filter(Boolean).join(" ").trim();
        return {
          id: b.id ?? m.borrowerId,
          name: name || String(b.id ?? m.borrowerId),
          phone: b.phone || null,
          role: m.role || "member",
        };
      });

      res.json({
        id: group.id,
        name: group.name,
        branchId: group.branchId ?? null,
        branchName: group.branch?.name || null,
        loanOfficerId: group.officerId ?? null,
        officerName: group.officer?.name || null,
        meetingDay: group.meetingDay || null,
        status: group.status || "active",
        members,
      });
    } catch (e) {
      console.error("Get group error:", e);
      res.status(500).json({ error: "Failed to load group" });
    }
  };

  // ---------- summary (per-borrower outstanding + group total) ----------
  const summary = async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;
      const group = await BorrowerGroup.findByPk(id, {
        paranoid: false,
        include: [
          {
            model: BorrowerGroupMember,
            as: "groupMembers",
            attributes: ["borrowerId"],
            paranoid: false,
          },
        ],
        transaction: t,
      });
      if (!group) {
        await t.rollback();
        return res.status(404).json({ error: "Group not found" });
      }
      const borrowerIds = (group.groupMembers || []).map((gm) => gm.borrowerId);
      const { perBorrower, total } = await computeOutstandingForBorrowers(borrowerIds, t);
      await t.commit();
      return res.json({ perBorrower, outstandingTotal: total });
    } catch (e) {
      await t.rollback();
      // fail-safe: return zeros
      return res.json({ perBorrower: {}, outstandingTotal: 0 });
    }
  };

  // ---------- update ----------
  const update = async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;
      const group = await BorrowerGroup.findByPk(id, { transaction: t, paranoid: false });
      if (!group) {
        await t.rollback();
        return res.status(404).json({ error: "Group not found" });
      }

      const changes = {
        name: req.body?.name !== undefined ? (req.body.name || "").trim() : group.name,
        branchId:
          req.body?.branchId !== undefined ? toIntOrNull(req.body.branchId) : group.branchId,
        officerId:
          req.body?.officerId !== undefined ||
          req.body?.loanOfficerId !== undefined ||
          req.body?.loan_officer_id !== undefined
            ? clean(coalesceOfficerId(req.body))
            : group.officerId,
        meetingDay:
          req.body?.meetingDay !== undefined ? clean(req.body.meetingDay) : group.meetingDay,
        status: req.body?.status !== undefined ? clean(req.body.status) : group.status,
        notes: req.body?.notes !== undefined ? clean(req.body.notes) : group.notes,
      };

      if (changes.meetingDay) {
        changes.meetingDay = String(changes.meetingDay).toLowerCase();
        if (!allowedDays.includes(changes.meetingDay)) {
          await t.rollback();
          return res.status(400).json({ error: "meetingDay must be monday…sunday" });
        }
      }
      if (changes.status) {
        changes.status = String(changes.status).toLowerCase();
        if (!allowedStatus.includes(changes.status)) {
          await t.rollback();
          return res.status(400).json({ error: "status must be active|inactive" });
        }
      }

      if (changes.branchId != null && models.Branch) {
        const branch = await models.Branch.findByPk(changes.branchId, { transaction: t, paranoid: false });
        if (!branch) {
          await t.rollback();
          return res.status(400).json({ error: `Invalid branchId: ${changes.branchId} (branch not found)` });
        }
      }
      if (changes.officerId != null && models.User) {
        const officer = await models.User.findByPk(changes.officerId, { transaction: t, paranoid: false });
        if (!officer) {
          await t.rollback();
          return res.status(400).json({ error: `Invalid officerId: ${changes.officerId} (user not found)` });
        }
      }

      await group.update(changes, { transaction: t });
      await t.commit();
      return getOne(req, res);
    } catch (e) {
      await t.rollback();
      console.error("Update group error:", e);
      res.status(500).json({ error: "Failed to save changes" });
    }
  };

  // ---------- addMember ----------
  const addMember = async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;
      const borrowerId = toIntOrNull(req.body?.borrowerId);
      if (!borrowerId) {
        await t.rollback();
        return res.status(400).json({ error: "borrowerId is required" });
      }

      const groupId = toIntOrNull(id);
      const group = await BorrowerGroup.findByPk(groupId, { transaction: t, paranoid: false });
      if (!group) {
        await t.rollback();
        return res.status(404).json({ error: "Group not found" });
      }

      await BorrowerGroupMember.findOrCreate({
        where: { groupId, borrowerId },
        defaults: { role: "member", joinedAt: new Date() },
        transaction: t,
      });

      await t.commit();
      res.status(201).json({ groupId, borrowerId });
    } catch (e) {
      await t.rollback();
      console.error("Add member error:", e);
      res.status(500).json({ error: "Failed to add member" });
    }
  };

  // ---------- removeMember ----------
  const removeMember = async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const groupId = toIntOrNull(req.params.id);
      const borrowerId = toIntOrNull(req.params.borrowerId);
      const deleted = await BorrowerGroupMember.destroy({
        where: { groupId, borrowerId },
        transaction: t,
      });
      await t.commit();
      if (!deleted) return res.status(404).json({ error: "Member not found in this group" });
      res.json({ success: true });
    } catch (e) {
      await t.rollback();
      console.error("Remove member error:", e);
      res.status(500).json({ error: "Failed to remove member" });
    }
  };

  return { list, create, getOne, summary, update, addMember, removeMember };
};
