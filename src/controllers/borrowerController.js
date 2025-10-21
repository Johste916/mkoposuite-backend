"use strict";

const { Op } = require("sequelize");
const models = require("../models");
const fs = require("fs");
const path = require("path");

const PHONE_CC = "+255";

// Models (nullable-safe)
const Borrower           = models.Borrower || null;
const Loan               = models.Loan || null;
const LoanRepayment      = models.LoanRepayment || null;
const SavingsTransaction = models.SavingsTransaction || null;
const Group              = models.BorrowerGroup || models.Group || null;
const GroupMember        = models.BorrowerGroupMember || models.GroupMember || null;
const BorrowerComment    = models.BorrowerComment || null;
const KYCDocument        = models.KYCDocument || null;
const User               = models.User || null;
const Role               = models.Role || null;
const Branch             = models.Branch || null;

const sequelize = models.sequelize || null;
const _qi = sequelize?.getQueryInterface?.();
const _colCache = new Map();

const likeOp = (sequelize?.getDialect?.() === "postgres") ? Op.iLike : Op.like;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* -------------------- Column helpers -------------------- */
const getExistingColumns = async (Model) => {
  const table = Model?.getTableName?.();
  if (!Model || !table || !_qi) return Object.keys(Model?.rawAttributes || {});
  const key = typeof table === "string" ? table : `${table.schema}.${table.tableName}`;
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

const safeAttributes = async (Model, candidates) => {
  const cols = await getExistingColumns(Model);
  const base = candidates || Object.keys(Model?.rawAttributes || {});
  return base.filter((c) => cols.includes(c));
};

/* -------------------- small utils -------------------- */
const toApi = (b) =>
  b ? { ...(b.toJSON ? b.toJSON() : b), fullName: b.fullName ?? b.name ?? "" } : null;
const safeNum = (v) => Number(v || 0);
const emptyToNull = (v) => (v === "" || typeof v === "undefined" ? null : v);

function hasAnyPermission(req, names = []) {
  try {
    const perms = (req.user?.permissions || []).map((p) => String(p).toLowerCase());
    return names.some((n) => perms.includes(String(n).toLowerCase()));
  } catch {
    return true; // permissive if ACL not wired
  }
}
function canAssignLoanOfficer(req) {
  return hasAnyPermission(req, [
    "borrower.assign",
    "staff.update",
    "loan.assign",
    "borrower.create",
  ]);
}

function normalizePhone(raw, cc = PHONE_CC) {
  if (!raw) return raw;
  let s = String(raw).trim().replace(/[\s-]/g, "");
  if (s.startsWith("+")) return s;
  if (cc && s.startsWith(cc.replace("+", ""))) return `+${s}`;
  if (cc && s.startsWith("0")) return `${cc}${s.slice(1)}`;
  return s.startsWith("+") ? s : `+${s}`;
}

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

/* -------------------- Derived KPIs -------------------- */
async function computeBorrowerDerived(borrowerId) {
  const derived = {
    parPercent: 0,
    overdueAmount: 0,
    netSavings: 0,
    outstanding: 0,
    outstandingLoan: 0,
    outstandingInterest: 0,
  };

  try {
    // Savings
    if (SavingsTransaction) {
      const txAttrs = await safeAttributes(SavingsTransaction, ["type", "amount", "reversed"]);
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

    // Outstanding (total / principal / interest if available)
    if (Loan) {
      const loanAttrs = await safeAttributes(Loan, [
        "id",
        "borrowerId",
        "amount",
        "status",
        "outstanding",
        "outstandingAmount",
        "outstandingTotal",
        "outstandingPrincipal",
        "principalOutstanding",
        "principal_outstanding",
        "outstandingInterest",
        "interestOutstanding",
        "interest_outstanding",
      ]);
      const loans = await Loan.findAll({
        where: { borrowerId },
        attributes: loanAttrs,
        limit: 1000,
      });

      let total = 0,
        p = 0,
        i = 0;
      for (const l of loans) {
        const tot =
          [l.outstanding, l.outstandingAmount, l.outstandingTotal].find(
            (x) => typeof x === "number"
          ) ?? l.amount;
        total += safeNum(tot);

        const pv = [
          l.outstandingPrincipal,
          l.principalOutstanding,
          l.principal_outstanding,
        ].find((x) => typeof x === "number");
        if (pv != null) p += safeNum(pv);

        const iv = [
          l.outstandingInterest,
          l.interestOutstanding,
          l.interest_outstanding,
        ].find((x) => typeof x === "number");
        if (iv != null) i += safeNum(iv);
      }
      derived.outstanding = total;
      derived.outstandingLoan = p || total;
      derived.outstandingInterest = i || 0;
    }

    // Overdue + PAR
    if (LoanRepayment && Loan) {
      const repayAttrs = await safeAttributes(LoanRepayment, [
        "amount",
        "amountPaid",
        "status",
        "dueDate",
        "loanId",
      ]);
      const today = new Date();
      const rows = await LoanRepayment.findAll({
        attributes: repayAttrs,
        include: [{ model: Loan, where: { borrowerId }, attributes: [] }],
        where: {
          [Op.or]: [{ status: { [Op.in]: ["overdue", "due"] } }, { dueDate: { [Op.lt]: today } }],
        },
        limit: 5000,
        order: [["dueDate", "DESC"]],
      });

      let overdue = 0;
      for (const r of rows) {
        const due = safeNum(r.amount);
        const paid = safeNum(r.amountPaid);
        if (due > paid) overdue += due - paid;
      }
      derived.overdueAmount = overdue;
      derived.parPercent =
        derived.outstanding > 0
          ? Number(((overdue / derived.outstanding) * 100).toFixed(2))
          : 0;
    }
  } catch (err) {
    console.warn("computeBorrowerDerived failed:", err?.message || err);
  }

  return derived;
}

function officerPrettyName(officer) {
  if (!officer) return null;

  // Prefer explicit names if they look human (contain a space, not a handle)
  const explicit =
    officer.name ||
    [officer.firstName, officer.lastName].filter(Boolean).join(" ") ||
    null;

  const titleizeLocal = (s) =>
    String(s || "")
      .replace(/[_\.\-]+/g, " ")   // jane.doe -> jane doe
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()); // jane doe -> Jane Doe

  // If we already have a human-looking name, keep it.
  if (explicit && /\s/.test(explicit) && !/^[a-z0-9._-]+$/i.test(explicit)) {
    return explicit.trim();
  }

  // If the "name" is a handle (jane.doe / jdoe), humanize it.
  if (explicit && !explicit.includes("@")) {
    return titleizeLocal(explicit);
  }

  // Last resort: derive from email local-part
  if (officer.email) {
    const local = String(officer.email).split("@")[0];
    return titleizeLocal(local);
  }

  return null;
}

/* ---------- Officer candidate lookup (include-safe) ---------- */
async function buildActiveUserFilter() {
  if (!User) return {};
  try {
    const cols = await getExistingColumns(User);
    if (cols.includes("isActive")) return { isActive: { [Op.not]: false } };
    if (cols.includes("active"))   return { active:   { [Op.not]: false } };
    if (cols.includes("status"))   return { status:   { [Op.notIn]: ["disabled", "inactive"] } };
  } catch {}
  return {};
}

async function findOfficerCandidates({ branchId }) {
  if (!User) return [];
  const canIncludeRoles = !!(User.associations && User.associations.Roles && Role);
  const activeFilter = await buildActiveUserFilter();
  const baseWhere = { ...(branchId ? { branchId } : {}), ...activeFilter };

  if (canIncludeRoles) {
    try {
      return await User.findAll({
        where: baseWhere,
        include: [
          {
            model: Role,
            as: "Roles",
            through: { attributes: [] },
            where: { name: { [likeOp]: "loan officer" } },
            required: true,
          },
        ],
        limit: 1000,
      });
    } catch (e) {
      console.warn("Officer include skipped (association error):", e?.message || e);
    }
  }

  // Manual join via UserRole if available
  try {
    const roleRows = Role
      ? await Role.findAll({ where: { name: { [likeOp]: "loan officer" } }, attributes: ["id"] })
      : [];
    if (roleRows.length && models.UserRole) {
      const roleIds = roleRows.map((r) => r.id);
      const links = await models.UserRole.findAll({
        where: { roleId: { [Op.in]: roleIds } },
        attributes: ["userId"],
      });
      const userIds = links.map((l) => l.userId);
      if (userIds.length) {
        return await User.findAll({
          where: { id: { [Op.in]: userIds }, ...baseWhere },
          limit: 1000,
        });
      }
    }
  } catch (e) {
    console.warn("Officer fallback lookup failed:", e?.message || e);
  }

  // Fallback: string role column
  try {
    return await User.findAll({
      where: { ...baseWhere, role: { [likeOp]: "loan officer" } },
      limit: 1000,
    });
  } catch {
    return [];
  }
}

/* ================================ CRUD ================================ */
exports.getAllBorrowers = async (req, res) => {
  try {
    if (!Borrower) return res.json({ items: [], total: 0 });
    const {
      q = "",
      branchId,
      officerId,
      status,
      page = 1,
      pageSize = 50,
      sort = "createdAt",
      dir = "desc",
    } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (officerId) where.loanOfficerId = officerId;
    if (status) where.status = status;
    if (q) {
      where[Op.or] = [
        { name: { [likeOp]: `%${q}%` } },
        { phone: { [likeOp]: `%${q}%` } },
        { nationalId: { [likeOp]: `%${q}%` } },
        { idNumber: { [likeOp]: `%${q}%` } },
        { customerNumber: { [likeOp]: `%${q}%` } },
      ];
    }

    const limit = Math.max(1, Number(pageSize));
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    const attributes = [
      "id",
      "name",
      "nationalId",
      "phone",
      "address",
      "branchId",
      "loanOfficerId",
      "status",
      "createdAt",
      "updatedAt",
    ].filter((a) => Borrower.rawAttributes[a]);

    const include = [];
    if (Branch && Borrower.associations?.Branch) {
      include.push({ model: Branch, as: "Branch", attributes: ["id", "name"] });
    }
    if (User && Borrower.associations?.loanOfficer) {
      include.push({
        model: User,
        as: "loanOfficer",
        attributes: ["id", "name", "firstName", "lastName"],
      });
    }

    const safeOrders = [];
    const dirSql = String(dir).toUpperCase() === "ASC" ? "ASC" : "DESC";
    const sortKey = String(sort);
    if (["name", "phone", "status", "createdAt", "updatedAt"].includes(sortKey)) {
      safeOrders.push([sortKey, dirSql]);
    } else if (sortKey === "branchName") {
      safeOrders.push([{ model: Branch, as: "Branch" }, "name", dirSql]);
    } else if (sortKey === "officerName") {
      safeOrders.push([{ model: User, as: "loanOfficer" }, "name", dirSql]);
    } else {
      safeOrders.push(["createdAt", "DESC"]);
    }

    const { rows, count } = await Borrower.findAndCountAll({
      where,
      attributes,
      include,
      order: safeOrders,
      limit,
      offset,
    });

    const items = await Promise.all(
      rows.map(async (b) => {
        const j = toApi(b);
        if (j.phone) j.phone = normalizePhone(j.phone);
        j.branchName = b.Branch?.name ?? j.branchName ?? null;
        j.officerName = officerPrettyName(b.loanOfficer) ?? j.officerName ?? null;

        const d = await computeBorrowerDerived(b.id);
        return { ...j, outstanding: d.outstanding };
      })
    );

    res.json({ items, total: count });
  } catch (error) {
    console.error("getAllBorrowers error:", error);
    res.status(500).json({ error: "Failed to fetch borrowers" });
  }
};

exports.createBorrower = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });

    const existingCols = await getExistingColumns(Borrower);
    const b = req.body || {};
    const firstName = (b.firstName || "").trim();
    const lastName = (b.lastName || "").trim();
    const displayName = (b.name || b.fullName || `${firstName} ${lastName}`.trim()).trim();
    if (!displayName) return res.status(400).json({ error: "name is required" });
    // NEW (optional but aligns with your DB):
