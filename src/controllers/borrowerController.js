"use strict";

const { Op } = require("sequelize");
const models = require("../models");
const fs = require("fs");
const path = require("path");

// Models (nullable-safe)
const Borrower           = models.Borrower || null;
const Loan               = models.Loan || null;
const LoanRepayment      = models.LoanRepayment || null;
const SavingsTransaction = models.SavingsTransaction || null;
const Group              = models.BorrowerGroup || models.Group || null;
const GroupMember        = models.BorrowerGroupMember || models.GroupMember || null;
const BorrowerComment    = models.BorrowerComment || null;
const KYCDocument        = models.KYCDocument || null;

// Runtime column introspection (for DB ↔ model drift safety)
const sequelize = models.sequelize || null;
const _qi = sequelize?.getQueryInterface?.();
const _colCache = new Map();

/** Return the actual columns that exist in DB for Model (cached). */
const getExistingColumns = async (Model) => {
  const table = Model?.getTableName?.();
  if (!Model || !table || !_qi) {
    return Object.keys(Model?.rawAttributes || {});
  }
  const key =
    typeof table === "string" ? table : `${table.schema}.${table.tableName}`;
  if (_colCache.has(key)) return _colCache.get(key);
  try {
    const desc = await _qi.describeTable(table);
    const cols = Object.keys(desc || {});
    _colCache.set(key, cols);
    return cols;
  } catch {
    const cols = Object.keys(Model?.rawAttributes || {});
    _colCache.set(key, cols);
    return cols;
  }
};

/** Build a safe attributes list limited to columns that exist in DB. */
const safeAttributes = async (Model, candidates) => {
  const cols = await getExistingColumns(Model);
  const base = candidates || Object.keys(Model?.rawAttributes || {});
  return base.filter((c) => cols.includes(c));
};

const toApi = (b) => {
  if (!b) return null;
  const json = b.toJSON ? b.toJSON() : b;
  return { ...json, fullName: json.fullName ?? json.name ?? "" };
};

const safeNum = (v) => Number(v || 0);

/* helper: store an uploaded photo if the Borrower has a photoUrl column */
async function maybePersistPhoto(borrowerId, file) {
  if (!file || !Borrower?.rawAttributes?.photoUrl) return null;
  try {
    const uploadsRoot = path.resolve(__dirname, "..", "uploads", "borrowers");
    fs.mkdirSync(uploadsRoot, { recursive: true });
    const ext = (file.originalname?.split(".").pop() || "jpg").toLowerCase();
    const fname = `${borrowerId}-${Date.now()}.${ext}`;
    const out = path.join(uploadsRoot, fname);
    fs.writeFileSync(out, file.buffer);
    return `/uploads/borrowers/${fname}`;
  } catch {
    return null;
  }
}

