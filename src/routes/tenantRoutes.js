const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { authenticateUser } = require('../middleware/authMiddleware');
const tenantResolver = require('../middleware/tenantResolver');

router.get('/me/entitlements', authenticateUser, tenantResolver, async (req, res) => {
  const { Subscription, SubscriptionItem } = sequelize.models;
  const now = new Date();
  const sub = await Subscription.findOne({
    where: { tenantId: req.tenantId, status: 'active', startsAt: { [sequelize.Op.lte]: now }, endsAt: { [sequelize.Op.gte]: now } },
    include: [{ model: SubscriptionItem, as: 'items' }],
    order: [['createdAt','DESC']],
  });
  const activeModules = new Set((sub?.items || []).filter(i => i.active).map(i => i.moduleKey));
  res.json({
    tenantId: req.tenantId,
    subscription: sub ? { startsAt: sub.startsAt, endsAt: sub.endsAt, planName: sub.planName } : null,
    modules: Array.from(activeModules),
  });
});

module.exports = router;