if (existingCols.includes("firstName")) payload.firstName = b.firstName || null;
if (existingCols.includes("lastName"))  payload.lastName  = b.lastName  || null;
if (existingCols.includes("secondaryPhone"))
  payload.secondaryPhone = normalizePhone(b.secondaryPhone || null);

// if your DB has addressLine separate from address
if (existingCols.includes("addressLine"))
  payload.addressLine = b.addressLine || null;


    // Branch handling and validation
    const needsBranchId =
      !!Borrower.rawAttributes.branchId && Borrower.rawAttributes.branchId.allowNull === false;
    let branchIdToUse =
      b.branchId || req.headers["x-branch-id"] || req.user?.branchId || null;
    if (branchIdToUse === "") branchIdToUse = null;

    if ((needsBranchId && !branchIdToUse) || (branchIdToUse != null && Branch)) {
      if (!branchIdToUse) return res.status(400).json({ error: "branchId is required" });
      const exists = await Branch.findByPk(branchIdToUse);
      if (!exists) return res.status(400).json({ error: "branchId not found", branchId: branchIdToUse });
    }

    // Officer assignment
    let desiredOfficerId = b.loanOfficerId || b.officerId || null;

    if (desiredOfficerId != null) {
      if (!canAssignLoanOfficer(req)) {
        return res.status(403).json({ error: "You are not allowed to assign a loan officer." });
      }
      if (!User) return res.status(500).json({ error: "User model not available for assignment" });

      const canIncludeRoles = !!(User.associations && User.associations.Roles && Role);
      let officer;
      if (canIncludeRoles) {
        officer = await User.findByPk(desiredOfficerId, {
          include: [{ model: Role, as: "Roles", through: { attributes: [] } }],
        });
      } else {
        officer = await User.findByPk(desiredOfficerId);
      }
      if (!officer) return res.status(400).json({ error: "loanOfficerId not found" });

      const isOfficer =
        (String(officer.role || "").toLowerCase() === "loan officer") ||
        (officer.Roles || []).some((r) => (String(r.name) || "").toLowerCase() === "loan officer");

      if (!isOfficer) return res.status(400).json({ error: "Selected user is not a Loan Officer" });
      if (branchIdToUse && officer.branchId && String(officer.branchId) !== String(branchIdToUse)) {
        return res.status(400).json({ error: "Loan Officer not in selected branch" });
      }
    }

    if (!desiredOfficerId) {
      const candidates = await findOfficerCandidates({ branchId: branchIdToUse || null });
      if (candidates.length) {
        const counts = {};
        for (const u of candidates) {
          counts[u.id] = Loan
            ? await Loan.count({
                where: {
                  loanOfficerId: u.id,
                  status: { [Op.notIn]: ["closed", "rejected", "cancelled"] },
                },
              })
            : 0;
        }
        desiredOfficerId =
          candidates.sort((a, b) => counts[a.id] - counts[b.id])[0]?.id ?? null;
      }
    }

    // Payload (guard by existing columns)
    const payload = {};
    if (existingCols.includes("name")) payload.name = displayName;
    if (existingCols.includes("nationalId"))
      payload.nationalId = b.nationalId || b.idNumber || null;
    if (existingCols.includes("phone")) payload.phone = normalizePhone(b.phone || null);
    if (existingCols.includes("email")) payload.email = b.email || null;
    if (existingCols.includes("address")) payload.address = b.addressLine || b.address || null;
    if (existingCols.includes("status")) payload.status = b.status || "active";
    if ((existingCols.includes("branch_id") || existingCols.includes("branchId")) && branchIdToUse != null)
      payload.branchId = branchIdToUse;

    if (existingCols.includes("gender")) payload.gender = b.gender || null;
    if (existingCols.includes("birthDate")) payload.birthDate = b.birthDate || null;
    if (existingCols.includes("employmentStatus"))
      payload.employmentStatus = b.employmentStatus || null;
    if (existingCols.includes("occupation")) payload.occupation = b.occupation || b.businessType || null;
    if (existingCols.includes("idType")) payload.idType = b.idType || null;
    if (existingCols.includes("idIssuedDate")) payload.idIssuedDate = b.idIssuedDate || null;
    if (existingCols.includes("idExpiryDate")) payload.idExpiryDate = b.idExpiryDate || null;
    if (existingCols.includes("nextKinName")) payload.nextKinName = b.nextKinName || null;
    if (existingCols.includes("nextKinPhone"))
      payload.nextKinPhone = normalizePhone(b.nextKinPhone || null);
    if (existingCols.includes("nextOfKinRelationship"))
      payload.nextOfKinRelationship = b.nextOfKinRelationship || b.kinRelationship || null;

    // NEWs
    if (existingCols.includes("maritalStatus")) payload.maritalStatus = b.maritalStatus ?? null;
    if (existingCols.includes("educationLevel")) payload.educationLevel = b.educationLevel ?? null;
    if (existingCols.includes("customerNumber"))
      payload.customerNumber = b.customerNumber ?? b.customerNo ?? null;
    if (existingCols.includes("tin")) payload.tin = b.tin ?? null;
    if (existingCols.includes("nationality")) payload.nationality = b.nationality ?? null;
    if (existingCols.includes("loanType")) payload.loanType = b.loanType ?? "individual";
    if (existingCols.includes("regDate"))
      payload.regDate = b.regDate ?? b.registrationDate ?? null;
    if (existingCols.includes("groupId"))
      payload.groupId = b.loanType === "group" ? b.groupId || null : b.groupId ?? null;

    if (existingCols.includes("loanOfficerId") || existingCols.includes("loan_officer_id")) {
      payload.loanOfficerId = desiredOfficerId || null;
    }

    const created = await Borrower.create(payload);

    // Photo
    const file =
      req.file ||
      (Array.isArray(req.files) && req.files.find((f) => f.fieldname === "photo")) ||
      null;
    const photoUrl = await maybePersistPhoto(created.id, file);
    if (photoUrl && existingCols.includes("photoUrl")) await created.update({ photoUrl });

    // include names
    let branchName = null,
      officerName = null;
    if ((Branch && Borrower.associations?.Branch) || (User && Borrower.associations?.loanOfficer)) {
      const reloaded = await Borrower.findByPk(created.id, {
        include: [
          ...(Branch && Borrower.associations?.Branch
            ? [{ model: Branch, as: "Branch", attributes: ["id", "name"] }]
            : []),
          ...(User && Borrower.associations?.loanOfficer
            ? [{ model: User, as: "loanOfficer", attributes: ["id", "name", "firstName", "lastName"] }]
            : []),
        ],
      });
      branchName = reloaded?.Branch?.name ?? null;
      officerName = officerPrettyName(reloaded?.loanOfficer);
    }

    const derived = await computeBorrowerDerived(created.id);
    const out = { ...toApi(created), ...derived, branchName, officerName };
    if (out.phone) out.phone = normalizePhone(out.phone);
    res.status(201).json(out);
  } catch (error) {
    console.error("createBorrower error:", error);
    res.status(500).json({ error: "Failed to create borrower" });
  }
};