/* ---------- Derived borrower metrics (auto-updating for UI cards) ---------- */
async function computeBorrowerDerived(borrowerId) {
  const derived = {
    parPercent: 0,
    overdueAmount: 0,
    netSavings: 0,
  };

  try {
    // Savings balance (netSavings)
    if (SavingsTransaction) {
      const txAttrs = await safeAttributes(SavingsTransaction, [
        "type",
        "amount",
        "reversed",
      ]);
      const txs = await SavingsTransaction.findAll({
        where: { borrowerId },
        attributes: txAttrs,
        limit: 2000,
      });

      let balance = 0;
      for (const t of txs) {
        if (t.reversed === true) continue;
        const amt = safeNum(t.amount);
        if (t.type === "deposit" || t.type === "interest") balance += amt;
        else if (t.type === "withdrawal" || t.type === "charge") balance -= amt;
      }
      derived.netSavings = balance;
    }

    // Overdue & PAR
    let totalOutstanding = 0;
    if (Loan) {
      // Try to use existing outstanding fields if present
      const loanAttrs = await safeAttributes(Loan, [
        "id",
        "borrowerId",
        "amount",
        "status",
        "outstanding",
        "outstandingAmount",
        "outstandingTotal",
      ]);
      const loans = await Loan.findAll({
        where: { borrowerId },
        attributes: loanAttrs,
        limit: 1000,
      });

      for (const l of loans) {
        const out =
          [l.outstanding, l.outstandingAmount, l.outstandingTotal]
            .map((x) => (typeof x === "number" ? x : null))
            .find((x) => x != null) ?? null;

        if (out != null) {
          totalOutstanding += safeNum(out);
        } else {
          // Fallback to principal if no outstanding column exists
          totalOutstanding += safeNum(l.amount);
        }
      }
    }

    // Overdue: sum unpaid amounts of repayment rows due before today
    if (LoanRepayment && Loan) {
      const repayAttrs = await safeAttributes(LoanRepayment, [
        "amount",
        "amountPaid",
        "status",
        "dueDate",
        "loanId",
      ]);

      const today = new Date();
      // Grab only this borrower's loans' repayments
      const rows = await LoanRepayment.findAll({
        attributes: repayAttrs,
        include: [{ model: Loan, where: { borrowerId }, attributes: [] }],
        where: {
          [Op.or]: [
            { status: { [Op.in]: ["overdue", "due"] } },
            { dueDate: { [Op.lt]: today } },
          ],
        },
        limit: 5000,
        order: [["dueDate", "DESC"]],
      });

      let overdue = 0;
      for (const r of rows) {
        const due = safeNum(r.amount);
        const paid = safeNum(r.amountPaid);
        if (due > paid) overdue += (due - paid);
      }
      derived.overdueAmount = overdue;

      if (totalOutstanding > 0) {
        derived.parPercent = Number(((overdue / totalOutstanding) * 100).toFixed(2));
      } else {
        derived.parPercent = 0;
      }
    }
  } catch (err) {
    // Soft-fail — keep derived zeros if something is missing
    console.warn("computeBorrowerDerived failed:", err?.message || err);
  }

  return derived;
}

/* ---------- CRUD ---------- */
exports.getAllBorrowers = async (req, res) => {
  try {
    if (!Borrower) return res.json({ items: [], total: 0 });
    const { q = "", branchId, page = 1, pageSize = 50 } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { phone: { [Op.iLike]: `%${q}%` } },
        { nationalId: { [Op.iLike]: `%${q}%` } },
      ];
    }

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    // Select conservative, likely-to-exist attributes.
    const attributes = ["id", "name", "nationalId", "phone", "address", "createdAt", "updatedAt"]
      .filter((a) => Borrower.rawAttributes[a]);

    const { rows, count } = await Borrower.findAndCountAll({
      where,
      attributes,
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    return res.json({ items: rows.map(toApi), total: count });
  } catch (error) {
    console.error("getAllBorrowers error:", error);
    res.status(500).json({ error: "Failed to fetch borrowers" });
  }
};

