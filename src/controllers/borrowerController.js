const { Op } = require('sequelize');
const models = require('../models');

const Borrower = models.Borrower || null;
const Loan = models.Loan || null;
const LoanRepayment = models.LoanRepayment || null;
const SavingsTransaction = models.SavingsTransaction || null;
const Group = models.BorrowerGroup || models.Group || null;
const GroupMember = models.BorrowerGroupMember || models.GroupMember || null;
const BorrowerComment = models.BorrowerComment || null;
const KYCDocument = models.KYCDocument || null;

const toApi = (b) => {
  if (!b) return null;
  const json = b.toJSON ? b.toJSON() : b;
  return { ...json, fullName: json.fullName ?? json.name ?? '' };
};

const safeNum = (v) => Number(v || 0);

// ---------- CRUD ----------
exports.getAllBorrowers = async (req, res) => {
  try {
    if (!Borrower) return res.json([]);
    const { q = '', branchId, page = 1, pageSize = 50 } = req.query;

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

    const { rows, count } = await Borrower.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return res.json({ items: rows.map(toApi), total: count });
  } catch (error) {
    console.error('getAllBorrowers error:', error);
    res.status(500).json({ error: 'Failed to fetch borrowers' });
  }
};

exports.createBorrower = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: 'Borrower model not available' });

    const { name, fullName, nationalId, phone, email, address, branchId } = req.body || {};
    if (!name && !fullName) return res.status(400).json({ error: 'name is required' });

    const created = await Borrower.create({
      name: name || fullName || '',
      nationalId: nationalId || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      branchId: branchId || null,
      status: 'active',
    });

    res.status(201).json(toApi(created));
  } catch (error) {
    console.error('createBorrower error:', error);
    res.status(500).json({ error: 'Failed to create borrower' });
  }
};

exports.getBorrowerById = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: 'Borrower not found' });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });
    res.json(toApi(b));
  } catch (error) {
    console.error('getBorrowerById error:', error);
    res.status(500).json({ error: 'Failed to fetch borrower' });
  }
};

exports.updateBorrower = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: 'Borrower model not available' });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });

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
    console.error('updateBorrower error:', error);
    res.status(500).json({ error: 'Failed to update borrower' });
  }
};

exports.deleteBorrower = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: 'Borrower model not available' });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });

    await b.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('deleteBorrower error:', error);
    res.status(500).json({ error: 'Failed to delete borrower' });
  }
};

// ---------- Nested ----------
exports.getLoansByBorrower = async (req, res) => {
  try {
    if (!Loan) return res.json([]);
    const rows = await Loan.findAll({
      where: { borrowerId: req.params.id },
      order: [['createdAt', 'DESC']],
      limit: 500,
    });
    res.json(rows || []);
  } catch (error) {
    console.error('getLoansByBorrower error:', error);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
};

exports.getRepaymentsByBorrower = async (req, res) => {
  try {
    if (!Loan || !LoanRepayment) return res.json([]);
    const rows = await LoanRepayment.findAll({
      include: [{ model: Loan, where: { borrowerId: req.params.id } }],
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
      limit: 500,
    });
    res.json(rows || []);
  } catch (error) {
    console.error('getRepaymentsByBorrower error:', error);
    res.status(500).json({ error: 'Failed to fetch repayments' });
  }
};

// ---------- Comments ----------
exports.listComments = async (req, res) => {
  try {
    if (!BorrowerComment) return res.json([]);
    const rows = await BorrowerComment.findAll({
      where: { borrowerId: req.params.id },
      order: [['createdAt', 'DESC']],
      limit: 200,
    });
    res.json(rows || []);
  } catch (error) {
    console.error('listComments error:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
};

exports.addComment = async (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content || !content.trim()) return res.status(400).json({ error: 'content is required' });

    if (!Borrower) return res.status(404).json({ error: 'Borrower not found' });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });

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
    console.error('addComment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
};

// ---------- Savings ----------
exports.getSavingsByBorrower = async (req, res) => {
  try {
    if (!SavingsTransaction) {
      return res.json({ balance: 0, transactions: [] });
    }

    const txs = await SavingsTransaction.findAll({
      where: { borrowerId: req.params.id },
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
      limit: 500,
    });

    let deposits = 0, withdrawals = 0;
    for (const t of txs) {
      if (t.type === 'deposit') deposits += safeNum(t.amount);
      else if (t.type === 'withdrawal') withdrawals += safeNum(t.amount);
    }
    const balance = deposits - withdrawals;

    res.json({ balance, transactions: txs });
  } catch (error) {
    console.error('getSavingsByBorrower error:', error);
    res.status(500).json({ error: 'Failed to fetch savings' });
  }
};

// ---------- Blacklist ----------
exports.blacklist = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: 'Borrower model not available' });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });
    await b.update({ status: 'blacklisted' });
    res.json({ id: b.id, status: b.status });
  } catch (error) {
    console.error('blacklist error:', error);
    res.status(500).json({ error: 'Failed to blacklist borrower' });
  }
};

