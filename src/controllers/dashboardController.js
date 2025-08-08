const { Borrower, Loan, LoanRepayment, SavingsTransaction, User } = require('../models');
const models = require('../models');
const { Op } = require('sequelize');
const {
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
  parseISO, isValid
} = require('date-fns');

// -------- helpers --------
const getDateRange = (timeRange, startDate, endDate) => {
  const now = new Date();
  switch (timeRange) {
    case 'today': return [startOfDay(now), endOfDay(now)];
    case 'week': return [startOfWeek(now), endOfWeek(now)];
    case 'month': return [startOfMonth(now), endOfMonth(now)];
    case 'quarter': return [startOfQuarter(now), endOfQuarter(now)];
    case 'semiAnnual':
      return now.getMonth() < 6
        ? [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 5, 30)]
        : [new Date(now.getFullYear(), 6, 1), new Date(now.getFullYear(), 11, 31)];
    case 'annual': return [startOfYear(now), endOfYear(now)];
    case 'custom': return [parseISO(startDate), parseISO(endDate)];
    default: return [null, null];
  }
};

const safeNumber = v => Number(v || 0);

// ----- Communications helpers (reuse your Communication model) -----
async function fetchCommunications({ role, branchId, limit = 20 } = {}) {
  try {
    const Communication = models.Communication || null;
    if (!Communication || !Communication.findAll) throw new Error('No model');

    const now = new Date();

    const where = {
      isActive: true,
      showInTicker: true,
      [Op.and]: [
        { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
        { [Op.or]: [{ endAt: null }, { endAt: { [Op.gte]: now } }] }
      ]
    };

    const roleClause = { [Op.or]: [{ audienceRole: null }, { audienceRole: role || null }] };
    const branchClause = branchId
      ? { [Op.or]: [{ audienceBranchId: null }, { audienceBranchId: branchId }] }
      : {};

    const rows = await models.Communication.findAll({
      where: { ...where, ...roleClause, ...branchClause },
      order: [
        [models.sequelize.literal(`CASE 
          WHEN priority='critical' THEN 4 
          WHEN priority='high' THEN 3 
          WHEN priority='normal' THEN 2 
          ELSE 1 END`), 'DESC'],
        ['createdAt', 'DESC']
      ],
      include: [{ model: models.CommunicationAttachment, as: 'attachments' }],
      limit
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
        id: a.id, fileName: a.fileName, fileUrl: a.fileUrl, mimeType: a.mimeType, size: a.size
      }))
    }));
  } catch {
    return [
      { id: 'c1', text: 'System notice: Collections review every Friday 16:00.' },
      { id: 'c2', text: 'Reminder: Ensure KYC docs are complete before disbursement.' },
    ];
  }
}