exports.createBorrower = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });

    const existingCols = await getExistingColumns(Borrower);

    // Accept both JSON and multipart/form-data (fields from AddBorrower)
    const b = req.body || {};
    const firstName = (b.firstName || "").trim();
    const lastName  = (b.lastName || "").trim();
    const displayName = (b.name || b.fullName || `${firstName} ${lastName}`.trim()).trim();

    if (!displayName) return res.status(400).json({ error: "name is required" });

    // Branch requirement if column exists and is NOT NULL
    const needsBranchId =
      !!Borrower.rawAttributes.branchId &&
      Borrower.rawAttributes.branchId.allowNull === false;
    const incomingBranchId =
      b.branchId || req.headers["x-branch-id"] || req.user?.branchId || null;
    if (needsBranchId && !incomingBranchId) {
      return res.status(400).json({ error: "branchId is required" });
    }

    // Build payload only with columns that exist in DB
    const payload = {};
    if (existingCols.includes("name"))        payload.name = displayName;
    if (existingCols.includes("nationalId"))  payload.nationalId = b.nationalId || b.idNumber || null;
    if (existingCols.includes("phone"))       payload.phone = b.phone || null;
    if (existingCols.includes("email"))       payload.email = b.email || null;
    if (existingCols.includes("address"))     payload.address = b.addressLine || b.address || null;
    if (existingCols.includes("status"))      payload.status = "active";
    if (existingCols.includes("branch_id") || existingCols.includes("branchId")) {
      if (incomingBranchId) payload.branchId = incomingBranchId;
    }

    // Optional extras (align with Add Borrower form)
    if (existingCols.includes("gender"))                  payload.gender = b.gender || null;
    if (existingCols.includes("birthDate"))               payload.birthDate = b.birthDate || null;
    if (existingCols.includes("employmentStatus"))        payload.employmentStatus = b.employmentStatus || null;
    if (existingCols.includes("occupation"))              payload.occupation = b.occupation || b.businessType || null;
    if (existingCols.includes("idType"))                  payload.idType = b.idType || null;
    if (existingCols.includes("idIssuedDate"))            payload.idIssuedDate = b.idIssuedDate || null;
    if (existingCols.includes("idExpiryDate"))            payload.idExpiryDate = b.idExpiryDate || null;
    if (existingCols.includes("nextKinName"))             payload.nextKinName = b.nextKinName || null;
    if (existingCols.includes("nextKinPhone"))            payload.nextKinPhone = b.nextKinPhone || null;
    if (existingCols.includes("nextOfKinRelationship"))   payload.nextOfKinRelationship = b.nextOfKinRelationship || b.kinRelationship || null;
    if (existingCols.includes("regDate"))                 payload.regDate = b.regDate || null;
    if (existingCols.includes("loanOfficerId"))           payload.loanOfficerId = b.loanOfficerId || b.officerId || null;
    if (existingCols.includes("groupId"))                 payload.groupId = b.loanType === "group" ? (b.groupId || null) : null;

    const created = await Borrower.create(payload);

    // If a photo file was posted and DB has photoUrl, persist it
    const file = Array.isArray(req.files) && req.files.find(f => f.fieldname === "photo");
    const photoUrl = await maybePersistPhoto(created.id, file);
    if (photoUrl && existingCols.includes("photoUrl")) {
      await created.update({ photoUrl });
    }

    // include derived so Add→Details shows everything immediately
    const derived = await computeBorrowerDerived(created.id);
    res.status(201).json({ ...toApi(created), ...derived });
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
    const derived = await computeBorrowerDerived(b.id);
    res.json({ ...toApi(b), ...derived });
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

    // 🔒 Single-branch policy for borrowers:
    const { branchId } = req.body || {};
    if (Borrower.rawAttributes.branchId && typeof branchId !== "undefined") {
      const current = b.branchId;
      if (current && Number(current) !== Number(branchId)) {
        return res.status(409).json({
          error: "Borrower already assigned to a branch — unassign first before reassigning.",
          currentBranchId: current,
          requestedBranchId: Number(branchId),
          unassignUrl: `/api/borrowers/${b.id}/branch`,
          method: "DELETE",
        });
      }
    }

    // Only update columns that exist (keeps other environments safe)
    const cols = await getExistingColumns(Borrower);
    const body = req.body || {};
    const patch = {};

    const setIf = (key, value) => {
      if (cols.includes(key) && typeof value !== "undefined") patch[key] = value;
    };

    // Core fields
    setIf("name", body.name ?? body.fullName);
    setIf("nationalId", body.nationalId);
    setIf("phone", body.phone);
    setIf("email", body.email);
    setIf("address", body.address);

    // Assignment
    if (Borrower.rawAttributes.branchId) {
      if (!b.branchId && typeof body.branchId !== "undefined") {
        setIf("branchId", body.branchId);
      }
    }
    setIf("loanOfficerId", body.officerId ?? body.loanOfficerId);

    // Status
    setIf("status", body.status);

    // Identity / KYC mirrors UI
    setIf("gender", body.gender);
    setIf("birthDate", body.birthDate || null);
    setIf("employmentStatus", body.employmentStatus);
    setIf("occupation", body.occupation);
    setIf("idType", body.idType);
    setIf("idIssuedDate", body.idIssuedDate || null);
    setIf("idExpiryDate", body.idExpiryDate || null);
    setIf("nextKinName", body.nextKinName);
    setIf("nextKinPhone", body.nextKinPhone);
    setIf("nextOfKinRelationship", body.nextOfKinRelationship);
    setIf("groupId", body.groupId);

    await b.update(patch);

    // Return canonical + fresh derived so UI reflects instantly
    const derived = await computeBorrowerDerived(b.id);
    res.json({ ...toApi(b), ...derived });
  } catch (error) {
    console.error("updateBorrower error:", error);
    res.status(500).json({ error: "Failed to update borrower" });
  }
};

