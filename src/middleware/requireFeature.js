const { sequelize } = require('../models');
module.exports = function requireFeature(moduleKey) {
  return async function(req, res, next) {
    try {
      const { Subscription, SubscriptionItem } = sequelize.models;
      if (!req.tenantId) throw Object.assign(new Error('Tenant missing'), { status: 401, expose: true });

      // Find active subscription for tenant
      const now = new Date();
      const sub = await Subscription.findOne({
        where: { tenantId: req.tenantId, status: 'active', startsAt: { [sequelize.Op.lte]: now }, endsAt: { [sequelize.Op.gte]: now } },
        include: [{ model: SubscriptionItem, as: 'items', where: { moduleKey }, required: false }],
      });

      const item = sub?.items?.find(i => i.moduleKey === moduleKey && i.active);
      if (!sub || !item) {
        return res.status(402).json({
          error: 'Module not active. Please subscribe to continue.',
          module: moduleKey,
          code: 'BILLING_LOCKED',
        });
      }
      next();
    } catch (e) {
      const status = e.status || 500;
      res.status(status).json({ error: e.expose ? e.message : 'Internal Server Error' });
    }
  };
};
