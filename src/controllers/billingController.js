'use strict';
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

const num = (v) => Number(v || 0);
const addMonths = (d, n=1) => { const x = new Date(d); x.setMonth(x.getMonth()+n); return x; };
const addYears  = (d, n=1) => { const x = new Date(d); x.setFullYear(x.getFullYear()+n); return x; };

exports.getCompanySummary = async (req, res, next) => {
  try {
    const { Company, Subscription, Invoice, Payment, Plan } = req.app.get('models') || require('../models');
    const c = await Company.findByPk(req.company.id, { include: [{ model: Subscription }, { model: Invoice, limit: 10, order: [['issuedAt','DESC']] }]});
    const plan = c.planId ? await Plan.findByPk(c.planId) : null;
    res.json({ company: c, plan });
  } catch (e) { next(e); }
};

exports.listPlans = async (_req, res, next) => {
  try {
    const { Plan } = require('../models');
    const rows = await Plan.findAll({ where: { active: true }, order: [['priceMonthly','ASC']] });
    res.json(rows);
  } catch (e) { next(e); }
};

exports.updateCompanyPlan = async (req, res, next) => {
  try {
    const { Company, Subscription, Plan } = require('../models');
    const { planId, interval = 'monthly' } = req.body || {};
    const plan = await Plan.findByPk(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const company = await Company.findByPk(req.company.id);
    company.planId = plan.id;
    if (company.status === 'trialing' && company.trialEndsAt && new Date() > company.trialEndsAt) {
      company.status = 'active';
    }
    await company.save();

    // upsert subscription
    let sub = await Subscription.findOne({ where: { companyId: company.id, status: { [Op.in]: ['trialing','active','past_due'] } } });
    const now = new Date();
    if (!sub) {
      sub = await Subscription.create({
        companyId: company.id, planId: plan.id, status: company.status, billingInterval: interval,
        currentPeriodStart: now, currentPeriodEnd: interval === 'yearly' ? addYears(now,1) : addMonths(now,1),
      });
    } else {
      sub.planId = plan.id;
      sub.billingInterval = interval;
      await sub.save();
    }
    res.json({ ok: true, company, subscription: sub });
  } catch (e) { next(e); }
};

exports.generateInvoice = async (req, res, next) => {
  try {
    const { Company, Subscription, Invoice, Plan } = require('../models');
    const company = await Company.findByPk(req.company.id);
    const sub = await Subscription.findOne({ where: { companyId: company.id, status: { [Op.in]: ['trialing','active','past_due'] } } });
    if (!sub) return res.status(400).json({ error: 'No active subscription' });

    const plan = await Plan.findByPk(sub.planId);
    const amount = sub.billingInterval === 'yearly' ? plan.priceYearly : plan.priceMonthly;
    const number = `INV-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${uuidv4().slice(0,8).toUpperCase()}`;
    const due = new Date(); due.setDate(due.getDate()+7);

    const inv = await Invoice.create({
      companyId: company.id,
      subscriptionId: sub.id,
      number,
      currency: plan.currency || company.currency,
      amountDue: amount,
      amountPaid: 0,
      status: 'open',
      issuedAt: new Date(),
      dueAt: due,
    });

    res.json({ ok: true, invoice: inv });
  } catch (e) { next(e); }
};

exports.recordPayment = async (req, res, next) => {
  try {
    const { Invoice, Payment, Company, Subscription } = require('../models');
    const { invoiceId, provider='manual', providerRef=null, amount } = req.body || {};
    const inv = await Invoice.findByPk(invoiceId);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const payment = await Payment.create({
      invoiceId: inv.id, provider, providerRef, currency: inv.currency, amount, status: 'succeeded', paidAt: new Date()
    });

    inv.amountPaid = num(inv.amountPaid) + num(amount);
    if (num(inv.amountPaid) >= num(inv.amountDue)) inv.status = 'paid';
    await inv.save();

    // Reactivate if paid
    if (inv.status === 'paid') {
      const company = await Company.findByPk(inv.companyId);
      if (company.status !== 'canceled') {
        company.status = 'active';
        company.suspendedAt = null;
        await company.save();
      }
      const sub = await Subscription.findOne({ where: { id: inv.subscriptionId } });
      if (sub) sub.status = 'active', await sub.save();
    }

    res.json({ ok: true, payment, invoice: inv });
  } catch (e) { next(e); }
};

// Daily job: create invoices at period end, mark past_due, suspend after grace
exports.runDailyBillingCycle = async (_req, res, next) => {
  try {
    const { Company, Subscription, Invoice, Plan } = require('../models');
    const now = new Date();

    const subs = await Subscription.findAll({ where: { status: { [Op.in]: ['trialing','active','past_due'] } } });
    for (const s of subs) {
      const company = await Company.findByPk(s.companyId);
      if (!company) continue;

      // Trial expiry -> past_due
      if (company.status === 'trialing' && company.trialEndsAt && now > company.trialEndsAt) {
        company.status = 'past_due'; await company.save();
      }

      // Period ended? Generate invoice (if none open this period)
      if (s.currentPeriodEnd && now > s.currentPeriodEnd) {
        const plan = await Plan.findByPk(s.planId);
        const existingOpen = await Invoice.findOne({ where: { companyId: company.id, status: { [Op.in]: ['open','past_due'] } } });
        if (!existingOpen) {
          const amount = s.billingInterval === 'yearly' ? plan.priceYearly : plan.priceMonthly;
          const number = `INV-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${uuidv4().slice(0,8).toUpperCase()}`;
          const due = new Date(); due.setDate(due.getDate()+7);
          await Invoice.create({
            companyId: company.id, subscriptionId: s.id,
            number, currency: plan.currency || company.currency,
            amountDue: amount, amountPaid: 0,
            status: 'open', issuedAt: now, dueAt: due,
          });
        }
        // roll next period
        s.currentPeriodStart = now;
        s.currentPeriodEnd = s.billingInterval === 'yearly' ? addYears(now,1) : addMonths(now,1);
        await s.save();
      }

      // Overdue handling
      const openInv = await (await Subscription.sequelize).models.Invoice.findOne({
        where: { companyId: company.id, status: { [Op.in]: ['open','past_due'] } },
        order: [['issuedAt','DESC']]
      });
      if (openInv && openInv.dueAt && now > openInv.dueAt) {
        if (openInv.status !== 'past_due') {
          openInv.status = 'past_due'; await openInv.save();
          company.status = 'past_due'; await company.save();
        }
        // suspend after graceDays from dueAt
        const cutoff = new Date(openInv.dueAt); cutoff.setDate(cutoff.getDate() + (company.graceDays || 7));
        if (now > cutoff && company.status !== 'suspended') {
          company.status = 'suspended';
          company.suspendedAt = now;
          await company.save();
        }
      }
    }

    res.json({ ok: true });
  } catch (e) { next(e); }
};
