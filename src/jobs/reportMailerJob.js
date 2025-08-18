// backend/src/jobs/reportMailerJob.js
const cron = require('node-cron');
const { Op } = require('sequelize');
const { ReportSubscription } = require('../models');
const { runReport } = require('../reporting/reportRegistry');
const { sendMail } = require('../utils/mailer');
const ctl = require('../controllers/admin/reportSubscriptionController');

let task;

function hhmmToDateToday(hhmm) {
  const [h,m] = String(hhmm || '09:00').split(':').map(Number);
  const d = new Date(); d.setSeconds(0,0); d.setHours(h||9, m||0, 0, 0); return d;
}

function computeNextRun(sub, from = new Date()) {
  const base = new Date(from);
  const t = (sub.timeOfDay || '09:00').split(':').map(Number);
  const setHM = (d) => { d.setHours(t[0]||9, t[1]||0, 0, 0); return d; };

  const addDays = (d, n=1) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const addMonths = (d, n=1) => { const x = new Date(d); x.setMonth(x.getMonth()+n); return x; };

  if (sub.frequency === 'custom' && sub.cron) return null; // handled by own cron externally (future)

  switch (sub.frequency) {
    case 'daily': {
      let next = setHM(new Date(base));
      if (next <= from) next = addDays(next, 1);
      return next;
    }
    case 'weekly': {
      const targetDow = Number(sub.dayOfWeek ?? 1); // default Mon
      const curDow = base.getDay();
      let diff = targetDow - curDow;
      if (diff < 0 || (diff === 0 && setHM(new Date(base)) <= from)) diff += 7;
      const next = addDays(setHM(new Date(base)), diff);
      return next;
    }
    case 'monthly': {
      const dom = Math.min(Math.max(Number(sub.dayOfMonth)||1,1),28);
      let next = setHM(new Date(base)); next.setDate(dom);
      if (next <= from) { next = setHM(addMonths(new Date(base), 1)); next.setDate(dom); }
      return next;
    }
    case 'quarterly': {
      const dom = Math.min(Math.max(Number(sub.dayOfMonth)||1,1),28);
      let next = setHM(new Date(base)); next.setDate(dom);
      if (next <= from) next = setHM(addMonths(next, 3));
      return next;
    }
    case 'semiannual': {
      const dom = Math.min(Math.max(Number(sub.dayOfMonth)||1,1),28);
      let next = setHM(new Date(base)); next.setDate(dom);
      if (next <= from) next = setHM(addMonths(next, 6));
      return next;
    }
    case 'annual': {
      const dom = Math.min(Math.max(Number(sub.dayOfMonth)||1,1),28);
      let next = setHM(new Date(base)); next.setDate(dom);
      if (next <= from) next = setHM(addMonths(next, 12));
      return next;
    }
    default:
      return addDays(setHM(new Date(base)), 1);
  }
}

async function tick() {
  const now = new Date();
  const dueRows = await ReportSubscription.findAll({
    where: {
      active: true,
      [Op.or]: [
        { nextRunAt: { [Op.lte]: now } },
        { nextRunAt: null },
      ],
    },
    limit: 20,
  });

  for (const sub of dueRows) {
    try {
      // Resolve recipients
      const recipients = await ctl._resolveRecipients(sub);
      if (recipients.length === 0) {
        await sub.update({ lastRunAt: now, nextRunAt: computeNextRun(sub, addMinutes(now, 5)) });
        continue;
      }

      // Build attachment
      const attachment = await runReport(sub.reportKey, { format: sub.format, filters: sub.filters });

      // Send
      await sendMail({
        to: recipients.join(','),
        subject: `[Scheduled Report] ${sub.name}`,
        text: `Attached: ${attachment.filename}`,
        attachments: [{ filename: attachment.filename, content: attachment.buffer, contentType: attachment.mime }],
      });

      await sub.update({ lastRunAt: now, nextRunAt: computeNextRun(sub, now) });
    } catch (e) {
      console.error('[reportMailerJob] sub failed:', sub.id, e);
      // still move nextRun to avoid tight loops
      await sub.update({ lastRunAt: now, nextRunAt: computeNextRun(sub, now) }).catch(()=>{});
    }
  }
}

function addMinutes(d, n) { const x = new Date(d); x.setMinutes(x.getMinutes()+n); return x; }

function start() {
  if (task) return;
  // every 5 minutes
  task = cron.schedule('*/5 * * * *', tick, { scheduled: true });
  console.log('[reportMailerJob] scheduled every 5 minutes');
}
function stop() { try { task?.stop(); } catch {} }

module.exports = { start, stop, computeNextRun };