// Single highlighted card under Welcome: showOnDashboard=true
async function fetchDashboardMessage({ role, branchId } = {}) {
  try {
    const Communication = models.Communication || null;
    if (!Communication || !Communication.findOne) return null;
    const now = new Date();

    const where = {
      isActive: true,
      showOnDashboard: true,
      [Op.and]: [
        { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
        { [Op.or]: [{ endAt: null }, { endAt: { [Op.gte]: now } }] }
      ]
    };

    const roleClause = { [Op.or]: [{ audienceRole: null }, { audienceRole: role || null }] };
    const branchClause = branchId
      ? { [Op.or]: [{ audienceBranchId: null }, { audienceBranchId: branchId }] }
      : {};

    const msg = await models.Communication.findOne({
      where: { ...where, ...roleClause, ...branchClause },
      order: [
        [models.sequelize.literal(`CASE 
          WHEN priority='critical' THEN 4 
          WHEN priority='high' THEN 3 
          WHEN priority='normal' THEN 2 
          ELSE 1 END`), 'DESC'],
        ['createdAt', 'DESC']
      ],
      include: [{ model: models.CommunicationAttachment, as: 'attachments' }]
    });

    if (!msg) return null;
    return {
      id: msg.id,
      title: msg.title,
      text: msg.text,
      priority: msg.priority,
      createdAt: msg.createdAt,
      attachments: (msg.attachments || []).map(a => ({
        id: a.id, fileName: a.fileName, fileUrl: a.fileUrl, mimeType: a.mimeType, size: a.size
      }))
    };
  } catch {
    return null;
  }
}

// =====================
// GET /api/dashboard/summary
// =====================
exports.getDashboardSummary = async (req, res) => {
  try {
    const { branchId, officerId, timeRange, startDate, endDate } = req.query;

    const loanFilter = {};
    const borrowerFilter = {};
    const repaymentDateFilter = {};
    const savingsDateFilter = {};

    if (branchId) {
      loanFilter.branchId = branchId;
      borrowerFilter.branchId = branchId;
    }
    if (officerId) {
      loanFilter.initiatedBy = officerId;
    }

    const [start, end] = getDateRange(timeRange, startDate, endDate);
    if (start && end) {
      loanFilter.createdAt = { [Op.between]: [start, end] };
      loanFilter.disbursementDate = { [Op.between]: [start, end] };
      repaymentDateFilter.date = { [Op.between]: [start, end] };
      savingsDateFilter.date = { [Op.between]: [start, end] };
    }

    // Parallel aggregates
    const [
      totalBorrowers,
      totalLoans,
      totalDisbursedAmount,

      // Collections (actual money received)
      sumAmountPaid,
      sumTotalFallback,

      // Planned/expected amounts in the period
      sumExpectedAmount,

      // Savings
      savingsTxs,

      // Defaulted pieces
      defaultedPrincipal,
      defaultedInterest,

      // Outstanding pieces (still due)
      outstandingPrincipal,
      outstandingInterest,

      // Written off (amount)
      writtenOffAmount,

      // Comms
      generalComms,
      dashMsg
    ] = await Promise.all([
      Borrower.count({ where: borrowerFilter }),
      Loan.count({ where: loanFilter }),
      Loan.sum('amount', { where: { ...loanFilter, status: 'disbursed' } }),

      LoanRepayment.sum('amountPaid', { where: repaymentDateFilter }),
      LoanRepayment.sum('total', { where: repaymentDateFilter }),

      LoanRepayment.sum('amount', { where: repaymentDateFilter }),

      SavingsTransaction.findAll({ where: savingsDateFilter }),

      LoanRepayment.sum('principal', { where: { ...repaymentDateFilter, status: 'overdue' } }),
      LoanRepayment.sum('interest', { where: { ...repaymentDateFilter, status: 'overdue' } }),

      LoanRepayment.sum('principal', { where: { ...repaymentDateFilter, status: 'pending' } }),
      LoanRepayment.sum('interest', { where: { ...repaymentDateFilter, status: 'pending' } }),

      Loan.sum('amount', { where: { ...loanFilter, status: 'written-off' } }),

      fetchCommunications({ role: req.user?.role, branchId, limit: 10 }),
      fetchDashboardMessage({ role: req.user?.role, branchId })
    ]);

    // Totals for savings
    let totalDeposits = 0, totalWithdrawals = 0;
    for (const tx of savingsTxs) {
      if (tx.type === 'deposit') totalDeposits += safeNumber(tx.amount);
      else if (tx.type === 'withdrawal') totalWithdrawals += safeNumber(tx.amount);
    }
    const netSavings = totalDeposits - totalWithdrawals;

    // Derivations and naming EXACTLY as UI requires
    const totalDisbursed = safeNumber(totalDisbursedAmount);

    // totalPaid = actual cash collected in the period
    const totalPaid = safeNumber(sumAmountPaid ?? sumTotalFallback);

    // totalRepaid = principal component repaid in the period if available,
    // otherwise fall back to actual cash collected (so UI never breaks)
    let totalRepaid = totalPaid;
    // const principalPaid = await LoanRepayment.sum('principalPaid', { where: repaymentDateFilter });
    // if (principalPaid != null) totalRepaid = safeNumber(principalPaid);

    const totalExpectedRepayments = safeNumber(sumExpectedAmount);

    // PAR% = defaulted principal / outstanding principal
    const parPercent = safeNumber(outstandingPrincipal) > 0
      ? Number(((safeNumber(defaultedPrincipal) / safeNumber(outstandingPrincipal)) * 100).toFixed(2))
      : 0;

    res.json({
      // ---- headline cards ----
      totalBorrowers,
      totalLoans,
      totalDisbursed,

      totalPaid,
      totalRepaid,
      totalExpectedRepayments,

      totalDeposits,
      totalWithdrawals,
      netSavings,

      // ---- risk/outstanding ----
      defaultedLoan: safeNumber(defaultedPrincipal),
      defaultedInterest: safeNumber(defaultedInterest),

      outstandingLoan: safeNumber(outstandingPrincipal),
      outstandingInterest: safeNumber(outstandingInterest),

      writtenOff: safeNumber(writtenOffAmount),

      // ---- PAR ----
      parPercent,

      // ---- messages ----
      companyMessage: 'Welcome to MkopoSuite LMS — Q3 focus: Risk reduction & collections discipline.',
      importantNotice: 'REMINDER: Submit weekly branch PAR review by Friday 4:00 PM.',

      // ---- communications ----
      generalCommunications: Array.isArray(generalComms) ? generalComms : [],
      dashboardMessage: dashMsg // {title,text,attachments} | null
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
};

// =====================
// GET /api/dashboard/defaulters
// =====================
exports.getDefaulters = async (req, res) => {
  try {
    const { branchId, officerId, page, pageSize } = req.query;

    const whereLoan = {};
    if (branchId) whereLoan.branchId = branchId;
    if (officerId) whereLoan.initiatedBy = officerId;

    const baseQuery = {
      where: { status: 'overdue' },
      include: [{
        model: models.Loan,
        attributes: ['id', 'amount', 'borrowerId'],
        where: whereLoan,
        include: [{
          model: models.Borrower,
          attributes: ['name', 'phone', 'email']
        }]
      }],
      order: [['date', 'ASC']]
    };

    if (page && pageSize) {
      const { count, rows } = await models.LoanRepayment.findAndCountAll({
        ...baseQuery,
        offset: (Number(page) - 1) * Number(pageSize),
        limit: Number(pageSize)
      });
      const items = rows.map(r => ({
        name: r?.Loan?.Borrower?.name || 'Unknown',
        phone: r?.Loan?.Borrower?.phone || '',
        email: r?.Loan?.Borrower?.email || '',
        overdueAmount: Number(r.total || 0)
      }));
      return res.json({ items, total: count });
    }

    const rows = await models.LoanRepayment.findAll(baseQuery);
    const arr = rows.map(r => ({
      name: r?.Loan?.Borrower?.name || 'Unknown',
      phone: r?.Loan?.Borrower?.phone || '',
      email: r?.Loan?.Borrower?.email || '',
      overdueAmount: Number(r.total || 0)
    }));
    res.json(arr);
  } catch (error) {
    console.error('Defaulters fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch defaulters' });
  }
};

// =====================
// GET /api/dashboard/monthly-trends
// =====================
exports.getMonthlyTrends = async (req, res) => {
  try {
    const now = new Date();
    const start = startOfMonth(now);
    const end = endOfMonth(now);

    const [monthlyLoans, monthlyDeposits, monthlyRepayments] = await Promise.all([
      Loan.count({ where: { createdAt: { [Op.between]: [start, end] } } }),
      SavingsTransaction.sum('amount', { where: { type: 'deposit', date: { [Op.between]: [start, end] } } }),
      LoanRepayment.sum('amountPaid', { where: { date: { [Op.between]: [start, end] } } })
    ]);

    res.json({
      month: now.toLocaleString('default', { month: 'long' }),
      year: now.getFullYear(),
      monthlyLoans,
      monthlyDeposits: Number(monthlyDeposits || 0),
      monthlyRepayments: Number(monthlyRepayments || 0)
    });
  } catch (error) {
    console.error('Monthly trends error:', error);
    res.status(500).json({ error: 'Failed to fetch monthly data' });
  }
};

// =====================
// Activity preview endpoints (safe if models missing)
// =====================
exports.getActivityFeed = async (req, res) => {
  try {
    if (!models.ActivityLog) return res.json({ items: [], total: 0 });

    const { page = 1, pageSize = 10, dateFrom, dateTo } = req.query;

    const where = {};
    if (dateFrom || dateTo) {
      const start = dateFrom && isValid(parseISO(dateFrom)) ? parseISO(dateFrom) : null;
      const end = dateTo && isValid(parseISO(dateTo)) ? parseISO(dateTo) : null;
      if (start && end) where.createdAt = { [Op.between]: [start, end] };
      else if (start) where.createdAt = { [Op.gte]: start };
      else if (end) where.createdAt = { [Op.lte]: end };
    }

    const { count, rows } = await models.ActivityLog.findAndCountAll({
      where,
      include: [{ model: User, attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
      offset: (Number(page) - 1) * Number(pageSize),
      limit: Number(pageSize)
    });

    const items = await Promise.all(rows.map(async a => {
      const comments = models.ActivityComment
        ? await models.ActivityComment.findAll({
            where: { activityId: a.id },
            include: [{ model: User, attributes: ['id', 'name', 'email'] }],
            order: [['createdAt', 'DESC']],
            limit: 2
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
          createdBy: c.User
        }))
      };
    }));

    res.json({ items, total: count });
  } catch (error) {
    console.error('Activity feed error:', error);
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
};

exports.addActivityComment = async (req, res) => {
  try {
    if (!models.ActivityComment) return res.status(400).json({ error: 'Activity comments not enabled' });

    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: 'Comment is required' });
    }

    const created = await models.ActivityComment.create({
      activityId: id,
      userId: req.user.id,
      comment: comment.trim()
    });

    res.status(201).json({ id: created.id, ok: true });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
};

exports.assignActivityTask = async (req, res) => {
  try {
    if (!models.ActivityAssignment) return res.status(400).json({ error: 'Assignments not enabled' });

    const { id } = req.params;
    const { assigneeId, dueDate, note } = req.body;

    if (!assigneeId) return res.status(400).json({ error: 'assigneeId is required' });

    const created = await models.ActivityAssignment.create({
      activityId: id,
      assigneeId,
      assignerId: req.user.id,
      dueDate: dueDate ? parseISO(dueDate) : null,
      note: note || null,
      status: 'open'
    });

    res.status(201).json({ id: created.id, ok: true });
  } catch (error) {
    console.error('Assign task error:', error);
    res.status(500).json({ error: 'Failed to assign task' });
  }
};

// =====================
// GET /api/dashboard/communications (ticker)
// =====================
exports.getGeneralCommunications = async (req, res) => {
  try {
    const { branchId } = req.query;
    const role = req.user?.role || null;
    const comms = await fetchCommunications({ role, branchId, limit: 20 });
    res.json(comms);
  } catch (error) {
    console.error('getGeneralCommunications error:', error);
    res.status(500).json({ error: 'Failed to fetch communications' });
  }
};
