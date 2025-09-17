"use strict";

/**
 * Lightweight controller that sits under /api/borrowers/groups
 * and returns shapes your frontend already normalizes.
 */
module.exports = ({ models }) => {
  const {
    BorrowerGroup,
    BorrowerGroupMember,
    Borrower, // expected to exist
    Branch,   // optional
    User,     // optional (officer)
    sequelize,
  } = models;

  const list = async (req, res) => {
    try {
      const groups = await BorrowerGroup.findAll({
        include: [
          { model: BorrowerGroupMember, as: "groupMembers", attributes: ["id"] },
          Branch ? { model: Branch, as: "branch", attributes: ["id", "name"] } : null,
        ].filter(Boolean),
        order: [["createdAt", "DESC"]],
      });

      const rows = groups.map((g) => ({
        id: g.id,
        name: g.name,
        branchName: g.branch?.name || null,
        membersCount: g.groupMembers?.length || 0,
        // placeholders (you can replace with real aggregates if needed)
        loanCount: 0,
        outstanding: 0,
      }));

      res.json({ items: rows, total: rows.length });
    } catch (e) {
      console.error("Groups list error:", e);
      res.status(500).json({ error: "Failed to load groups" });
    }
  };

  const create = async (req, res) => {
    try {
      const payload = {
        name: (req.body?.name || "").trim(),
        branchId: req.body?.branchId || null,
        officerId: req.body?.officerId || null,
        meetingDay: req.body?.meetingDay || null,
        notes: req.body?.notes || null,
      };
      if (!payload.name) return res.status(400).json({ error: "Name is required" });

      const g = await BorrowerGroup.create(payload);
      res.status(201).json({ id: g.id, name: g.name });
    } catch (e) {
      console.error("Create group error:", e);
      res.status(500).json({ error: "Failed to create group" });
    }
  };

  const getOne = async (req, res) => {
    try {
      const { id } = req.params;
      const group = await BorrowerGroup.findByPk(id, {
        include: [
          {
            model: BorrowerGroupMember,
            as: "groupMembers",
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
        const name = b.name || [b.firstName, b.lastName].filter(Boolean).join(" ");
        return { id: b.id, name, phone: b.phone || null, role: m.role || "member" };
      });

      res.json({
        id: group.id,
        name: group.name,
        branchName: group.branch?.name || null,
        officerName: group.officer?.name || null,
        meetingDay: group.meetingDay || null,
        members,
      });
    } catch (e) {
      console.error("Get group error:", e);
      res.status(500).json({ error: "Failed to load group" });
    }
  };

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

      // upsert-ish (respect unique[groupId, borrowerId])
      const [row] = await BorrowerGroupMember.findOrCreate({
        where: { groupId: id, borrowerId },
        defaults: { role: "member", joinedAt: new Date() },
        transaction: t,
      });

      await t.commit();
      res.status(201).json({ id: row.id });
    } catch (e) {
      await t.rollback();
      console.error("Add member error:", e);
      res.status(500).json({ error: "Failed to add member" });
    }
  };

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

  return { list, create, getOne, addMember, removeMember };
};