exports.disableBorrower = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });
    await b.update({ status: "disabled" });
    const derived = await computeBorrowerDerived(b.id);
    res.json({ id: b.id, status: b.status, ...derived });
  } catch (error) {
    console.error("disableBorrower error:", error);
    res.status(500).json({ error: "Failed to disable borrower" });
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

/* ---------- Explicit Branch Assign/Unassign (Additive) ---------- */
exports.assignBranch = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    if (!Borrower.rawAttributes.branchId) return res.status(422).json({ error: "Borrower model has no branchId column" });

    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    const newBranchId = Number.parseInt(String(req.body?.branchId), 10);
    if (!Number.isFinite(newBranchId)) return res.status(400).json({ error: "branchId must be an integer" });

    const current = b.branchId ?? null;

    if (current && Number(current) !== newBranchId) {
      return res.status(409).json({
        error: "Borrower already assigned to another branch — unassign first.",
        currentBranchId: current,
        requestedBranchId: newBranchId,
        unassignUrl: `/api/borrowers/${b.id}/branch`,
        method: "DELETE",
      });
    }

    if (!current) {
      await b.update({ branchId: newBranchId });
    }

    const derived = await computeBorrowerDerived(b.id);
    return res.json({ ok: true, borrowerId: b.id, branchId: b.branchId ?? newBranchId, ...derived });
  } catch (error) {
    console.error("assignBranch error:", error);
    return res.status(500).json({ error: "Failed to assign branch" });
  }
};

exports.unassignBranch = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    if (!Borrower.rawAttributes.branchId) return res.status(422).json({ error: "Borrower model has no branchId column" });

    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    const allowNull = Borrower.rawAttributes.branchId.allowNull !== false;

    if (!allowNull) {
      return res.status(422).json({
        error: "This environment does not allow unassign (branchId is NOT NULL).",
        hint: "Reassignment is blocked by policy; contact admin if a transfer workflow is needed.",
      });
    }

    if (b.branchId === null || typeof b.branchId === 'undefined') {
      return res.json({ ok: true, borrowerId: b.id, branchId: null });
    }

    await b.update({ branchId: null });
    const derived = await computeBorrowerDerived(b.id);
    return res.json({ ok: true, borrowerId: b.id, branchId: null, ...derived });
  } catch (error) {
    console.error("unassignBranch error:", error);
    return res.status(500).json({ error: "Failed to unassign branch" });
  }
};

/* ---------- Nested ---------- */
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
    const repayAttrs = await safeAttributes(LoanRepayment, [
      "id",
      "loanId",
      "amount",
      "amountPaid",
      "status",
      "dueDate",
      "date",
      "createdAt",
    ]);
    const rows = await LoanRepayment.findAll({
      attributes: repayAttrs,
      include: [{ model: Loan, where: { borrowerId: req.params.id }, attributes: [] }],
      order: [["dueDate", "DESC"], ["createdAt", "DESC"]],
      limit: 500,
    });
    res.json(rows || []);
  } catch (error) {
    console.error("getRepaymentsByBorrower error:", error);
    res.status(500).json({ error: "Failed to fetch repayments" });
  }
};

/* ---------- Comments ---------- */
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
    const { content } = req.body || {};
    if (!content || !content.trim())
      return res.status(400).json({ error: "content is required" });

    if (!Borrower) return res.status(404).json({ error: "Borrower not found" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    if (!BorrowerComment) {
      return res.status(201).json({
        id: 0,
        borrowerId: req.params.id,
        content: content.trim(),
        createdAt: new Date().toISOString(),
      });
    }

    const created = await BorrowerComment.create({
      borrowerId: req.params.id,
      content: content.trim(),
      userId: req.user?.id || null,
    });

    res.status(201).json(created);
  } catch (error) {
    console.error("addComment error:", error);
    res.status(500).json({ error: "Failed to add comment" });
  }
};