exports.getBorrowerById = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: "Borrower not found" });

    const include = [];
    if (Branch && Borrower.associations?.Branch) {
      include.push({ model: Branch, as: "Branch", attributes: ["id", "name"] });
    }
    if (User && Borrower.associations?.loanOfficer) {
      include.push({ model: User, as: "loanOfficer", attributes: ["id", "name", "firstName", "lastName"] });
    }

    const b = await Borrower.findByPk(req.params.id, { include });
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    const derived = await computeBorrowerDerived(b.id);
    const out = {
      ...toApi(b),
      ...derived,
      branchName: b.Branch?.name ?? null,
      officerName: officerPrettyName(b.loanOfficer),
    };
    if (out.phone) out.phone = normalizePhone(out.phone);
    res.json(out);
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

    // Single-branch policy
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
      // if assigning first time, validate existence
      if (!current && Branch && branchId != null) {
        const exists = await Branch.findByPk(branchId);
        if (!exists) return res.status(400).json({ error: "branchId not found", branchId });
      }
    }

    const cols = await getExistingColumns(Borrower);
    const body = req.body || {};
    const patch = {};
    const setIf = (key, value) => {
      if (cols.includes(key) && typeof value !== "undefined") patch[key] = value;
    };

    // Core
    setIf("name", body.name ?? body.fullName);
    setIf("nationalId", body.nationalId ?? body.idNumber);
    if (typeof body.phone !== "undefined") setIf("phone", normalizePhone(body.phone));
    setIf("email", body.email);
    setIf("address", body.address ?? body.addressLine);
    setIf("status", body.status);

    // Assignment (first set)
    if (Borrower.rawAttributes.branchId) {
      if (!b.branchId && typeof body.branchId !== "undefined") {
        if (cols.includes("branchId") || cols.includes("branch_id")) patch.branchId = body.branchId;
      }
    }

    // Officer
    const wantOfficer = body.officerId ?? body.loanOfficerId;
    if (typeof wantOfficer !== "undefined") {
      if (cols.includes("loanOfficerId") || cols.includes("loan_officer_id")) {
        patch.loanOfficerId = wantOfficer;
      }
    }

    // KYC-ish
    setIf("gender", body.gender);
    setIf("birthDate", body.birthDate || null);
    setIf("employmentStatus", body.employmentStatus);
    setIf("occupation", body.occupation);
    setIf("idType", body.idType);
    setIf("idIssuedDate", body.idIssuedDate || null);
    setIf("idExpiryDate", body.idExpiryDate || null);
    if (typeof body.nextKinPhone !== "undefined")
      setIf("nextKinPhone", normalizePhone(body.nextKinPhone));
    setIf("nextKinName", body.nextKinName);
    setIf("nextOfKinRelationship", body.nextOfKinRelationship);

    // NEW: names, extra contact, and address line
