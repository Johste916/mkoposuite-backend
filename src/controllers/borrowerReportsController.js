"use strict";

/**
 * Defensive borrower reporting that adapts to your actual DB columns.
 * - Works whether Borrowers has `status`, `isActive`, or neither.
 * - Uses `createdAt` but gracefully falls back to raw/`created_at`.
 * - Counts borrowers who have at least one loan (distinct borrowerId).
 */

const { Op } = require("sequelize");
const models = require("../models");
const {
  startOfMonth, endOfMonth,
} = require("date-fns");

const sequelize = models.sequelize;

// ---------- tiny safety helpers ----------
const safeCount = async (Model, opts = {}) => {
  try {
    if (!Model) return 0;
    const v = await Model.count(opts);
    return Number(v || 0);
  } catch {
    return 0;
  }
};

/** Try count by a date range for a model, handling createdAt/created_at */
async function countCreatedBetween(Model, start, end) {
  if (!Model) return 0;

  // 1) createdAt as attribute
  try {
    return await Model.count({ where: { createdAt: { [Op.between]: [start, end] } } });
  } catch {}

  // 2) raw createdAt column
  try {
    return await Model.count({
      where: sequelize.where(sequelize.col(`"${Model.name}"."createdAt"`), { [Op.between]: [start, end] }),
    });
  } catch {}

  // 3) raw created_at column
  try {
    return await Model.count({
      where: sequelize.where(sequelize.col(`"${Model.name}"."created_at"`), { [Op.between]: [start, end] }),
    });
  } catch {}

  return 0;
}

/** Check if a physical column exists on a model's table (cached). */
const _colExistsCache = new Map();
async function columnExists(Model, column) {
  if (!Model?.sequelize) return false;
  let tn = Model.getTableName ? Model.getTableName() : Model.tableName || Model.name;
  if (typeof tn === "object") tn = tn.tableName || tn.toString();
  const key = `${tn}::${column}`;
  if (_colExistsCache.has(key)) return _colExistsCache.get(key);

  const qi = Model.sequelize.getQueryInterface();
  const tryDescribe = async (table) => {
    try {
      const desc = await qi.describeTable(table);
      return !!desc[column];
    } catch {
      return false;
    }
  };

  let exists = await tryDescribe(tn);
  if (!exists) exists = await tryDescribe(String(tn).toLowerCase());
  _colExistsCache.set(key, exists);
  return exists;
}

// ---------- controller ----------
exports.getBorrowerSummary = async (_req, res) => {
  try {
    const Borrower = models.Borrower || null;
    const Loan     = models.Loan || null;

    if (!Borrower) {
      return res.json({
        total: 0,
        active: 0,
        blacklisted: 0,
        withLoans: 0,
        newThisMonth: 0,
      });
    }

    const [hasStatus, hasIsActive, hasBlacklisted] = await Promise.all([
      columnExists(Borrower, "status"),
      columnExists(Borrower, "isActive"),
      columnExists(Borrower, "blacklisted"),
    ]);

    const total = await safeCount(Borrower);

    // Active
    let active = 0;
    if (hasStatus) {
      active = await safeCount(Borrower, { where: { status: "active" } });
    } else if (hasIsActive) {
      active = await safeCount(Borrower, { where: { isActive: true } });
    } else if (hasBlacklisted) {
      const black = await safeCount(Borrower, { where: { blacklisted: true } });
      active = Math.max(0, total - black);
    } else {
      // No signal — treat all as active for now
      active = total;
    }

    // Blacklisted
    let blacklisted = 0;
    if (hasStatus) {
      blacklisted = await safeCount(Borrower, { where: { status: "blacklisted" } });
    } else if (hasBlacklisted) {
      blacklisted = await safeCount(Borrower, { where: { blacklisted: true } });
    } else {
      blacklisted = 0;
    }

    // With at least one loan
    let withLoans = 0;
    if (Loan) {
      try {
        withLoans = await Loan.count({ distinct: true, col: "borrowerId" });
      } catch {
        // some dialects need quoted col
        try {
          withLoans = await Loan.count({ distinct: true, col: sequelize.col('"Loan"."borrowerId"') });
        } catch {
          withLoans = 0;
        }
      }
    }

    // New this month
    const now = new Date();
    const start = startOfMonth(now);
    const end   = endOfMonth(now);
    const newThisMonth = await countCreatedBetween(Borrower, start, end);

    res.json({
      total,
      active,
      blacklisted,
      withLoans,
      newThisMonth,
    });
  } catch (err) {
    console.error("getBorrowerSummary error:", err);
    res.status(500).json({ error: "Failed to build borrower summary" });
  }
};
