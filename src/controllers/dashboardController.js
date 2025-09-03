"use strict";

const { Op } = require("sequelize");
const models = require("../models");
const {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
  parseISO, isValid,
} = require("date-fns");

const sequelize = models?.sequelize;

/* ========================= Helpers ========================= */

const getDateRange = (timeRange, startDate, endDate) => {
  const now = new Date();
  switch (timeRange) {
    case "today":    return [startOfDay(now), endOfDay(now)];
    case "week":     return [startOfWeek(now), endOfWeek(now)];
    case "month":    return [startOfMonth(now), endOfMonth(now)];
    case "quarter":  return [startOfQuarter(now), endOfQuarter(now)];
    case "semiAnnual":
      return now.getMonth() < 6
        ? [new Date(now.getFullYear(), 0, 1),  new Date(now.getFullYear(), 5, 30)]
        : [new Date(now.getFullYear(), 6, 1),  new Date(now.getFullYear(), 11, 31)];
    case "annual":   return [startOfYear(now), endOfYear(now)];
    case "custom": {
      const s = startDate ? parseISO(startDate) : null;
      const e = endDate   ? parseISO(endDate)   : null;
      return [s, e];
    }
    default:         return [null, null];
  }
};

const safeNumber = (v) => Number(v || 0);

const safeSum = async (Model, field, where) => {
  try {
    if (!Model?.sum) return 0;
    const v = await Model.sum(field, { where });
    return safeNumber(v || 0);
  } catch {
    return 0;
  }
};

const safeCount = async (Model, where) => {
  try {
    if (!Model?.count) return 0;
    const v = await Model.count({ where });
    return Number(v || 0);
  } catch {
    return 0;
  }
};

const safeFindAll = async (Model, opts) => {
  try {
    if (!Model?.findAll) return [];
    const rows = await Model.findAll(opts);
    return rows || [];
  } catch {
    return [];
  }
};