/* ---------- Savings ---------- */
/**
 * Aligns with /api/savings/borrower/:borrowerId logic:
 * - ignores reversed transactions in totals/balance
 * - supports deposit, withdrawal, charge, interest
 * - returns { balance, transactions, totals }
 * - selects only columns that actually exist in DB (avoids 42703)
 */
exports.getSavingsByBorrower = async (req, res) => {
  try {
    if (!SavingsTransaction) {
      return res.json({
        balance: 0,
        transactions: [],
        totals: { deposits: 0, withdrawals: 0, charges: 0, interest: 0 },
      });
    }

    const txAttrs = await safeAttributes(SavingsTransaction, [
      "id",
      "borrowerId",
      "type",
      "amount",
      "date",
      "notes",
      "reference",
      "status",
      "reversed",
      "createdAt",
      "updatedAt",
    ]);

    const existingCols = await getExistingColumns(SavingsTransaction);
    const hasDate = existingCols.includes("date");

    const txs = await SavingsTransaction.findAll({
      where: { borrowerId: req.params.id },
      attributes: txAttrs,
      order: hasDate ? [["date", "DESC"], ["createdAt", "DESC"]] : [["createdAt", "DESC"]],
      limit: 500,
    });

    const totals = { deposits: 0, withdrawals: 0, charges: 0, interest: 0 };
    let balance = 0;

    for (const t of txs) {
      if (t.reversed === true) continue;
      const amt = safeNum(t.amount);
      switch (t.type) {
        case "deposit":
          totals.deposits += amt;
          balance += amt;
          break;
        case "withdrawal":
          totals.withdrawals += amt;
          balance -= amt;
          break;
        case "charge":
          totals.charges += amt;
          balance -= amt;
          break;
        case "interest":
          totals.interest += amt;
          balance += amt;
          break;
        default:
          break;
      }
    }

    res.json({ balance, transactions: txs, totals });
  } catch (error) {
    console.error("getSavingsByBorrower error:", error);
    res.status(500).json({ error: "Failed to fetch savings" });
  }
};

/* ---------- Blacklist ---------- */
exports.blacklist = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });
    await b.update({ status: "blacklisted" });
    const derived = await computeBorrowerDerived(b.id);
    res.json({ id: b.id, status: b.status, ...derived });
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
    const derived = await computeBorrowerDerived(b.id);
    res.json({ id: b.id, status: b.status, ...derived });
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

/* ---------- KYC ---------- */
exports.uploadKyc = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: "Borrower not found" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    const files = (req.files || []).map((f) => ({
      field: f.fieldname,
      originalName: f.originalname,
      size: f.size,
      mimeType: f.mimetype,
    }));

    if (KYCDocument && files.length) {
      const created = await Promise.all(
        files.map((f) =>
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

/* ---------- Groups ---------- */
exports.listGroups = async (_req, res) => {
  try {
    if (!Group) return res.json([]);
    const groups = await Group.findAll({ order: [["createdAt", "DESC"]] });
    res.json(groups || []);
  } catch (error) {
    console.error("listGroups error:", error);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
};

exports.createGroup = async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });
    if (!Group) return res.status(501).json({ error: "Group model not available" });
    const g = await Group.create({ name });
    res.status(201).json(g);
  } catch (error) {
    console.error("createGroup error:", error);
    res.status(500).json({ error: "Failed to create group" });
  }
};

exports.getGroup = async (req, res) => {
  try {
    if (!Group) return res.status(404).json({ error: "Group not found" });
    const g = await Group.findByPk(req.params.groupId);
    if (!g) return res.status(404).json({ error: "Group not found" });

    let members = [];
    if (GroupMember && Borrower) {
      const rows = await GroupMember.findAll({
        where: { groupId: g.id },
        include: [{ model: Borrower, attributes: ["id", "name", "phone"] }],
      });
      members = rows.map((r) => r.Borrower);
    }

    res.json({ ...g.toJSON(), members });
  } catch (error) {
    console.error("getGroup error:", error);
    res.status(500).json({ error: "Failed to fetch group" });
  }
};