exports.unblacklist = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: 'Borrower model not available' });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });
    await b.update({ status: 'active' });
    res.json({ id: b.id, status: b.status });
  } catch (error) {
    console.error('unblacklist error:', error);
    res.status(500).json({ error: 'Failed to unblacklist borrower' });
  }
};

exports.listBlacklisted = async (_req, res) => {
  try {
    if (!Borrower) return res.json([]);
    const borrowers = await Borrower.findAll({ where: { status: 'blacklisted' } });
    res.json(borrowers.map(toApi));
  } catch (error) {
    console.error('listBlacklisted error:', error);
    res.status(500).json({ error: 'Failed to fetch blacklisted borrowers' });
  }
};

// ---------- KYC ----------
exports.uploadKyc = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: 'Borrower not found' });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });

    const files = (req.files || []).map(f => ({
      field: f.fieldname,
      originalName: f.originalname,
      size: f.size,
      mimeType: f.mimetype,
    }));

    if (KYCDocument && files.length) {
      const created = await Promise.all(files.map(f =>
        KYCDocument.create({
          borrowerId: b.id,
          fileName: f.originalName,
          mimeType: f.mimeType,
          size: f.size,
          storageKey: null,
        })
      ));
      return res.status(201).json({ borrowerId: b.id, items: created });
    }

    return res.status(201).json({ borrowerId: b.id, files });
  } catch (error) {
    console.error('uploadKyc error:', error);
    res.status(500).json({ error: 'Failed to upload KYC' });
  }
};

exports.listKyc = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: 'Borrower not found' });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });

    if (!KYCDocument) return res.json({ borrowerId: b.id, items: [] });

    const items = await KYCDocument.findAll({
      where: { borrowerId: b.id },
      order: [['createdAt', 'DESC']],
    });

    res.json({ borrowerId: b.id, items });
  } catch (error) {
    console.error('listKyc error:', error);
    res.status(500).json({ error: 'Failed to load KYC docs' });
  }
};

exports.listKycQueue = async (_req, res) => {
  try {
    if (!Borrower) return res.json([]);
    const borrowers = await Borrower.findAll({ where: { status: 'pending_kyc' } });
    res.json(borrowers.map(toApi));
  } catch (error) {
    console.error('listKycQueue error:', error);
    res.status(500).json({ error: 'Failed to fetch KYC queue' });
  }
};