/** Read a KV/Setting (tenant-aware if your Setting model supports it) */
async function getSettingKV(key, fallback = {}, req = null) {
  try {
    const Setting = models?.Setting;
    if (!Setting?.get) return fallback;
    const tenantId =
      req?.headers?.["x-tenant-id"] || req?.context?.tenantId || null;
    const v = await Setting.get(key, fallback, { tenantId });
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/** Count loans created in [start,end], trying several columns to fit your schema */
async function countLoansCreatedBetween(start, end) {
  const Loan = models.Loan || null;
  if (!Loan) return 0;

  try {
    return await Loan.count({ where: { createdAt: { [Op.between]: [start, end] } } });
  } catch {}

  try {
    return await Loan.count({
      where: sequelize.where(sequelize.col('"Loan"."createdAt"'), { [Op.between]: [start, end] }),
    });
  } catch {}

  try {
    return await Loan.count({
      where: sequelize.where(sequelize.col('"Loan"."created_at"'), { [Op.between]: [start, end] }),
    });
  } catch {}

  try {
    return await Loan.count({ where: { disbursementDate: { [Op.between]: [start, end] } } });
  } catch {}

  return 0;
}

/* ========= Internal: Communications ========= */

/**
 * General Communications ticker (bottom line).
 * Returns items even if the tables don’t exist (fallback static messages).
 */
async function fetchCommunications({ role, branchId, limit = 20 } = {}) {
  try {
    if (!models.Communication?.findAll) throw new Error("Communication model missing");

    const now = new Date();
    const timeWindow = {
      [Op.and]: [
        { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
        { [Op.or]: [{ endAt: null },   { endAt:   { [Op.gte]: now } }] },
      ],
    };

    const roleClause   = { [Op.or]: [{ audienceRole: null }, { audienceRole: role || null }] };
    const branchClause = branchId
      ? { [Op.or]: [{ audienceBranchId: null }, { audienceBranchId: branchId }] }
      : {};

    const rows = await models.Communication.findAll({
      where: { isActive: true, showInTicker: true, ...timeWindow, ...roleClause, ...branchClause },
      order: [
        [models.sequelize.literal(`
          CASE 
            WHEN priority='critical' THEN 4 
            WHEN priority='high' THEN 3 
            WHEN priority='normal' THEN 2 
            ELSE 1 
          END
        `), "DESC"],
        ["createdAt", "DESC"],
      ],
      include: [{ model: models.CommunicationAttachment, as: "attachments" }],
      limit,
    });

    return rows.map(r => ({
      id: r.id,
      title: r.title,
      text: r.text,
      type: r.type,
      priority: r.priority,
      audienceRole: r.audienceRole,
      audienceBranchId: r.audienceBranchId,
      createdAt: r.createdAt,
      attachments: (r.attachments || []).map(a => ({
        id: a.id, fileName: a.fileName, fileUrl: a.fileUrl, mimeType: a.mimeType, size: a.size,
      })),
    }));
  } catch {
    return [
      { id: "c1", text: "System notice: Collections review every Friday 16:00." },
      { id: "c2", text: "Reminder: Ensure KYC docs are complete before disbursement." },
    ];
  }
}

/**
 * Curated card message (center white card).
 * Pick the highest priority active message flagged showOnDashboard.
 */
async function fetchDashboardMessage({ role, branchId } = {}) {
  try {
    if (!models.Communication?.findOne) return null;

    const now = new Date();
    const timeWindow = {
      [Op.and]: [
        { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
        { [Op.or]: [{ endAt: null },   { endAt:   { [Op.gte]: now } }] },
      ],
    };

    const roleClause   = { [Op.or]: [{ audienceRole: null }, { audienceRole: role || null }] };
    const branchClause = branchId
      ? { [Op.or]: [{ audienceBranchId: null }, { audienceBranchId: branchId }] }
      : {};

    const msg = await models.Communication.findOne({
      where: { isActive: true, showOnDashboard: true, ...timeWindow, ...roleClause, ...branchClause },
      order: [
        [models.sequelize.literal(`
          CASE 
            WHEN priority='critical' THEN 4 
            WHEN priority='high' THEN 3 
            WHEN priority='normal' THEN 2 
            ELSE 1 
          END
        `), "DESC"],
        ["createdAt", "DESC"],
      ],
      include: [{ model: models.CommunicationAttachment, as: "attachments" }],
    });

    return msg ? {
      id: msg.id,
      title: msg.title,
      text: msg.text,
      priority: msg.priority,
      createdAt: msg.createdAt,
      attachments: (msg.attachments || []).map(a => ({
        id: a.id, fileName: a.fileName, fileUrl: a.fileUrl, mimeType: a.mimeType, size: a.size,
      })),
    } : null;
  } catch {
    return null;
  }
}

/**
 * Amber/Blue header lines: take the first two highest-priority active items
 * flagged `showOnDashboard = true`, respecting role/branch/time windows.
 */
async function fetchHeaderMessages({ role, branchId } = {}) {
  try {
    if (!models.Communication?.findAll) return { important: null, company: null };

    const now = new Date();
    const rows = await models.Communication.findAll({
      where: {
        isActive: true,
        showOnDashboard: true,
        [Op.and]: [
          { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
          { [Op.or]: [{ endAt: null },   { endAt:   { [Op.gte]: now } }] },
        ],
        [Op.or]: [{ audienceRole: null }, { audienceRole: role || null }],
        ...(branchId ? { [Op.or]: [{ audienceBranchId: null }, { audienceBranchId: branchId }] } : {}),
      },
      order: [
        [models.sequelize.literal(`
          CASE 
            WHEN priority='critical' THEN 4 
            WHEN priority='high' THEN 3 
            WHEN priority='normal' THEN 2 
            ELSE 1 
          END
        `), "DESC"],
        ["createdAt", "DESC"],
      ],
      limit: 2,
    });

    return {
      important: rows[0] || null,
      company: rows[1] || null,
    };
  } catch {
    return { important: null, company: null };
  }
}

/* ======================= Controller Functions ======================= */

// GET /api/dashboard/summary
exports.getDashboardSummary = async (req, res) => {
  try {
    const { branchId, officerId, timeRange, startDate, endDate } = req.query;

    const whereLoan     = {};
    const whereBorrower = {};
    const whereRepay    = {};
    const whereSavings  = {};
    const wherePayments = {};

    if (branchId) {
      whereLoan.branchId = branchId;
      whereBorrower.branchId = branchId;
    }
    if (officerId) {
      whereLoan.initiatedBy = officerId;
    }

    const [start, end] = getDateRange(timeRange, startDate, endDate);

    if (start && end) {
      whereLoan.createdAt         = { [Op.between]: [start, end] };
      whereLoan.disbursementDate  = { [Op.between]: [start, end] };
      whereRepay.dueDate          = { [Op.between]: [start, end] };
      whereSavings.date           = { [Op.between]: [start, end] };
      wherePayments.createdAt     = { [Op.between]: [start, end] };
    }

    const Borrower           = models.Borrower || null;
    const Loan               = models.Lloan || models.Loan || null;
    const LoanRepayment      = models.LoanRepayment || null;
    const SavingsTransaction = models.SavingsTransaction || null;
    const LoanPayment        = models.LoanPayment || null;

    const [
      totalBorrowers,
      totalLoans,
      totalDisbursedAmount,
      sumLoanPayments,
      sumExpectedAmount,
      savingsTxs,
      defaultedPrincipal,
      defaultedInterest,
      outstandingPrincipal,
      outstandingInterest,
      writtenOffAmount,
      generalComms,
      dashMsg,
      generalKV,
      headerMsgs,
    ] = await Promise.all([
      safeCount(Borrower, whereBorrower),
      safeCount(Loan, whereLoan),
      safeSum(Loan, "amount", { ...whereLoan, status: "disbursed" }),
      safeSum(LoanPayment, "amount", wherePayments),
      safeSum(LoanRepayment, "total", whereRepay),
      safeFindAll(SavingsTransaction, { where: whereSavings }),
      safeSum(LoanRepayment, "principal", { ...whereRepay, status: "overdue" }),
      safeSum(LoanRepayment, "interest",  { ...whereRepay, status: "overdue" }),
      safeSum(LoanRepayment, "principal", { ...whereRepay, status: "pending" }),
      safeSum(LoanRepayment, "interest",  { ...whereRepay, status: "pending" }),
      safeSum(Loan, "amount", { ...whereLoan, status: "written-off" }),
      fetchCommunications({ role: req.user?.role, branchId, limit: 10 }),
      fetchDashboardMessage({ role: req.user?.role, branchId }),
      getSettingKV("general", {}, req),
      fetchHeaderMessages({ role: req.user?.role, branchId }),
    ]);

    let totalDeposits = 0, totalWithdrawals = 0;
    for (const tx of savingsTxs) {
      if (tx.type === "deposit")    totalDeposits    += safeNumber(tx.amount);
      if (tx.type === "withdrawal") totalWithdrawals += safeNumber(tx.amount);
    }

    const totalPaid = safeNumber(sumLoanPayments || 0);
    const totalExpectedRepayments = safeNumber(sumExpectedAmount);
    const totalDisbursed = safeNumber(totalDisbursedAmount);

    const parPercent = safeNumber(outstandingPrincipal) > 0
      ? Number(((safeNumber(defaultedPrincipal) / safeNumber(outstandingPrincipal)) * 100).toFixed(2))
      : 0;

    // KV overrides for the two header lines
    const importantNoticeFromKV = generalKV?.dashboard?.importantNotice;
    const companyMessageFromKV  = generalKV?.dashboard?.companyMessage;

    // Build strings from header comms (title + text) if present
    const importantFromComms = headerMsgs?.important
      ? `${headerMsgs.important.title || ""} ${headerMsgs.important.text || ""}`.trim()
      : null;
    const companyFromComms = headerMsgs?.company
      ? `${headerMsgs.company.title || ""} ${headerMsgs.company.text || ""}`.trim()
      : null;

    res.json({
      totalBorrowers,
      totalLoans,
      totalDisbursed,
      totalPaid,
      totalRepaid: totalPaid,
      totalExpectedRepayments,
      totalDeposits,
      totalWithdrawals,
      netSavings: totalDeposits - totalWithdrawals,
      defaultedLoan: safeNumber(defaultedPrincipal),
      defaultedInterest: safeNumber(defaultedInterest),
      outstandingLoan: safeNumber(outstandingPrincipal),
      outstandingInterest: safeNumber(outstandingInterest),
      writtenOff: safeNumber(writtenOffAmount),
      parPercent,

      // 1) Top amber bar (KV > comms > default)
      importantNotice:
        (typeof importantNoticeFromKV === "string" && importantNoticeFromKV.trim())
          ? importantNoticeFromKV.trim()
          : (importantFromComms || "REMINDER: Submit weekly branch PAR review by Friday 4:00 PM."),

      // 2) Middle blue line (KV > comms > default)
      companyMessage:
        (typeof companyMessageFromKV === "string" && companyMessageFromKV.trim())
          ? companyMessageFromKV.trim()
          : (companyFromComms || "Welcome to MkopoSuite LMS — Q3 focus: Risk reduction & collections discipline."),

      // 3) Bottom ticker (array)
      generalCommunications: Array.isArray(generalComms) ? generalComms : [],

      // Optional curated card
      dashboardMessage: dashMsg,
    });
  } catch (error) {
    console.error("Dashboard summary error:", error);
    res.status(500).json({ error: "Failed to fetch summary" });
  }
};

// GET /api/dashboard/defaulters
exports.getDefaulters = async (req, res) => {
  try {
    const { branchId, officerId, page, pageSize } = req.query;
    const Loan          = models.Loan || null;
    const Borrower      = models.Borrower || null;
    const LoanRepayment = models.LoanRepayment || null;

    if (!LoanRepayment?.findAll) return res.json([]);

    const whereLoan = {};
    if (branchId) whereLoan.branchId = branchId;
    if (officerId) whereLoan.initiatedBy = officerId;

    const baseQuery = {
      where: { status: "overdue" },
      include: Loan ? [{
        model: Loan,
        attributes: ["id", "amount", "borrowerId"],
        where: whereLoan,
        include: Borrower ? [{
          model: Borrower,
          attributes: ["name", "phone", "email"],
        }] : [],
      }] : [],
      order: [["dueDate", "ASC"]],
    };

    if (page && pageSize) {
      const limit  = Number(pageSize);
      const offset = (Number(page) - 1) * limit;

      let count = 0, rows = [];
      try {
        ({ count, rows } = await LoanRepayment.findAndCountAll({
          ...baseQuery,
          offset,
          limit,
        }));
      } catch (e) {
        if (e?.parent?.code === "42P01") return res.json({ items: [], total: 0 });
        throw e;
      }

      return res.json({
        items: rows.map(r => ({
          name:  r?.Loan?.Borrower?.name  || "Unknown",
          phone: r?.Loan?.Borrower?.phone || "",
          email: r?.Loan?.Borrower?.email || "",
          overdueAmount: Number(r.total || 0),
        })),
        total: count,
      });
    }

    let rows = [];
    try {
      rows = await LoanRepayment.findAll(baseQuery);
    } catch (e) {
      if (e?.parent?.code === "42P01") return res.json([]);
      throw e;
    }
    res.json(rows.map(r => ({
      name:  r?.Loan?.Borrower?.name  || "Unknown",
      phone: r?.Loan?.Borrower?.phone || "",
      email: r?.Loan?.Borrower?.email || "",
      overdueAmount: Number(r.total || 0),
    })));
  } catch (error) {
    console.error("Defaulters fetch error:", error);
    res.status(500).json({ error: "Failed to fetch defaulters" });
  }
};

// GET /api/dashboard/monthly-trends
exports.getMonthlyTrends = async (_req, res) => {
  try {
    const LoanRepayment      = models.LoanRepayment || null;
    const SavingsTransaction = models.SavingsTransaction || null;

    const now   = new Date();
    const start = startOfMonth(now);
    const end   = endOfMonth(now);

    const [monthlyLoans, monthlyDeposits, monthlyRepayments] = await Promise.all([
      countLoansCreatedBetween(start, end),
      (async () => {
        try {
          if (!SavingsTransaction?.sum) return 0;
          const v = await SavingsTransaction.sum("amount", {
            where: { type: "deposit", date: { [Op.between]: [start, end] } },
          });
          return safeNumber(v || 0);
        } catch { return 0; }
      })(),
      (async () => {
        try {
          if (!LoanRepayment?.sum) return 0;
          const v = await LoanRepayment.sum("total", {
            where: { dueDate: { [Op.between]: [start, end] } },
          });
          return safeNumber(v || 0);
        } catch { return 0; }
      })(),
    ]);

    res.json({
      month: now.toLocaleString("default", { month: "long" }),
      year:  now.getFullYear(),
      monthlyLoans,
      monthlyDeposits,
      monthlyRepayments,
    });
  } catch (error) {
    console.error("Monthly trends error:", error);
    res.status(500).json({ error: "Failed to fetch monthly data" });
  }
};

// GET /api/dashboard/activity
exports.getActivityFeed = async (req, res) => {
  try {
    if (!models.ActivityLog?.findAndCountAll) return res.json({ items: [], total: 0 });

    const { page = 1, pageSize = 10, dateFrom, dateTo } = req.query;
    const where = {};

    if (dateFrom || dateTo) {
      const start = dateFrom && isValid(parseISO(dateFrom)) ? parseISO(dateFrom) : null;
      const end   = dateTo   && isValid(parseISO(dateTo))   ? parseISO(dateTo)   : null;
      if (start && end) where.createdAt = { [Op.between]: [start, end] };
      else if (start)   where.createdAt = { [Op.gte]: start };
      else if (end)     where.createdAt = { [Op.lte]: end };
    }

    const limit  = Number(pageSize);
    const offset = (Number(page) - 1) * limit;

    const include = [];
    if (models.User) {
      include.push({ model: models.User, as: 'User', attributes: ["id", "name", "email"] });
    }

    let count = 0, rows = [];
    try {
      ({ count, rows } = await models.ActivityLog.findAndCountAll({
        where,
        include,
        order: [["createdAt", "DESC"]],
        offset,
        limit,
      }));
    } catch (e) {
      if (e?.parent?.code === '42P01') return res.json({ items: [], total: 0 });
      throw e;
    }

    const items = await Promise.all(rows.map(async a => {
      let comments = [];
      if (models.ActivityComment?.findAll) {
        const cInclude = models.User ? [{ model: models.User, as: 'User', attributes: ["id", "name", "email"] }] : [];
        try {
          comments = await models.ActivityComment.findAll({
            where: { activityId: a.id },
            include: cInclude,
            order: [["createdAt", "DESC"]],
            limit: 2,
          });
        } catch {
          comments = [];
        }
      }
      return {
        id: a.id,
        type: a.type,
        message: a.message,
        entityType: a.entityType,
        entityId: a.entityId,
        createdAt: a.createdAt,
        createdBy: a.User,
        comments: comments.map(c => ({
          id: c.id,
          comment: c.comment,
          createdAt: c.createdAt,
          createdBy: c.User,
        })),
      };
    }));

    res.json({ items, total: count });
  } catch (error) {
    console.error("Activity feed error:", error);
    res.status(500).json({ error: "Failed to fetch activity feed" });
  }
};

// POST /api/dashboard/activity/:id/comment
exports.addActivityComment = async (req, res) => {
  try {
    if (!models.ActivityComment?.create) {
      return res.status(400).json({ error: "Activity comments not enabled" });
    }

    const { id } = req.params;
    const { comment } = req.body;
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: "Comment is required" });
    }

    const created = await models.ActivityComment.create({
      activityId: id,
      userId: req.user.id,
      comment: comment.trim(),
    });

    res.status(201).json({ id: created.id, ok: true });
  } catch (error) {
    console.error("Add comment error:", error);
    res.status(500).json({ error: "Failed to add comment" });
  }
};

// POST /api/dashboard/activity/:id/assign
exports.assignActivityTask = async (req, res) => {
  try {
    if (!models.ActivityAssignment?.create) {
      return res.status(400).json({ error: "Assignments not enabled" });
    }

    const { id } = req.params;
    const { assigneeId, dueDate, note } = req.body;
    if (!assigneeId) return res.status(400).json({ error: "assigneeId is required" });

    const created = await models.ActivityAssignment.create({
      activityId: id,
      assigneeId,
      assignerId: req.user.id,
      dueDate: dueDate ? parseISO(dueDate) : null,
      note: note || null,
      status: "open",
    });

    res.status(201).json({ id: created.id, ok: true });
  } catch (error) {
    console.error("Assign task error:", error);
    res.status(500).json({ error: "Failed to assign task" });
  }
};

// GET /api/dashboard/communications
exports.getGeneralCommunications = async (req, res) => {
  try {
    const { branchId } = req.query;
    const role = req.user?.role || null;
    const comms = await fetchCommunications({ role, branchId, limit: 20 });
    res.json(comms);
  } catch (error) {
    console.error("getGeneralCommunications error:", error);
    res.status(500).json({ error: "Failed to fetch communications" });
  }
};
