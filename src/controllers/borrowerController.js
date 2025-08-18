"use strict";

const { Op } = require("sequelize");
const models = require("../models");

const Borrower            = models.Borrower || null;
const Loan                = models.Loan || null;
const LoanRepayment       = models.LoanRepayment || null;
const SavingsTransaction  = models.SavingsTransaction || null;
const Group               = models.BorrowerGroup || models.Group || null;
const GroupMember         = models.BorrowerGroupMember || models.GroupMember || null;
const BorrowerComment     = models.BorrowerComment || null;
const KYCDocument         = models.KYCDocument || null;
const Branch              = models.Branch || null;
const User                = models.User || null;
const Role                = models.Role || null;
const UserRole            = models.UserRole || null;

const toApi = (b) => {
  if (!b) return null;
  const json = b.toJSON ? b.toJSON() : b;
  return { ...json, fullName: json.fullName ?? json.name ?? "" };
};

const safeNum = (v) => Number(v || 0);

/* ------------------------ Filters for list (branches/statuses/officers) ------------------------ */
exports.getBorrowerFilters = async (_req, res) => {
  try {
    // Branches
    let branches = [];
    if (Branch?.findAll) {
      const rows = await Branch.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]] });
      branches = rows.map(b => ({ id: b.id, name: b.name }));
    }

    // Statuses (fallback if DISTINCT fails)
    let statuses = ["active", "pending_kyc", "blacklisted", "inactive"];
    if (Borrower?.sequelize) {
      try {
        const [rows] = await Borrower.sequelize.query(
          `SELECT DISTINCT status FROM "Borrowers" WHERE status IS NOT NULL ORDER BY status ASC;`
        );
        const dbStatuses = (rows || []).map(r => r.status).filter(Boolean);
        if (dbStatuses.length) statuses = dbStatuses;
      } catch {}
    }

    // Officers — do NOT rely on UserRole.include() to avoid association issues.
    let officers = [];
    if (Role && UserRole && User) {
      const officerRoles = await Role.findAll({
        where: { name: { [Op.iLike]: "%loan%officer%" } },
        attributes: ["id"]
      });
      if (officerRoles.length) {
        const roleIds = officerRoles.map(r => r.id);
        const urs = await UserRole.findAll({ where: { roleId: roleIds }, attributes: ["userId"] });
        const userIds = Array.from(new Set(urs.map(u => u.userId))).filter(Boolean);
        if (userIds.length) {
          const us = await User.findAll({ where: { id: userIds }, attributes: ["id", "name", "email"] });
          officers = us.map(u => ({ id: u.id, name: u.name, email: u.email }));
        }
      }
    }
    if (!officers.length && User) {
      const us = await User.findAll({
        where: { role: { [Op.in]: ["loan_officer", "Loan Officer", "officer", "Officer"] } },
        attributes: ["id", "name", "email"]
      });
      officers = us.map(u => ({ id: u.id, name: u.name, email: u.email }));
    }

    res.json({ branches, statuses, officers });
  } catch (e) {
    console.error("getBorrowerFilters error:", e);
    res.status(500).json({ error: "Failed to load filters" });
  }
};

/* ---------------------------------------------- CRUD ---------------------------------------------- */
exports.getAllBorrowers = async (req, res) => {
  try {
    if (!Borrower) return res.json({ items: [], total: 0 });

    const { q = "", branchId, page = 1, pageSize = 50, status, sort = "createdAt", dir = "desc" } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { phone: { [Op.iLike]: `%${q}%` } },
        { nationalId: { [Op.iLike]: `%${q}%` } },
      ];
    }

    // whitelisted sorts (fallback to createdAt)
    const sortKey = ["name", "phone", "status", "createdAt", "updatedAt"].includes(String(sort))
      ? String(sort)
      : "createdAt";
    const sortDir = String(dir).toLowerCase() === "asc" ? "ASC" : "DESC";

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    const { rows, count } = await Borrower.findAndCountAll({
      where,
      order: [[sortKey, sortDir]],
      limit,
      offset,
    });

    res.json({ items: rows.map(toApi), total: count });
  } catch (error) {
    console.error("getAllBorrowers error:", error);
    res.status(500).json({ error: "Failed to fetch borrowers" });
  }
};