setIf("firstName", body.firstName);
setIf("lastName",  body.lastName);
if (typeof body.secondaryPhone !== "undefined")
  setIf("secondaryPhone", normalizePhone(body.secondaryPhone));
setIf("addressLine", body.addressLine);


    // misc
    setIf("groupId", body.groupId);
    setIf("loanType", body.loanType);
    setIf("regDate", body.regDate ?? body.registrationDate ?? null);

    // new fields
    setIf("maritalStatus", body.maritalStatus);
    setIf("educationLevel", body.educationLevel);
    setIf("customerNumber", body.customerNumber ?? body.customerNo);
    setIf("tin", body.tin);
    setIf("nationality", body.nationality);

    await b.update(patch);

    // Reload with associations so UI gets names immediately
    const include = [];
    if (Branch && Borrower.associations?.Branch) {
      include.push({ model: Branch, as: "Branch", attributes: ["id", "name"] });
    }
    if (User && Borrower.associations?.loanOfficer) {
      include.push({ model: User, as: "loanOfficer", attributes: ["id", "name", "firstName", "lastName"] });
    }
    const reloaded = await Borrower.findByPk(b.id, { include });

    const derived = await computeBorrowerDerived(b.id);
    const out = {
      ...toApi(reloaded),
      ...derived,
      branchName: reloaded?.Branch?.name ?? null,
      officerName: officerPrettyName(reloaded?.loanOfficer),
    };
    if (out.phone) out.phone = normalizePhone(out.phone);
    res.json(out);
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

