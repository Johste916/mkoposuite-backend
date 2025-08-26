"use strict";

const { Op } = require("sequelize");
const { sequelize } = require("../models");

// -- Runtime model getter (nice error if missing) --
const getModel = (n) => {
  const m = sequelize?.models?.[n];
  if (!m) throw Object.assign(new Error(`Model "${n}" not found`), { status: 500, expose: true });
  return m;
};

// -- DB-safe helpers ---------------------------------------------------------
const _qi = sequelize?.getQueryInterface?.();
const _colCache = new Map();

/** Cache and return real DB columns for a model. */
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

/** Pick only keys present in Model.rawAttributes (for writes). */
const pick = (m, body) =>
  !m.rawAttributes ? body : Object.fromEntries(Object.entries(body).filter(([k]) => m.rawAttributes[k]));

/** Build a DB-safe attributes array. If `candidates` omitted, use all model attributes. */
const safeAttributes = async (Model, candidates) => {
  const cols = await getExistingColumns(Model);
  const base = candidates || Object.keys(Model?.rawAttributes || {});
  return base.filter((c) => cols.includes(c));
};

/** Build a DB-safe search filter for q across allowed fields. */
const buildSearchWhere = (cols, q) => {
  if (!q) return {};
  const fields = ["type", "reference", "notes"]; // try these if present
  const present = fields.filter((f) => cols.includes(f));
  return present.length
    ? { [Op.or]: present.map((f) => ({ [f]: { [Op.iLike]: `%${q}%` } })) }
    : {};
};

// ---------------------------------------------------------------------------

exports.list = async (req, res) => {
  try {
    const Model = getModel("SavingsTransaction");
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 200);
    const offset = (page - 1) * limit;

    const cols = await getExistingColumns(Model);
    const where = { ...buildSearchWhere(cols, req.query.q) };
    if (req.query.borrowerId) where.borrowerId = req.query.borrowerId;
    if (req.query.type) where.type = req.query.type;
    if (req.query.status) where.status = req.query.status;

    if (req.query.start || req.query.end) {
      const field = cols.includes("date") ? "date" : cols.includes("createdAt") ? "createdAt" : null;
      if (field) {
        where[field] = {};
        if (req.query.start) where[field][Op.gte] = req.query.start;
        if (req.query.end) where[field][Op.lte] = req.query.end;
      }
    }

    const attributes = await safeAttributes(Model, [
      "id",
      "borrowerId",
      "type",
      "amount",
      "date",
      "notes",
      "reference", // auto-skipped if not in DB
      "status",
      "createdBy",
      "approvedBy",
      "approvedAt",
      "approvalComment",
      "reversed",
      "createdAt",
      "updatedAt",
    ]);

    const order = cols.includes("date")
      ? [["date", "DESC"], ["createdAt", "DESC"]]
      : [["createdAt", "DESC"]];

    const { rows, count } = await Model.findAndCountAll({
      where,
      attributes,
      order,
      limit,
      offset,
    });

    res.json({ data: rows, pagination: { page, limit, total: count } });
  } catch (error) {
    console.error("savingsTransactions.list error:", error);
    res.status(500).json({ error: "Failed to list transactions" });
  }
};

exports.get = async (req, res) => {
  try {
    const Model = getModel("SavingsTransaction");
    const attributes = await safeAttributes(Model); // all safe columns
    const row = await Model.findByPk(req.params.id, { attributes });
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (error) {
    console.error("savingsTransactions.get error:", error);
    res.status(500).json({ error: "Failed to get transaction" });
  }
};

exports.create = async (req, res) => {
  try {
    const Model = getModel("SavingsTransaction");
    const body = pick(Model, req.body || {});
    if (!body.type || !["deposit", "withdrawal", "charge", "interest"].includes(body.type)) {
      return res.status(400).json({ error: "Invalid type" });
    }
    if (!body.status) body.status = "pending";
    if (!body.createdBy && req.user?.id) body.createdBy = String(req.user.id);
    const created = await Model.create(body);
    res.status(201).json(created);
  } catch (error) {
    console.error("savingsTransactions.create error:", error);
    res.status(500).json({ error: "Failed to create transaction" });
  }
};

exports.bulkCreate = async (req, res) => {
  try {
    const Model = getModel("SavingsTransaction");
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "No items" });
    const mapped = items.map((x) => {
      const p = pick(Model, x || {});
      if (!p.status) p.status = "pending";
      if (!p.createdBy && req.user?.id) p.createdBy = String(req.user.id);
      return p;
    });
    const created = await Model.bulkCreate(mapped, { returning: true });
    res.status(201).json({ count: created.length });
  } catch (error) {
    console.error("savingsTransactions.bulkCreate error:", error);
    res.status(500).json({ error: "Failed to create transactions" });
  }
};