// ---------- Groups ----------
exports.listGroups = async (_req, res) => {
  try {
    if (!Group) return res.json([]);
    const groups = await Group.findAll({ order: [['createdAt', 'DESC']] });
    res.json(groups || []);
  } catch (error) {
    console.error('listGroups error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
};

exports.createGroup = async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!Group) return res.status(501).json({ error: 'Group model not available' });
    const g = await Group.create({ name });
    res.status(201).json(g);
  } catch (error) {
    console.error('createGroup error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
};

exports.getGroup = async (req, res) => {
  try {
    if (!Group) return res.status(404).json({ error: 'Group not found' });
    const g = await Group.findByPk(req.params.groupId);
    if (!g) return res.status(404).json({ error: 'Group not found' });

    let members = [];
    if (GroupMember && Borrower) {
      const rows = await GroupMember.findAll({
        where: { groupId: g.id },
        include: [{ model: Borrower, attributes: ['id', 'name', 'phone'] }],
      });
      members = rows.map(r => r.Borrower);
    }

    res.json({ ...g.toJSON(), members });
  } catch (error) {
    console.error('getGroup error:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
};

exports.updateGroup = async (req, res) => {
  try {
    if (!Group) return res.status(501).json({ error: 'Group model not available' });
    const g = await Group.findByPk(req.params.groupId);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const { name } = req.body || {};
    await g.update({ name: name ?? g.name });
    res.json(g);
  } catch (error) {
    console.error('updateGroup error:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
};

exports.addGroupMember = async (req, res) => {
  try {
    const { borrowerId } = req.body || {};
    if (!borrowerId) return res.status(400).json({ error: 'borrowerId is required' });
    if (!Group || !GroupMember || !Borrower) return res.status(501).json({ error: 'Group membership not available' });

    const g = await Group.findByPk(req.params.groupId);
    if (!g) return res.status(404).json({ error: 'Group not found' });

    const b = await Borrower.findByPk(borrowerId);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });

    const [gm] = await GroupMember.findOrCreate({ where: { groupId: g.id, borrowerId: b.id } });
    res.json(gm);
  } catch (error) {
    console.error('addGroupMember error:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
};

exports.removeGroupMember = async (req, res) => {
  try {
    if (!GroupMember) return res.status(501).json({ error: 'Group membership not available' });
    const { groupId, borrowerId } = req.params;
    const gm = await GroupMember.findOne({ where: { groupId, borrowerId } });
    if (!gm) return res.status(404).json({ error: 'Membership not found' });
    await gm.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('removeGroupMember error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
};

exports.groupReports = async (_req, res) => {
  try {
    if (!Group) return res.json([]);
    const groups = await Group.findAll({ include: [{ model: GroupMember }] });

    const results = await Promise.all(groups.map(async (g) => {
      const membersCount = g.GroupMembers?.length || 0;
      let totalLoans = 0, totalLoanAmount = 0;
      if (Loan) {
        totalLoans = await Loan.count({
          where: { borrowerId: g.GroupMembers.map(m => m.borrowerId) }
        });
        totalLoanAmount = await Loan.sum('amount', {
          where: { borrowerId: g.GroupMembers.map(m => m.borrowerId) }
        }) || 0;
      }
      return { id: g.id, name: g.name, membersCount, totalLoans, totalLoanAmount };
    }));

    res.json(results);
  } catch (error) {
    console.error('groupReports error:', error);
    res.status(500).json({ error: 'Failed to fetch group reports' });
  }
};

exports.importGroupMembers = async (req, res) => {
  try {
    if (!Group || !GroupMember) return res.status(501).json({ error: 'Group membership not available' });
    const g = await Group.findByPk(req.params.groupId);
    if (!g) return res.status(404).json({ error: 'Group not found' });

    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const buf = req.file.buffer;
    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const borrowerIdIdx = header.indexOf('borrowerid');
    if (borrowerIdIdx === -1) return res.status(400).json({ error: 'CSV must include a "borrowerId" column' });

    let added = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const borrowerId = cols[borrowerIdIdx];
      if (!borrowerId) continue;

      await GroupMember.findOrCreate({ where: { groupId: g.id, borrowerId } });
      added++;
    }
    res.json({ ok: true, added });
  } catch (error) {
    console.error('importGroupMembers error:', error);
    res.status(500).json({ error: 'Failed to import group members' });
  }
};

// ---------- Import Borrowers ----------
exports.importBorrowers = async (req, res) => {
  try {
    if (!Borrower) return res.status(501).json({ error: 'Borrower model not available' });
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const buf = req.file.buffer;
    const text = buf.toString('utf8');

    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return res.status(400).json({ error: 'No rows' });

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const nameIdx = header.indexOf('name');
    const phoneIdx = header.indexOf('phone');
    const nidIdx = header.indexOf('nationalid');

    if (nameIdx === -1) return res.status(400).json({ error: 'CSV must include a "name" column' });

    const created = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const name = cols[nameIdx];
      if (!name) continue;
      const phone = phoneIdx !== -1 ? cols[phoneIdx] : null;
      const nationalId = nidIdx !== -1 ? cols[nidIdx] : null;

      const b = await Borrower.create({ name, phone, nationalId, status: 'active' });
      created.push(toApi(b));
      if (created.length >= 1000) break;
    }

    res.status(202).json({ received: true, count: created.length, items: created });
  } catch (error) {
    console.error('importBorrowers error:', error);
    res.status(500).json({ error: 'Failed to import borrowers' });
  }
};

// ---------- Reports ----------
exports.summaryReport = async (req, res) => {
  try {
    if (!Borrower) return res.status(404).json({ error: 'Borrower not found' });
    const b = await Borrower.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });

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
    const totalRepayments = reps.reduce((acc, r) => acc + safeNum(r.amount || r.amountPaid), 0);

    let balance = 0;
    let txCount = 0;
    if (SavingsTransaction) {
      const txs = await SavingsTransaction.findAll({ where: { borrowerId: b.id } });
      txCount = txs.length;
      let dep = 0, wdr = 0;
      for (const t of txs) {
        if (t.type === 'deposit') dep += safeNum(t.amount);
        else if (t.type === 'withdrawal') wdr += safeNum(t.amount);
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
    console.error('summaryReport error:', error);
    res.status(500).json({ error: 'Failed to build report' });
  }
};

exports.globalBorrowerReport = async (req, res) => {
  try {
    if (!Borrower) return res.json([]);
    const { branchId, status } = req.query;

    const where = {};
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;

    const borrowers = await Borrower.findAll({ where });

    const report = await Promise.all(borrowers.map(async (b) => {
      let loans = Loan ? await Loan.count({ where: { borrowerId: b.id } }) : 0;
      let totalLoanAmount = Loan ? await Loan.sum('amount', { where: { borrowerId: b.id } }) || 0 : 0;
      let totalRepayments = 0;
      if (LoanRepayment && Loan) {
        totalRepayments = await LoanRepayment.sum('amount', {
          include: [{ model: Loan, where: { borrowerId: b.id }, attributes: [] }]
        }) || 0;
      }
      return {
        id: b.id,
        name: b.name,
        status: b.status,
        loansCount: loans,
        loansTotal: totalLoanAmount,
        repaymentsTotal: totalRepayments
      };
    }));

    res.json({ items: report, total: report.length });
  } catch (error) {
    console.error('globalBorrowerReport error:', error);
    res.status(500).json({ error: 'Failed to generate borrower report' });
  }
};
