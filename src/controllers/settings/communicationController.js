const { Communication, CommunicationAttachment } = require('../../models');
const { Op } = require('sequelize');

exports.list = async (req, res) => {
  try {
    const { q = '', page = 1, pageSize = 20, type, isActive, branchId } = req.query;
    const where = {};
    if (q) where[Op.or] = [{ title: { [Op.iLike || Op.substring]: `%${q}%` } }, { text: { [Op.iLike || Op.substring]: `%${q}%` } }];
    if (type) where.type = type;
    if (typeof isActive !== 'undefined') where.isActive = isActive === 'true';
    if (branchId) where.audienceBranchId = branchId;

    const { count, rows } = await Communication.findAndCountAll({
      where,
      include: [{ model: CommunicationAttachment, as: 'attachments' }],
      order: [['createdAt', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: Number(pageSize)
    });
    res.json({ items: rows, total: count });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list communications' });
  }
};

exports.create = async (req, res) => {
  try {
    const payload = {
      title: req.body.title,
      text: req.body.text,
      type: req.body.type,
      priority: req.body.priority,
      audienceRole: req.body.audienceRole || null,
      audienceBranchId: req.body.audienceBranchId || null,
      startAt: req.body.startAt || null,
      endAt: req.body.endAt || null,
      showOnDashboard: req.body.showOnDashboard !== false,
      showInTicker: req.body.showInTicker !== false,
      isActive: req.body.isActive !== false,
      createdBy: req.user.id,
      updatedBy: req.user.id
    };
    const c = await Communication.create(payload);
    res.status(201).json(c);
  } catch (e) {
    res.status(400).json({ error: 'Failed to create communication' });
  }
};

exports.getOne = async (req, res) => {
  try {
    const c = await Communication.findByPk(req.params.id, {
      include: [{ model: CommunicationAttachment, as: 'attachments' }]
    });
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch communication' });
  }
};

exports.update = async (req, res) => {
  try {
    const c = await Communication.findByPk(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    await c.update({ ...req.body, updatedBy: req.user.id });
    res.json(c);
  } catch (e) {
    res.status(400).json({ error: 'Failed to update communication' });
  }
};

exports.remove = async (req, res) => {
  try {
    const c = await Communication.findByPk(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    await c.destroy();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete communication' });
  }
};

// Attachments — assume you already handle file upload elsewhere (S3 pre-sign or local upload).
exports.addAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    const { fileName, mimeType, size, fileUrl } = req.body; // if using pre-signed upload, FE sends these
    const c = await Communication.findByPk(id);
    if (!c) return res.status(404).json({ error: 'Communication not found' });

    const att = await CommunicationAttachment.create({ communicationId: id, fileName, mimeType, size, fileUrl });
    res.status(201).json(att);
  } catch (e) {
    res.status(400).json({ error: 'Failed to add attachment' });
  }
};

exports.removeAttachment = async (req, res) => {
  try {
    const { id, attId } = req.params;
    const att = await CommunicationAttachment.findOne({ where: { id: attId, communicationId: id } });
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    await att.destroy();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove attachment' });
  }
};