/* ---------- Explicit Branch Assign/Unassign ---------- */
exports.assignBranch = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    if (!Borrower.rawAttributes.branchId)
      return res.status(422).json({ error: "Borrower model has no branchId column" });

    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    const newBranchId = Number.parseInt(String(req.body?.branchId), 10);
    if (!Number.isFinite(newBranchId))
      return res.status(400).json({ error: "branchId must be an integer" });

    if (Branch) {
      const exists = await Branch.findByPk(newBranchId);
      if (!exists) return res.status(400).json({ error: "branchId not found", branchId: newBranchId });
    }

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

    if (!current) await b.update({ branchId: newBranchId });

    const derived = await computeBorrowerDerived(b.id);
    return res.json({
      ok: true,
      borrowerId: b.id,
      branchId: b.branchId ?? newBranchId,
      ...derived,
    });
  } catch (error) {
    console.error("assignBranch error:", error);
    return res.status(500).json({ error: "Failed to assign branch" });
  }
};

exports.unassignBranch = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    if (!Borrower.rawAttributes.branchId)
      return res.status(422).json({ error: "Borrower model has no branchId column" });

    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    const allowNull = Borrower.rawAttributes.branchId.allowNull !== false;
    if (!allowNull) {
      return res.status(422).json({
        error: "This environment does not allow unassign (branchId is NOT NULL).",
        hint: "Reassignment is blocked by policy; contact admin if a transfer workflow is needed.",
      });
    }

    if (b.branchId == null) {
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

/* -------------------- Loan Officers (new) -------------------- */
exports.listLoanOfficers = async (req, res) => {
  try {
    const branchId = req.query.branchId || null;
    const users = await findOfficerCandidates({ branchId });
    const items = users.map((u) => ({
      id: u.id,
      name: officerPrettyName(u) || u.email || `User ${u.id}`,
      branchId: u.branchId ?? null,
      email: u.email ?? null,
    }));
    res.json({ items, total: items.length });
  } catch (err) {
    console.error("listLoanOfficers error:", err);
    res.status(500).json({ error: "Failed to fetch loan officers" });
  }
};

exports.assignOfficer = async (req, res) => {
  try {
    if (!Borrower || !User) return res.status(501).json({ error: "Models not available" });
    const borrowerId = req.params.id;
    const { loanOfficerId } = req.body || {};
    if (!loanOfficerId) return res.status(400).json({ error: "loanOfficerId is required" });

    const b = await Borrower.findByPk(borrowerId);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    if (!canAssignLoanOfficer(req))
      return res.status(403).json({ error: "Not allowed to assign a loan officer" });

    const canIncludeRoles = !!(User.associations && User.associations.Roles && Role);
    const officer = await User.findByPk(loanOfficerId, {
      include: canIncludeRoles ? [{ model: Role, as: "Roles", through: { attributes: [] } }] : [],
    });
    if (!officer) return res.status(400).json({ error: "loanOfficerId not found" });

    const isOfficer =
      (String(officer.role || "").toLowerCase() === "loan officer") ||
      (officer.Roles || []).some((r) => (String(r.name) || "").toLowerCase() === "loan officer");
    if (!isOfficer) return res.status(400).json({ error: "Selected user is not a Loan Officer" });

    if (b.branchId && officer.branchId && String(officer.branchId) !== String(b.branchId)) {
      return res.status(400).json({ error: "Loan Officer not in the borrower’s branch" });
    }

    const cols = await getExistingColumns(Borrower);
    if (!(cols.includes("loanOfficerId") || cols.includes("loan_officer_id"))) {
      return res.status(422).json({ error: "Borrower model has no loanOfficerId column" });
    }

    await b.update({ loanOfficerId });
    return res.json({
      id: b.id,
      loanOfficerId,
      officerName: officerPrettyName(officer),
    });
  } catch (err) {
    console.error("assignOfficer error:", err);
    res.status(500).json({ error: "Failed to assign officer" });
  }
};

exports.unassignOfficer = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    if (!canAssignLoanOfficer(req))
      return res.status(403).json({ error: "Not allowed to unassign officer" });

    const cols = await getExistingColumns(Borrower);
    if (!(cols.includes("loanOfficerId") || cols.includes("loan_officer_id"))) {
      return res.status(422).json({ error: "Borrower model has no loanOfficerId column" });
    }

    await b.update({ loanOfficerId: null });
    res.json({ id: b.id, loanOfficerId: null });
  } catch (err) {
    console.error("unassignOfficer error:", err);
    res.status(500).json({ error: "Failed to unassign officer" });
  }
};

