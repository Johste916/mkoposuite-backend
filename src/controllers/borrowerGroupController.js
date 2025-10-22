"use strict";

/**
 * Controller under /api/borrowers/groups
 * Shapes are aligned to your UI normalizers.
 */
module.exports = ({ models }) => {
  const {
    BorrowerGroup,
    BorrowerGroupMember,
    Borrower, // expected
    Branch,   // optional
    User,     // optional (officer)
    sequelize,
    Sequelize,
  } = models;

  const allowedDays = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  const allowedStatus = ["active","inactive"];

  // ---------- helpers ----------
  const coalesceOfficerId = (body) =>
    body?.officerId ??
    body?.loanOfficerId ??
    body?.loan_officer_id ??
    null;

  const clean = (v) => (v === "" ? null : v);

  // ---------- list ----------
  const list = async (req, res) => {
    try {
      const groups = await BorrowerGroup.findAll({
        include: [
          {
            model: BorrowerGroupMember,
            as: "groupMembers",
            attributes: ["groupId", "borrowerId"], // no standalone id
          },
          Branch ? { model: Branch, as: "branch", attributes: ["id", "name"] } : null,
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
    try {
      const payload = {
        name: (req.body?.name || "").trim(),
        branchId: clean(req.body?.branchId),
        officerId: clean(coalesceOfficerId(req.body)),
        meetingDay: clean(req.body?.meetingDay),
        notes: clean(req.body?.notes),
        status: clean(req.body?.status) || "active",
      };

      if (!payload.name) return res.status(400).json({ error: "Name is required" });
      if (payload.meetingDay) {
        payload.meetingDay = String(payload.meetingDay).toLowerCase();
        if (!allowedDays.includes(payload.meetingDay)) {
          return res.status(400).json({ error: "meetingDay must be monday…sunday" });
        }
      }
      if (payload.status) {
        payload.status = String(payload.status).toLowerCase();
        if (!allowedStatus.includes(payload.status)) {
          return res.status(400).json({ error: "status must be active|inactive" });
        }
      }

      const g = await BorrowerGroup.create(payload);
      res.status(201).json({ id: g.id, name: g.name });
    } catch (e) {
      console.error("Create group error:", e);
      res.status(500).json({ error: "Failed to create group" });
    }
  };

  // ---------- getOne ----------
  const getOne = async (req, res) => {
    try {
      const { id } = req.params;
      const group = await BorrowerGroup.findByPk(id, {
        include: [
          {
            model: BorrowerGroupMember,
            as: "groupMembers",
            attributes: ["groupId", "borrowerId", "role", "joinedAt", "leftAt"],
            include: [
              Borrower
                ? { model: Borrower, as: "borrower", attributes: ["id", "firstName", "lastName", "name", "phone"] }
                : null,
            ].filter(Boolean),
          },
          Branch ? { model: Branch, as: "branch", attributes: ["id", "name"] } : null,
          User ? { model: User, as: "officer", attributes: ["id", "name", "email"] } : null,
        ].filter(Boolean),
      });

      if (!group) return res.status(404).json({ error: "Group not found" });

      const members = (group.groupMembers || []).map((m) => {
        const b = m.borrower || {};
        const name = b.name || [b.firstName, b.lastName].filter(Boolean).join(" ").trim();
        return {
          id: b.id ?? m.borrowerId,           // UI expects borrower id here
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

  // ---------- update (PATCH/PUT) ----------
  const update = async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;
      const group = await BorrowerGroup.findByPk(id, { transaction: t });
      if (!group) {
        await t.rollback();
        return res.status(404).json({ error: "Group not found" });
      }

      const changes = {
        name: req.body?.name !== undefined ? (req.body.name || "").trim() : group.name,
        branchId: req.body?.branchId !== undefined ? clean(req.body.branchId) : group.branchId,
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

      await group.update(changes, { transaction: t });
      await t.commit();

      // Return the fresh shape the UI expects
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
      const { id } = req.params; // groupId
      const borrowerId = req.body?.borrowerId;
      if (!borrowerId) {
        await t.rollback();
        return res.status(400).json({ error: "borrowerId is required" });
      }

      const group = await BorrowerGroup.findByPk(id, { transaction: t });
      if (!group) {
        await t.rollback();
        return res.status(404).json({ error: "Group not found" });
      }

      await BorrowerGroupMember.findOrCreate({
        where: { groupId: id, borrowerId },
        defaults: { role: "member", joinedAt: new Date() },
        transaction: t,
      });

      await t.commit();
      res.status(201).json({ groupId: Number(id), borrowerId: Number(borrowerId) });
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
      const { id, borrowerId } = req.params;
      const deleted = await BorrowerGroupMember.destroy({
        where: { groupId: id, borrowerId },
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

  return { list, create, getOne, update, addMember, removeMember };
};
