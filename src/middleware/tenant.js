module.exports.resolveTenant = (db) => async (req, res, next) => {
  try {
    const headerTenant = req.headers['x-tenant-id']; // UUID
    const host = req.headers.host || '';
    const sub = host.split('.')[0]; // subdomain
    let company = null;

    if (headerTenant) {
      company = await db.Company.findByPk(headerTenant);
    } else if (sub && sub !== 'www' && sub !== 'app') {
      company = await db.Company.findOne({ where: { slug: sub } });
    }

    if (!company) {
      // fallback to default; you can also reject here
      const fallback = process.env.DEFAULT_TENANT_ID;
      if (fallback) company = await db.Company.findByPk(fallback);
    }

    if (!company) return res.status(400).json({ error: 'Tenant not resolved' });

    req.tenant = { id: company.id, slug: company.slug, status: company.status, graceDays: company.graceDays, planId: company.planId };
    req.company = company;
    next();
  } catch (e) { next(e); }
};

module.exports.enforceSubscription = (db) => async (req, res, next) => {
  // Allow auth/billing endpoints even if suspended
  if (/^\/api\/(auth|billing)/.test(req.path)) return next();

  try {
    const company = req.company;
    if (!company) return res.status(400).json({ error: 'Tenant not resolved' });

    // Trial logic
    const now = new Date();
    if (company.status === 'trialing') {
      if (company.trialEndsAt && now > company.trialEndsAt) {
        // grace window after trial?
        return res.status(402).json({ error: 'Trial ended. Please subscribe to continue.' });
      }
      return next();
    }

    if (company.status === 'suspended') {
      return res.status(402).json({ error: 'Account suspended for non-payment. Please pay to re-activate.' });
    }

    // Active / past_due allowed; deeper checks handled by cron/invoice status.
    next();
  } catch (e) { next(e); }
};