exports.updateGroup = async (req, res) => {
  try {
    if (!Group) return res.status(501).json({ error: "Group model not available" });
    const g = await Group.findByPk(req.params.groupId);
    if (!g) return res.status(404).json({ error: "Group not found" });
    const { name } = req.body || {};
    await g.update({ name: name ?? g.name });
    res.json(g);
  } catch (error) {
    console.error("updateGroup error:", error);
    res.status(500).json({ error: "Failed to update group" });
  }
};

exports.addGroupMember = async (req, res) => {
  try {
    const { borrowerId } = req.body || {};
    if (!borrowerId) return res.status(400).json({ error: "borrowerId is required" });
    if (!Group || !GroupMember || !Borrower)
      return res.status(501).json({ error: "Group membership not available" });

    const g = await Group.findByPk(req.params.groupId);
    if (!g) return res.status(404).json({ error: "Group not found" });

    const b = await Borrower.findByPk(borrowerId);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    const [gm] = await GroupMember.findOrCreate({
      where: { groupId: g.id, borrowerId: b.id },
    });
    res.json(gm);
  } catch (error) {
    console.error("addGroupMember error:", error);
    res.status(500).json({ error: "Failed to add member" });
  }
};

exports.removeGroupMember = async (req, res) => {
  try {
    if (!GroupMember) return res.status(501).json({ error: "Group membership not available" });
    const { groupId, borrowerId } = req.params;
    const gm = await GroupMember.findOne({ where: { groupId, borrowerId } });
    if (!gm) return res.status(404).json({ error: "Membership not found" });
    await gm.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error("removeGroupMember error:", error);
    res.status(500).json({ error: "Failed to remove member" });
  }
};

exports.groupReports = async (_req, res) => {
  try {
    if (!Group) return res.json([]);
    const groups = await Group.findAll({ include: [{ model: GroupMember }] });

    const results = await Promise.all(
      groups.map(async (g) => {
        const memberIds = (g.GroupMembers || []).map((m) => m.borrowerId);
        const membersCount = memberIds.length;

        let totalLoans = 0,
          totalLoanAmount = 0;
        if (Loan && membersCount) {
          totalLoans = await Loan.count({ where: { borrowerId: memberIds } });
          totalLoanAmount =
            (await Loan.sum("amount", { where: { borrowerId: memberIds } })) || 0;
        }
        return {
          id: g.id,
          name: g.name,
          membersCount,
          totalLoans,
          totalLoanAmount,
        };
      })
    );

    res.json(results);
  } catch (error) {
    console.error("groupReports error:", error);
    res.status(500).json({ error: "Failed to fetch group reports" });
  }
};

exports.importGroupMembers = async (req, res) => {
  try {
    if (!Group || !GroupMember)
      return res.status(501).json({ error: "Group membership not available" });
    const g = await Group.findByPk(req.params.groupId);
    if (!g) return res.status(404).json({ error: "Group not found" });

    if (!req.file) return res.status(400).json({ error: "file is required" });
    const buf = req.file.buffer;
    const text = buf.toString("utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);

    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const borrowerIdIdx = header.indexOf("borrowerid");
    if (borrowerIdIdx === -1)
      return res.status(400).json({ error: 'CSV must include a "borrowerId" column' });

    let added = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const borrowerId = cols[borrowerIdIdx];
      if (!borrowerId) continue;

      await GroupMember.findOrCreate({ where: { groupId: g.id, borrowerId } });
      added++;
    }
    res.json({ ok: true, added });
  } catch (error) {
    console.error("importGroupMembers error:", error);
    res.status(500).json({ error: "Failed to import group members" });
  }
};

