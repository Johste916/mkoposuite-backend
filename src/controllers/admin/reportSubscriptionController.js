// backend/src/controllers/admin/reportSubscriptionController.js
const { ReportSubscription, Role, User } = require('../../models');
const { runReport, listReportDefs } = require('../../reporting/reportRegistry');
const { sendMail } = require('../../utils/mailer');

const baseAttrs = [
  'id','name','reportKey','frequency','timeOfDay','dayOfWeek','dayOfMonth','monthOfYear','cron',
  'format','filters','recipientsType','roleId','userId','emails','active','lastRunAt','nextRunAt','createdBy',
];

exports.listDefs = (_req, res) => res.json(listReportDefs());

exports.list = async (_req, res) => {
  const rows = await ReportSubscription.findAll({ order: [['createdAt','DESC']] });
  res.json(rows);
};

exports.create = async (req, res) => {
  const payload = (({ name, reportKey, frequency, timeOfDay, dayOfWeek, dayOfMonth, monthOfYear, cron, format, filters, recipientsType, roleId, userId, emails, active }) =>
    ({ name, reportKey, frequency, timeOfDay, dayOfWeek, dayOfMonth, monthOfYear, cron, format, filters, recipientsType, roleId, userId, emails, active }))(req.body || {});
  payload.createdBy = req.user?.id || null;
  const row = await ReportSubscription.create(payload);
  res.status(201).json(row);
};

exports.update = async (req, res) => {
  const row = await ReportSubscription.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const data = {};
  for (const k of baseAttrs) if (k in req.body) data[k] = req.body[k];
  await row.update(data);
  res.json(row);
};

exports.remove = async (req, res) => {
  const row = await ReportSubscription.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await row.destroy();
  res.json({ ok: true });
};

// Fire once immediately (no schedule change)
exports.runNow = async (req, res) => {
  const row = await ReportSubscription.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const recipients = await resolveRecipients(row);
  if (recipients.length === 0) return res.status(400).json({ error: 'No recipients' });

  const attachment = await runReport(row.reportKey, { format: row.format, filters: row.filters });
  await sendMail({
    to: recipients.join(','),
    subject: `[Report] ${row.name}`,
    text: `Attached: ${attachment.filename}`,
    attachments: [{ filename: attachment.filename, content: attachment.buffer, contentType: attachment.mime }],
  });

  await row.update({ lastRunAt: new Date() });
  res.json({ ok: true });
};

// Resolve recipients based on role/user/emails
async function resolveRecipients(sub) {
  if (sub.recipientsType === 'emails') return (sub.emails || []).filter(Boolean);

  if (sub.recipientsType === 'user' && sub.userId) {
    const u = await User.findByPk(sub.userId);
    return u?.email ? [u.email] : [];
  }

  if (sub.recipientsType === 'role' && sub.roleId) {
    // Either via join table or column
    const through = User.associations?.Roles;
    if (through) {
      const r = await Role.findByPk(sub.roleId);
      const users = await r.getUsers({ joinTableAttributes: [] });
      return users.map(u => u.email).filter(Boolean);
    }
    // fallback: if User has "role" column + roleId maps to Role.name
    const role = await Role.findByPk(sub.roleId);
    if (!role) return [];
    const list = await User.findAll({ where: { role: role.name } });
    return list.map(u => u.email).filter(Boolean);
  }

  return [];
}

exports._resolveRecipients = resolveRecipients; // help job reuse