exports.createBorrower = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });

    const { name, fullName, nationalId, phone, email, address, branchId } = req.body || {};
    if (!name && !fullName) return res.status(400).json({ error: "name is required" });

    const created = await Borrower.create({
      name: name || fullName || "",
      nationalId: nationalId || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      branchId: branchId || null,
      status: "active",
    });

    res.status(201).json(toApi(created));
  } catch (error) {
    console.error("createBorrower error:", error);
    res.status(500).json({ error: "Failed to create borrower" });
  }
};

exports.getBorrowerById = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: "Borrower not found" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });
    res.json(toApi(b));
  } catch (error) {
    console.error("getBorrowerById error:", error);
    res.status(500).json({ error: "Failed to fetch borrower" });
  }
};

exports.updateBorrower = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    const { name, fullName, nationalId, phone, email, address, branchId, status } = req.body || {};
    await b.update({
      name: name ?? fullName ?? b.name,
      nationalId: nationalId ?? b.nationalId,
      phone: phone ?? b.phone,
      email: email ?? b.email,
      address: address ?? b.address,
      branchId: branchId ?? b.branchId,
      status: status ?? b.status,
    });

    res.json(toApi(b));
  } catch (error) {
    console.error("updateBorrower error:", error);
    res.status(500).json({ error: "Failed to update borrower" });
  }
};

exports.deleteBorrower = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    await b.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error("deleteBorrower error:", error);
    res.status(500).json({ error: "Failed to delete borrower" });
  }
};

/* --------------------------------------------- Nested --------------------------------------------- */
exports.getLoansByBorrower = async (req, res) => {
  try {
    if (!Loan) return res.json([]);
    const rows = await Loan.findAll({
      where: { borrowerId: req.params.id },
      order: [["createdAt", "DESC"]],
      limit: 500,
    });
    res.json(rows || []);
  } catch (error) {
    console.error("getLoansByBorrower error:", error);
    res.status(500).json({ error: "Failed to fetch loans" });
  }
};

exports.getRepaymentsByBorrower = async (req, res) => {
  try {
    if (!Loan || !LoanRepayment) return res.json([]);
    const rows = await LoanRepayment.findAll({
      include: [{ model: Loan, where: { borrowerId: req.params.id }, attributes: [] }],
      order: [["dueDate", "DESC"], ["createdAt", "DESC"]], // model has dueDate, not date
      limit: 500,
    });
    res.json(rows || []);
  } catch (error) {
    console.error("getRepaymentsByBorrower error:", error);
    res.status(500).json({ error: "Failed to fetch repayments" });
  }
};

