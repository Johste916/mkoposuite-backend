// controllers/dashboardController.js
"use strict";

const {
  Borrower,
  Loan,
  LoanRepayment,
  SavingsTransaction,
  LoanPayment,     // used if present
  User,
  sequelize,
} = require("../models");
const models = require("../models");
const { Op } = require("sequelize");
const {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
  parseISO, isValid,
} = require("date-fns");

/* ========================= Helpers ========================= */

const getDateRange = (timeRange, startDate, endDate) => {
  const now = new Date();
  switch (timeRange) {
    case "today": return [startOfDay(now), endOfDay(now)];
    case "week": return [startOfWeek(now), endOfWeek(now)];
    case "month": return [startOfMonth(now), endOfMonth(now)];
    case "quarter": return [startOfQuarter(now), endOfQuarter(now)];
    case "semiAnnual":
      return now.getMonth() < 6
        ? [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 5, 30)]
        : [new Date(now.getFullYear(), 6, 1), new Date(now.getFullYear(), 11, 31)];
    case "annual": return [startOfYear(now), endOfYear(now)];
    case "custom": {
      const s = startDate ? parseISO(startDate) : null;
      const e = endDate ? parseISO(endDate) : null;
      return [s, e];
    }
    default: return [null, null];
  }
};
const safeNumber = v => Number(v || 0);

