'use strict';

const { AuditLog, Loan } = require('../models');

const ensureLoan = async (loanId) => {
  const id = Number(loanId);
  if (!Number.isFinite(id)) return null;
  return Loan && (await Loan.findByPk(id));
};

exports.listLoanComments = async (req, res) => {
  try {
    const loan = await ensureLoan(req.params.loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    if (!AuditLog || typeof AuditLog.findAll !== 'function') return res.json([]);

    const rows = await AuditLog.findAll({
      where: { entityType: 'Loan', entityId: loan.id, action: 'comment' },
      order: [['createdAt', 'ASC']],
    });

    const items = rows.map((r) => ({
      id: r.id,
      loanId: r.entityId,
      text: (r.after && (r.after.text || r.after.message)) || '',
      userId: r.userId || null,
      createdAt: r.createdAt,
    }));

    res.json(items);
  } catch (e) {
    console.error('[comments] listLoanComments error:', e);
    res.status(500).json({ error: 'Failed to load comments' });
  }
};

exports.addLoanComment = async (req, res) => {
  try {
    const loan = await ensureLoan(req.params.loanId);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const text = (req.body && (req.body.text || req.body.message)) || '';
    if (!text.trim()) return res.status(400).json({ error: 'text is required' });

    if (!AuditLog || typeof AuditLog.create !== 'function') {
      return res.status(501).json({ error: 'Comments not available on this deployment' });
    }

    const row = await AuditLog.create({
      entityType: 'Loan',
      entityId: loan.id,
      action: 'comment',
      before: null,
      after: { text },
      userId: req.user?.id || null,
      ip: req.ip,
    });

    res.status(201).json({
      id: row.id,
      loanId: loan.id,
      text,
      userId: row.userId,
      createdAt: row.createdAt,
    });
  } catch (e) {
    console.error('[comments] addLoanComment error:', e);
    res.status(500).json({ error: 'Failed to add comment' });
  }
};