/* -------------------------------------------- Comments -------------------------------------------- */
exports.listComments = async (req, res) => {
  try {
    if (!BorrowerComment) return res.json([]);
    const rows = await BorrowerComment.findAll({
      where: { borrowerId: req.params.id },
      order: [["createdAt", "DESC"]],
      limit: 200,
    });
    res.json(rows || []);
  } catch (error) {
    console.error("listComments error:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
};

exports.addComment = async (req, res) => {
  try {
    const { comment, content } = req.body || {};
    const text = (content ?? comment ?? "").trim();
    if (!text) return res.status(400).json({ error: "content is required" });

    if (!Borrower) return res.status(404).json({ error: "Borrower not found" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    if (!BorrowerComment) {
      return res.status(201).json({
        id: 0,
        borrowerId: req.params.id,
        content: text,
        createdAt: new Date().toISOString(),
      });
    }

    const created = await BorrowerComment.create({
      borrowerId: req.params.id,
      content: text,
      userId: req.user?.id || null,
    });

    res.status(201).json(created);
  } catch (error) {
    console.error("addComment error:", error);
    res.status(500).json({ error: "Failed to add comment" });
  }
};

/* --------------------------------------------- Savings -------------------------------------------- */
exports.getSavingsByBorrower = async (req, res) => {
  try {
    if (!SavingsTransaction) {
      return res.json({ balance: 0, transactions: [] });
    }

    const txs = await SavingsTransaction.findAll({
      where: { borrowerId: req.params.id },
      order: [["date", "DESC"], ["createdAt", "DESC"]],
      limit: 500,
    });

    let deposits = 0, withdrawals = 0;
    for (const t of txs) {
      if (t.type === "deposit") deposits += safeNum(t.amount);
      else if (t.type === "withdrawal") withdrawals += safeNum(t.amount);
    }
    const balance = deposits - withdrawals;

    res.json({ balance, transactions: txs });
  } catch (error) {
    console.error("getSavingsByBorrower error:", error);
    res.status(500).json({ error: "Failed to fetch savings" });
  }
};

/* --------------------------------------------- Documents ------------------------------------------- */
exports.listDocuments = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: "Borrower not found" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    if (!KYCDocument) return res.json([]);
    const items = await KYCDocument.findAll({
      where: { borrowerId: b.id },
      order: [["createdAt", "DESC"]],
    });
    res.json(
      items.map(d => ({
        id: d.id,
        fileName: d.fileName || d.name || "Document",
        type: d.type || "KYC",
        createdAt: d.createdAt,
        url: d.fileUrl || d.url || null,
      }))
    );
  } catch (e) {
    console.error("listDocuments error:", e);
    res.status(500).json({ error: "Failed to load documents" });
  }
};

/* --------------------------------------------- Blacklist ------------------------------------------- */
exports.blacklist = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });
    await b.update({ status: "blacklisted" });
    res.json({ id: b.id, status: b.status });
  } catch (error) {
    console.error("blacklist error:", error);
    res.status(500).json({ error: "Failed to blacklist borrower" });
  }
};

exports.unblacklist = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });
    await b.update({ status: "active" });
    res.json({ id: b.id, status: b.status });
  } catch (error) {
    console.error("unblacklist error:", error);
    res.status(500).json({ error: "Failed to unblacklist borrower" });
  }
};

exports.listBlacklisted = async (_req, res) => {
  try {
    if (!Borrower) return res.json([]);
    const borrowers = await Borrower.findAll({ where: { status: "blacklisted" } });
    res.json(borrowers.map(toApi));
  } catch (error) {
    console.error("listBlacklisted error:", error);
    res.status(500).json({ error: "Failed to fetch blacklisted borrowers" });
  }
};

/* ----------------------------------------------- KYC ------------------------------------------------ */
exports.uploadKyc = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: "Borrower not found" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    const files = (req.files || []).map(f => ({
      field: f.fieldname,
      originalName: f.originalname,
      size: f.size,
      mimeType: f.mimetype,
    }));

    if (KYCDocument && files.length) {
      const created = await Promise.all(
        files.map(f =>
          KYCDocument.create({
            borrowerId: b.id,
            fileName: f.originalName,
            mimeType: f.mimeType,
            size: f.size,
            storageKey: null,
          })
        )
      );
      return res.status(201).json({ borrowerId: b.id, items: created });
    }

    return res.status(201).json({ borrowerId: b.id, files });
  } catch (error) {
    console.error("uploadKyc error:", error);
    res.status(500).json({ error: "Failed to upload KYC" });
  }
};

exports.listKyc = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: "Borrower not found" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    if (!KYCDocument) return res.json({ borrowerId: b.id, items: [] });

    const items = await KYCDocument.findAll({
      where: { borrowerId: b.id },
      order: [["createdAt", "DESC"]],
    });

    res.json({ borrowerId: b.id, items });
  } catch (error) {
    console.error("listKyc error:", error);
    res.status(500).json({ error: "Failed to load KYC docs" });
  }
};

exports.listKycQueue = async (_req, res) => {
  try {
    if (!Borrower) return res.json([]);
    const borrowers = await Borrower.findAll({ where: { status: "pending_kyc" } });
    res.json(borrowers.map(toApi));
  } catch (error) {
    console.error("listKycQueue error:", error);
    res.status(500).json({ error: "Failed to fetch KYC queue" });
  }
};
