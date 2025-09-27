'use strict';

const { DisbursementBatch, DisbursementItem, Loan, sequelize } = require('../models');
const { Parser } = require('json2csv');

/* ----------------------- enum helper (robust, no deps) ---------------------- */
async function getEnumLabelsForColumn(table, column) {
  try {
    const [[udt]] = await sequelize.query(
      `
      SELECT c.udt_name
      FROM information_schema.columns c
      WHERE lower(c.table_schema) = lower(current_schema())
        AND lower(c.table_name) = lower(:table)
        AND lower(c.column_name) = lower(:column)
      `,
      { replacements: { table, column } }
    );
    if (!udt?.udt_name) return [];
    const [rows] = await sequelize.query(
      `
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = :udt
      ORDER BY e.enumsortorder
      `,
      { replacements: { udt: udt.udt_name } }
    );
    return rows.map(r => r.enumlabel);
  } catch {
    return [];
  }
}

async function mapStatusToDbEnumLabel(next) {
  const labels = await getEnumLabelsForColumn('loans', 'status');
  if (!labels.length) return next;
  const hit = labels.find(l => String(l).toLowerCase() === String(next).toLowerCase());
  return hit || null;
}

/* --------------------------------- create ---------------------------------- */
exports.createBatch = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { loanIds = [] } = req.body;
    if (!Array.isArray(loanIds) || !loanIds.length) {
      await t.rollback();
      return res.status(400).json({ error: 'loanIds[] required' });
    }

    const approvedLabel = await mapStatusToDbEnumLabel('approved');
    if (!approvedLabel) {
      await t.rollback();
      return res.status(400).json({ error: 'loans.status enum not found / approved not allowed' });
    }

    // Only include loans that are actually approved
    const loans = await Loan.findAll({
      where: { id: loanIds, status: approvedLabel },
      transaction: t,
    });
    if (!loans.length) {
      await t.rollback();
      return res.status(400).json({ error: 'No approved loans found' });
    }

    const batch = await DisbursementBatch.create(
      { createdBy: req.user?.id || null, status: 'queued' },
      { transaction: t }
    );

    const items = loans.map((l) => ({
      batchId: batch.id,
      loanId: l.id,
      amount: l.amount,
      status: 'queued',
    }));
    await DisbursementItem.bulkCreate(items, { transaction: t });

    await t.commit();
    res.status(201).json({ id: batch.id, items: items.length });
  } catch (e) {
    try { await t.rollback(); } catch {}
    console.error('[disbursements] createBatch error:', e);
    res.status(500).json({ error: 'Failed to create batch' });
  }
};

/* ---------------------------------- list ----------------------------------- */
exports.listBatches = async (_req, res) => {
  try {
    const batches = await DisbursementBatch.findAll({
      include: [{ model: DisbursementItem, as: 'items' }],
      order: [['createdAt', 'DESC']],
    });
    res.json(batches);
  } catch (e) {
    console.error('[disbursements] listBatches error:', e);
    res.status(500).json({ error: 'Failed to list batches' });
  }
};

/* --------------------------------- export ---------------------------------- */
exports.exportCSV = async (req, res) => {
  try {
    const batch = await DisbursementBatch.findByPk(req.params.id, {
      include: [{ model: DisbursementItem, as: 'items' }],
    });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const data = (batch.items || []).map((i) => ({
      batchId: batch.id,
      loanId: i.loanId,
      amount: Number(i.amount || 0),
      account: '', // fill per integration
      beneficiary: '', // fill per integration
    }));
    const parser = new Parser({
      fields: ['batchId', 'loanId', 'amount', 'account', 'beneficiary'],
    });
    const csv = parser.parse(data);

    res.header('Content-Type', 'text/csv');
    res.attachment(`disbursement_batch_${batch.id}.csv`);
    return res.send(csv);
  } catch (e) {
    console.error('[disbursements] exportCSV error:', e);
    res.status(500).json({ error: 'Export failed' });
  }
};