exports.update = async (req, res) => {
  try {
    const Model = getModel("SavingsTransaction");
    const attributes = await safeAttributes(Model);
    const row = await Model.findByPk(req.params.id, { attributes });
    if (!row) return res.status(404).json({ error: "Not found" });
    await row.update(pick(Model, req.body || {}));
    res.json(row);
  } catch (error) {
    console.error("savingsTransactions.update error:", error);
    res.status(500).json({ error: "Failed to update transaction" });
  }
};

exports.reverse = async (req, res) => {
  try {
    const Model = getModel("SavingsTransaction");
    const attributes = await safeAttributes(Model);
    const row = await Model.findByPk(req.params.id, { attributes });
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.reversed === true) return res.json(row);
    await row.update({ reversed: true });
    res.json(row);
  } catch (error) {
    console.error("savingsTransactions.reverse error:", error);
    res.status(500).json({ error: "Failed to reverse transaction" });
  }
};

exports.approve = async (req, res) => {
  try {
    const Model = getModel("SavingsTransaction");
    const attributes = await safeAttributes(Model);
    const row = await Model.findByPk(req.params.id, { attributes });
    if (!row) return res.status(404).json({ error: "Not found" });
    const comment = (req.body?.comment || req.query?.comment || "").trim();
    if (!comment) return res.status(400).json({ error: "approval comment is required" });
    await row.update({
      status: "approved",
      approvedBy: req.user?.id ? String(req.user.id) : null,
      approvedAt: new Date(),
      approvalComment: comment,
    });
    res.json(row);
  } catch (error) {
    console.error("savingsTransactions.approve error:", error);
    res.status(500).json({ error: "Failed to approve transaction" });
  }
};

exports.reject = async (req, res) => {
  try {
    const Model = getModel("SavingsTransaction");
    const attributes = await safeAttributes(Model);
    const row = await Model.findByPk(req.params.id, { attributes });
    if (!row) return res.status(404).json({ error: "Not found" });
    const comment = (req.body?.comment || req.query?.comment || "").trim();
    if (!comment) return res.status(400).json({ error: "rejection comment is required" });
    await row.update({
      status: "rejected",
      approvedBy: req.user?.id ? String(req.user.id) : null,
      approvedAt: new Date(),
      approvalComment: comment,
    });
    res.json(row);
  } catch (error) {
    console.error("savingsTransactions.reject error:", error);
    res.status(500).json({ error: "Failed to reject transaction" });
  }
};

exports.remove = async (req, res) => {
  try {
    const Model = getModel("SavingsTransaction");
    const attributes = await safeAttributes(Model);
    const row = await Model.findByPk(req.params.id, { attributes });
    if (!row) return res.status(404).json({ error: "Not found" });
    await row.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error("savingsTransactions.remove error:", error);
    res.status(500).json({ error: "Failed to delete transaction" });
  }
};

exports.staffReport = async (req, res) => {
  try {
    const Model = getModel("SavingsTransaction");
    const cols = await getExistingColumns(Model);
    const attrs = await safeAttributes(Model, [
      "id",
      "type",
      "amount",
      "status",
      "createdBy",
      "date",
      "createdAt",
    ]);

    const where = {};
    const rangeField = cols.includes("date")
      ? "date"
      : cols.includes("createdAt")
      ? "createdAt"
      : null;

    if (req.query.start || req.query.end) {
      if (rangeField) {
        where[rangeField] = {};
        if (req.query.start) where[rangeField][Op.gte] = req.query.start;
        if (req.query.end) where[rangeField][Op.lte] = req.query.end;
      }
    }

    const list = await Model.findAll({
      where,
      attributes: attrs,
      order: [["createdBy", "ASC"], [rangeField || "createdAt", "ASC"]],
    });

    const map = new Map();
    for (const t of list) {
      const k = t.createdBy || 0;
      if (!map.has(k)) {
        map.set(k, {
          staffId: k,
          staffName: null,
          deposit: 0,
          withdrawal: 0,
          charge: 0,
          interest: 0,
          approvedCount: 0,
          pendingCount: 0,
          rejectedCount: 0,
        });
      }
      const r = map.get(k);
      const amt = Number(t.amount || 0);
      if (t.type === "deposit") r.deposit += amt;
      else if (t.type === "withdrawal") r.withdrawal += amt;
      else if (t.type === "charge") r.charge += amt;
      else if (t.type === "interest") r.interest += amt;

      if (t.status === "approved") r.approvedCount++;
      else if (t.status === "pending") r.pendingCount++;
      else if (t.status === "rejected") r.rejectedCount++;
    }

    res.json(Array.from(map.values()));
  } catch (error) {
    console.error("savingsTransactions.staffReport error:", error);
    res.status(500).json({ error: "Failed to build staff report" });
  }
};