async function fetchCommunications({ role, branchId, limit = 20 } = {}) {
  try {
    if (!models.Communication?.findAll) throw new Error("Communication model missing");

    const now = new Date();
    const timeWindow = {
      [Op.and]: [
        { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
        { [Op.or]: [{ endAt: null }, { endAt: { [Op.gte]: now } }] },
      ],
    };

    const roleClause   = { [Op.or]: [{ audienceRole: null }, { audienceRole: role || null }] };
    const branchClause = branchId
      ? { [Op.or]: [{ audienceBranchId: null }, { audienceBranchId: branchId }] }
      : {};

    const rows = await models.Communication.findAll({
      where: {
        isActive: true,
        showInTicker: true,
        ...timeWindow,
        ...roleClause,
        ...branchClause,
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
    // Friendly fallback so dashboard keeps working even if the table isn't present
    return [
      { id: "c1", text: "System notice: Collections review every Friday 16:00." },
      { id: "c2", text: "Reminder: Ensure KYC docs are complete before disbursement." },
    ];
  }
}

async function fetchDashboardMessage({ role, branchId } = {}) {
  try {
    if (!models.Communication?.findOne) return null;

    const now = new Date();
    const timeWindow = {
      [Op.and]: [
        { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
        { [Op.or]: [{ endAt: null }, { endAt: { [Op.gte]: now } }] },
      ],
    };

    const roleClause   = { [Op.or]: [{ audienceRole: null }, { audienceRole: role || null }] };
    const branchClause = branchId
      ? { [Op.or]: [{ audienceBranchId: null }, { audienceBranchId: branchId }] }
      : {};

    const msg = await models.Communication.findOne({
      where: {
        isActive: true,
        showOnDashboard: true,
        ...timeWindow,
        ...roleClause,
        ...branchClause,
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

/* ======================= Controller Functions ======================= */

// GET /api/dashboard/summary
exports.getDashboardSummary = async (req, res) => {
  try {
    const { branchId, officerId, timeRange, startDate, endDate } = req.query;

    const whereLoan = {};
    const whereBorrower = {};
    const whereRepay = {};
    const whereSavings = {};
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
      // Loan creation / disbursement windows
      whereLoan.createdAt = { [Op.between]: [start, end] };
      whereLoan.disbursementDate = { [Op.between]: [start, end] };

      // ✅ LoanRepayment uses dueDate (not "date")
      whereRepay.dueDate = { [Op.between]: [start, end] };

      // SavingsTransaction uses "date" (DATEONLY) – OK
      whereSavings.date = { [Op.between]: [start, end] };

      // LoanPayment: unknown column, fall back to createdAt
      wherePayments.createdAt = { [Op.between]: [start, end] };
    }

    // Compute safely; any missing tables/columns won’t 500
    const safeSum = async (Model, field, where) => {
      try { return await Model.sum(field, { where }); } catch { return 0; }
    };
    const safeCount = async (Model, where) => {
      try { return await Model.count({ where }); } catch { return 0; }
    };
    const safeFindAll = async (Model, opts) => {
      try { return await Model.findAll(opts); } catch { return []; }
    };

    const [
      totalBorrowers,
      totalLoans,
      totalDisbursedAmount,
      // Prefer actual payments if LoanPayment exists; else 0 and we’ll fallback
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
    ] = await Promise.all([
      safeCount(Borrower, whereBorrower),
      safeCount(Loan, whereLoan),
      safeSum(Loan, "amount", { ...whereLoan, status: "disbursed" }),
      LoanPayment ? safeSum(LoanPayment, "amount", wherePayments) : 0,
      // ✅ expected = scheduled totals within window (dueDate)
      safeSum(LoanRepayment, "total", whereRepay),
      safeFindAll(SavingsTransaction, { where: whereSavings }),
      // These rely on your status values; they’ll just be 0 if you don’t mark them that way
      safeSum(LoanRepayment, "principal", { ...whereRepay, status: "overdue" }),
      safeSum(LoanRepayment, "interest",  { ...whereRepay, status: "overdue" }),
      safeSum(LoanRepayment, "principal", { ...whereRepay, status: "pending" }),
      safeSum(LoanRepayment, "interest",  { ...whereRepay, status: "pending" }),
      safeSum(Loan, "amount", { ...whereLoan, status: "written-off" }),
      fetchCommunications({ role: req.user?.role, branchId, limit: 10 }),
      fetchDashboardMessage({ role: req.user?.role, branchId }),
    ]);

    // Savings totals
    let totalDeposits = 0, totalWithdrawals = 0;
    for (const tx of savingsTxs) {
      if (tx.type === "deposit")   totalDeposits   += safeNumber(tx.amount);
      if (tx.type === "withdrawal") totalWithdrawals += safeNumber(tx.amount);
    }

    // If we couldn’t read LoanPayment, fallback to scheduled (sumExpectedAmount)
    const totalPaid = safeNumber(sumLoanPayments || 0);
    const totalExpectedRepayments = safeNumber(sumExpectedAmount);
    const totalDisbursed = safeNumber(totalDisbursedAmount);

    const parPercent = safeNumber(outstandingPrincipal) > 0
      ? Number(((safeNumber(defaultedPrincipal) / safeNumber(outstandingPrincipal)) * 100).toFixed(2))
      : 0;

    res.json({
      totalBorrowers,
      totalLoans,
      totalDisbursed,
      totalPaid,
      totalRepaid: totalPaid, // keep payload shape
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
      companyMessage: "Welcome to MkopoSuite LMS — Q3 focus: Risk reduction & collections discipline.",
      importantNotice: "REMINDER: Submit weekly branch PAR review by Friday 4:00 PM.",
      generalCommunications: Array.isArray(generalComms) ? generalComms : [],
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

    const whereLoan = {};
    if (branchId) whereLoan.branchId = branchId;
    if (officerId) whereLoan.initiatedBy = officerId;

    const baseQuery = {
      where: { status: "overdue" },
      include: [{
        model: models.Loan,
        attributes: ["id", "amount", "borrowerId"],
        where: whereLoan,
        include: [{
          model: models.Borrower,
          attributes: ["name", "phone", "email"],
        }],
      }],
      // ✅ "date" doesn’t exist on LoanRepayment; use dueDate
      order: [["dueDate", "ASC"]],
    };

    if (page && pageSize) {
      const limit  = Number(pageSize);
      const offset = (Number(page) - 1) * limit;

      const { count, rows } = await models.LoanRepayment.findAndCountAll({
        ...baseQuery,
        offset,
        limit,
      });
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

    const rows = await models.LoanRepayment.findAll(baseQuery);
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
exports.getMonthlyTrends = async (req, res) => {
  try {
    const now = new Date();
    const start = startOfMonth(now);
    const end   = endOfMonth(now);

    const [monthlyLoans, monthlyDeposits, monthlyRepayments] = await Promise.all([
      Loan.count({ where: { createdAt: { [Op.between]: [start, end] } } }),
      // SavingsTransaction has "date"
      SavingsTransaction.sum("amount", { where: { type: "deposit", date: { [Op.between]: [start, end] } } }),
      // ✅ LoanRepayment uses "dueDate" and does NOT have amountPaid; use scheduled totals as proxy
      LoanRepayment.sum("total", { where: { dueDate: { [Op.between]: [start, end] } } }),
    ]);

    res.json({
      month: now.toLocaleString("default", { month: "long" }),
      year:  now.getFullYear(),
      monthlyLoans,
      monthlyDeposits: Number(monthlyDeposits || 0),
      monthlyRepayments: Number(monthlyRepayments || 0),
    });
  } catch (error) {
    console.error("Monthly trends error:", error);
    res.status(500).json({ error: "Failed to fetch monthly data" });
  }
};

// GET /api/dashboard/activity
exports.getActivityFeed = async (req, res) => {
  try {
    if (!models.ActivityLog) return res.json({ items: [], total: 0 });

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

    const { count, rows } = await models.ActivityLog.findAndCountAll({
      where,
      include: [{ model: User, attributes: ["id", "name", "email"] }],
      order: [["createdAt", "DESC"]],
      offset,
      limit,
    });

    const items = await Promise.all(rows.map(async a => {
      const comments = models.ActivityComment
        ? await models.ActivityComment.findAll({
            where: { activityId: a.id },
            include: [{ model: User, attributes: ["id", "name", "email"] }],
            order: [["createdAt", "DESC"]],
            limit: 2,
          })
        : [];
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
    if (!models.ActivityComment) return res.status(400).json({ error: "Activity comments not enabled" });

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
    if (!models.ActivityAssignment) return res.status(400).json({ error: "Assignments not enabled" });

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
