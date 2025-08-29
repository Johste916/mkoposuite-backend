'use strict';

module.exports = {
  async up(q, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, JSONB, INTEGER, BOOLEAN, DATE, ENUM, DECIMAL } = Sequelize;
    await q.sequelize.transaction(async (t) => {
      // Companies (tenants)
      await q.createTable('Companies', {
        id:          { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        name:        { type: STRING(128), allowNull: false },
        slug:        { type: STRING(64),  allowNull: false, unique: true }, // e.g. subdomain
        status:      { type: ENUM('trialing','active','past_due','suspended','canceled'), allowNull: false, defaultValue: 'trialing' },
        trialEndsAt: { type: DATE, allowNull: true },
        graceDays:   { type: INTEGER, allowNull: false, defaultValue: 7 },
        billingEmail:{ type: STRING(160), allowNull: true },
        phone:       { type: STRING(40), allowNull: true },
        country:     { type: STRING(2), allowNull: true },  // 'TZ'
        currency:    { type: STRING(3), allowNull: false, defaultValue: 'TZS' },
        planId:      { type: UUID, allowNull: true },       // soft ref to Plans
        metadata:    { type: JSONB, allowNull: true },

        createdAt:   { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:   { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        suspendedAt: { type: DATE, allowNull: true },
        canceledAt:  { type: DATE, allowNull: true },
      }, { transaction: t });

      await q.addIndex('Companies', ['status'], { transaction: t });
      await q.addIndex('Companies', ['planId'], { transaction: t });

      // Plans
      await q.createTable('Plans', {
        id:            { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        code:          { type: STRING(40), allowNull: false, unique: true }, // 'starter', 'pro'
        name:          { type: STRING(80), allowNull: false },
        currency:      { type: STRING(3), allowNull: false, defaultValue: 'TZS' },
        priceMonthly:  { type: DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        priceYearly:   { type: DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        features:      { type: JSONB, allowNull: true },  // e.g. { loans: true, savings: true, ... }
        limits:        { type: JSONB, allowNull: true },  // e.g. { users: 25, loans: 5000 }
        active:        { type: BOOLEAN, allowNull: false, defaultValue: true },

        createdAt:     { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:     { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });

      // Subscriptions
      await q.createTable('Subscriptions', {
        id:                    { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        companyId:             { type: UUID, allowNull: false, references: { model: 'Companies', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        planId:                { type: UUID, allowNull: false, references: { model: 'Plans', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
        status:                { type: ENUM('trialing','active','past_due','canceled'), allowNull: false, defaultValue: 'trialing' },
        billingInterval:       { type: ENUM('monthly', 'yearly'), allowNull: false, defaultValue: 'monthly' },
        autoRenew:             { type: BOOLEAN, allowNull: false, defaultValue: true },
        currentPeriodStart:    { type: DATE, allowNull: true },
        currentPeriodEnd:      { type: DATE, allowNull: true },
        cancelAt:              { type: DATE, allowNull: true },
        canceledAt:            { type: DATE, allowNull: true },

        createdAt:             { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:             { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });

      await q.addIndex('Subscriptions', ['companyId'], { transaction: t });
      await q.addIndex('Subscriptions', ['status'], { transaction: t });

      // Invoices
      await q.createTable('Invoices', {
        id:            { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        companyId:     { type: UUID, allowNull: false, references: { model: 'Companies', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        subscriptionId:{ type: UUID, allowNull: true, references: { model: 'Subscriptions', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
        number:        { type: STRING(32), allowNull: false, unique: true },
        currency:      { type: STRING(3), allowNull: false, defaultValue: 'TZS' },
        amountDue:     { type: DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        amountPaid:    { type: DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        status:        { type: ENUM('draft','open','paid','past_due','void'), allowNull: false, defaultValue: 'open' },
        issuedAt:      { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        dueAt:         { type: DATE, allowNull: true },
        metadata:      { type: JSONB, allowNull: true },

        createdAt:     { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:     { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });

      await q.addIndex('Invoices', ['companyId'], { transaction: t });
      await q.addIndex('Invoices', ['status'], { transaction: t });

      // Payments (provider-agnostic)
      await q.createTable('Payments', {
        id:           { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        invoiceId:    { type: UUID, allowNull: false, references: { model: 'Invoices', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        provider:     { type: STRING(32), allowNull: false },  // 'stripe', 'flutterwave', 'paystack', 'dpo', 'mpesa'
        providerRef:  { type: STRING(80), allowNull: true },
        currency:     { type: STRING(3), allowNull: false, defaultValue: 'TZS' },
        amount:       { type: DECIMAL(18,2), allowNull: false, defaultValue: 0 },
        status:       { type: ENUM('succeeded','pending','failed','refunded'), allowNull: false, defaultValue: 'pending' },
        paidAt:       { type: DATE, allowNull: true },
        raw:          { type: JSONB, allowNull: true },

        createdAt:    { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:    { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });

      await q.addIndex('Payments', ['provider', 'providerRef'], { unique: false, transaction: t });

      // Per-company feature toggles (works with your FeatureConfigProvider)
      await q.createTable('FeatureConfigs', {
        id:         { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        companyId:  { type: UUID, allowNull: false, references: { model: 'Companies', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        key:        { type: STRING(64), allowNull: false },
        value:      { type: JSONB, allowNull: true },
        createdAt:  { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:  { type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }, { transaction: t });

      await q.addIndex('FeatureConfigs', ['companyId', 'key'], { unique: true, transaction: t });
    });
  },

  async down(q) {
    await q.sequelize.transaction(async (t) => {
      await q.dropTable('FeatureConfigs', { transaction: t });
      await q.dropTable('Payments', { transaction: t });
      await q.dropTable('Invoices', { transaction: t });
      await q.dropTable('Subscriptions', { transaction: t });
      await q.dropTable('Plans', { transaction: t });
      await q.dropTable('Companies', { transaction: t });
    });
  }
};
