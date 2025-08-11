const { DisbursementBatch, DisbursementItem, Loan } = require("../models");
const { Parser } = require("json2csv");

exports.createBatch = async (req, res) => {
  try {
    const { loanIds = [] } = req.body;
    if (!Array.isArray(loanIds) || !loanIds.length) return res.status(400).json({ error: "loanIds[] required" });

    const loans = await Loan.findAll({ where: { id: loanIds, status: "approved" } });
    if (!loans.length) return res.status(400).json({ error: "No approved loans found" });

    const batch = await DisbursementBatch.create({ createdBy: req.user?.id || null, status: "queued" });
    const items = loans.map(l => ({ batchId: batch.id, loanId: l.id, amount: l.amount, status: "queued" }));
    await DisbursementItem.bulkCreate(items);

    res.status(201).json({ id: batch.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create batch" });
  }
};

exports.listBatches = async (_req, res) => {
  const batches = await DisbursementBatch.findAll({ include: [{ model: DisbursementItem, as: "items" }], order: [["createdAt","DESC"]] });
  res.json(batches);
};

exports.exportCSV = async (req, res) => {
  try {
    const batch = await DisbursementBatch.findByPk(req.params.id, { include: [{ model: DisbursementItem, as: "items" }] });
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    const data = batch.items.map(i => ({
      batchId: batch.id, loanId: i.loanId, amount: Number(i.amount || 0),
      account: "", // fill per integration
      beneficiary: "", // fill per integration
    }));
    const parser = new Parser({ fields: ["batchId","loanId","amount","account","beneficiary"] });
    const csv = parser.parse(data);

    res.header("Content-Type", "text/csv");
    res.attachment(`disbursement_batch_${batch.id}.csv`);
    return res.send(csv);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Export failed" });
  }
};