/* ---------- Import Borrowers ---------- */
exports.importBorrowers = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    if (!req.file) return res.status(400).json({ error: "file is required" });

    const buf = req.file.buffer;
    const text = buf.toString("utf8");

    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return res.status(400).json({ error: "No rows" });

    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const nameIdx = header.indexOf("name");
    const phoneIdx = header.indexOf("phone");
    const nidIdx = header.indexOf("nationalid");

    if (nameIdx === -1)
      return res.status(400).json({ error: 'CSV must include a "name" column' });

    const created = [];
    const existingCols = await getExistingColumns(Borrower);

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const name = cols[nameIdx];
      if (!name) continue;
      const phone = phoneIdx !== -1 ? cols[phoneIdx] : null;
      const nationalId = nidIdx !== -1 ? cols[nidIdx] : null;

      const payload = { status: "active" };
      if (existingCols.includes("name")) payload.name = name;
      if (existingCols.includes("phone")) payload.phone = phone;
      if (existingCols.includes("nationalId")) payload.nationalId = nationalId;

      const b = await Borrower.create(payload);
      created.push(toApi(b));
      if (created.length >= 1000) break;
    }

    res.status(202).json({ received: true, count: created.length, items: created });
  } catch (error) {
    console.error("importBorrowers error:", error);
    res.status(500).json({ error: "Failed to import borrowers" });
  }
};

/* ---------- Reports ---------- */
exports.summaryReport = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: "Borrower not found" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    let loans = [];
    if (Loan) {
      loans = await Loan.findAll({ where: { borrowerId: b.id } });
    }
    const totalDisbursed = loans.reduce((acc, l) => acc + safeNum(l.amount), 0);

    let reps = [];
    if (LoanRepayment && Loan) {
      reps = await LoanRepayment.findAll({
        include: [{ model: Loan, where: { borrowerId: b.id }, attributes: [] }],
      });
    }
    const totalRepayments = reps.reduce(
      (acc, r) => acc + safeNum(r.amountPaid ?? r.amount),
      0
    );

    let balance = 0;
    let txCount = 0;
    if (SavingsTransaction) {
      const txAttrs = await safeAttributes(SavingsTransaction, [
        "id",
        "borrowerId",
        "type",
        "amount",
        "date",
        "notes",
        "reference",
        "status",
        "reversed",
        "createdAt",
        "updatedAt",
      ]);
      const existingCols = await getExistingColumns(SavingsTransaction);
      const hasDate = existingCols.includes("date");

      const txs = await SavingsTransaction.findAll({
        where: { borrowerId: b.id },
        attributes: txAttrs,
        order: hasDate
          ? [["date", "DESC"], ["createdAt", "DESC"]]
          : [["createdAt", "DESC"]],
      });
      txCount = txs.length;

      let dep = 0,
          wdr = 0;
      for (const t of txs) {
        if (t.reversed === true) continue;
        if (t.type === "deposit") dep += safeNum(t.amount);
        else if (t.type === "withdrawal") wdr += safeNum(t.amount);
      }
      balance = dep - wdr;
    }

    res.json({
      borrower: { id: b.id, name: b.name, status: b.status },
      loans: { count: loans.length, totalDisbursed },
      repayments: { count: reps.length, total: totalRepayments },
      savings: { balance, txCount },
      parPercent: Number(b.parPercent || 0),
      overdueAmount: Number(b.overdueAmount || 0),
    });
  } catch (error) {
    console.error("summaryReport error:", error);
    res.status(500).json({ error: "Failed to build report" });
  }
};

exports.globalBorrowerReport = async (req, res) => {
  try {
    if (!Borrower) return res.json({ items: [], total: 0 });
    const { branchId, status } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;

    const borrowers = await Borrower.findAll({ where });

    const report = await Promise.all(
      borrowers.map(async (b) => {
        const id = b.id;
        const loansCount = Loan ? await Loan.count({ where: { borrowerId: id } }) : 0;
        const loansTotal = Loan
          ? (await Loan.sum("amount", { where: { borrowerId: id } })) || 0
          : 0;

        let repaymentsTotal = 0;
        if (LoanRepayment && Loan) {
          repaymentsTotal =
            (await LoanRepayment.sum("amount", {
              include: [{ model: Loan, where: { borrowerId: id }, attributes: [] }],
            })) || 0;
        }
        return {
          id,
          name: b.name,
          status: b.status,
          loansCount,
          loansTotal,
          repaymentsTotal,
        };
      })
    );

    res.json({ items: report, total: report.length });
  } catch (error) {
    console.error("globalBorrowerReport error:", error);
    res.status(500).json({ error: "Failed to generate borrower report" });
  }
};