/* -------------------- Nested -------------------- */
exports.getLoansByBorrower = async (req, res) => {
  try {
    if (!Loan) return res.json([]);

    // Load borrower to get createdAt for strict filtering
    const borrower = await Borrower.findByPk(req.params.id, { attributes: ["id", "createdAt"] });
    if (!borrower) return res.json([]);

    const loanCols = await getExistingColumns(Loan);
    const strict = String(req.query.strict ?? "true").toLowerCase() !== "false";

    const where = { borrowerId: borrower.id };
    if (strict && loanCols.includes("createdAt")) {
      // Prevent showing stale/legacy loans attached by reused IDs
      where.createdAt = { [Op.gte]: borrower.createdAt };
    }

    const rows = await Loan.findAll({
      where,
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

/* -------------------- Comments -------------------- */
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

/* -------------------- Savings -------------------- */
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

/* -------------------- Blacklist -------------------- */
exports.blacklist = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    // read from body; tolerate empty strings
    const reason = (req.body?.reason || "").trim() || null;
    const until  = req.body?.until ? new Date(req.body.until) : null;

    await b.update({
      status: "blacklisted",
      blacklistReason: reason,
      blacklistUntil:  until,
      blacklistedAt:   new Date(),
    });

    const derived = await computeBorrowerDerived(b.id);
    res.json({
      id: b.id,
      status: b.status,
      reason: b.blacklistReason,
      until:  b.blacklistUntil,
      
      blacklistReason: b.blacklistReason,
      blacklistUntil:  b.blacklistUntil,
      blacklistedAt:   b.blacklistedAt,
      ...derived,
    });
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

    await b.update({
      status: "active",
      blacklistReason: null,
      blacklistUntil:  null,
      blacklistedAt:   null,
    });

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
    const borrowers = await Borrower.findAll({
      where: { status: "blacklisted" },
      order: [["blacklistedAt", "DESC"]],
    });

    const items = borrowers.map((b) => {
      const j = b.toJSON ? b.toJSON() : b;
      const phone = j.phone ? normalizePhone(j.phone) : null;

      return {
        id: j.id,
        name: j.name || null,
        firstName: j.firstName || null,
        lastName: j.lastName || null,
        phone,

        // what the FE wants:
        reason: j.blacklistReason || null,
        until:  j.blacklistUntil  || null,

        // keep originals too (harmless)
        blacklistReason: j.blacklistReason || null,
        blacklistUntil:  j.blacklistUntil  || null,
        blacklistedAt:   j.blacklistedAt   || null,

        status: j.status || "blacklisted",
      };
    });

    res.json(items);
  } catch (error) {
    console.error("listBlacklisted error:", error);
    res.status(500).json({ error: "Failed to fetch blacklisted borrowers" });
  }
};

/* -------------------- KYC -------------------- */
exports.uploadKyc = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: "Borrower not found" });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: "Borrower not found" });

    const files = (req.files || (req.file ? [req.file] : [])).map((f) => ({
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

/* -------------------- Groups -------------------- */
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
        return { id: g.id, name: g.name, membersCount, totalLoans, totalLoanAmount };
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

/* -------------------- Import Borrowers -------------------- */
function splitCSVLine(line) {
  // Split by commas not inside quotes
  return (
    line
      .match(/(?<=^|,)(?:"[^"]*"|[^,]*)/g)
      ?.map((s) => {
        const trimmed = s.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
          return trimmed.slice(1, -1).replace(/""/g, '"');
        }
        return trimmed;
      }) || []
  );
}

exports.importBorrowers = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: "Borrower model not available" });
    if (!req.file) return res.status(400).json({ error: "file is required" });

    const buf = req.file.buffer;
    const text = buf.toString("utf8");

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= 1) return res.status(400).json({ error: "No rows" });

    const header = splitCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
    const nameIdx = header.indexOf("name");
    const phoneIdx = header.indexOf("phone");
    const nidIdx = header.indexOf("nationalid");
    const branchIdIdx = header.indexOf("branchid");
    const officerIdIdx = header.indexOf("officerid");
    const statusIdx = header.indexOf("status");

    if (nameIdx === -1)
      return res.status(400).json({ error: 'CSV must include a "name" column' });

    const created = [];
    const existingCols = await getExistingColumns(Borrower);

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCSVLine(lines[i]);
      const name = cols[nameIdx];
      if (!name) continue;

      const phone = phoneIdx !== -1 ? normalizePhone(cols[phoneIdx]) : null;
      const nationalId = nidIdx !== -1 ? cols[nidIdx] || null : null;

      const payload = { status: "active" };
      if (existingCols.includes("name")) payload.name = name;
      if (existingCols.includes("phone")) payload.phone = phone;
      if (existingCols.includes("nationalId")) payload.nationalId = nationalId;

      if (existingCols.includes("branch_id") || existingCols.includes("branchId")) {
        const raw = branchIdIdx !== -1 ? cols[branchIdIdx] : null;
        if (raw && Number.isFinite(Number(raw))) payload.branchId = Number(raw);
      }

      if (existingCols.includes("loanOfficerId") || existingCols.includes("loan_officer_id")) {
        const raw = officerIdIdx !== -1 ? cols[officerIdIdx] : null;
        if (raw) {
          if (UUID_RE.test(raw)) payload.loanOfficerId = raw;
                    else if (Number.isFinite(Number(raw))) payload.loanOfficerId = Number(raw);
        }
      }

      if (existingCols.includes("status") && statusIdx !== -1 && cols[statusIdx]) {
        payload.status = String(cols[statusIdx]).toLowerCase();
      }

      let row;
      if (existingCols.includes("nationalId") && nationalId) {
        const [r, createdFlag] = await Borrower.findOrCreate({
          where: { nationalId },
          defaults: payload,
        });
        if (!createdFlag) {
          const patch = {};
          if (existingCols.includes("phone") && phone && !r.phone) patch.phone = phone;
          if (existingCols.includes("name") && name && r.name !== name) patch.name = name;
          if (Object.keys(patch).length) await r.update(patch);
        }
        row = r;
      } else {
        row = await Borrower.create(payload);
      }

      created.push(toApi(row));
      if (created.length >= 5000) break;
    }

    const items = created.map((j) => {
      const x = { ...j };
      if (x.phone) x.phone = normalizePhone(x.phone);
      return x;
    });

    res.status(202).json({ received: true, count: items.length, items });
  } catch (error) {
    console.error("importBorrowers error:", error);
    res.status(500).json({ error: "Failed to import borrowers" });
  }
};

/* -------------------- Reports -------------------- */
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
        order: hasDate ? [["date", "DESC"], ["createdAt", "DESC"]] : [["createdAt", "DESC"]]
      });
      txCount = txs.length;

      let dep = 0, wdr = 0;
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
