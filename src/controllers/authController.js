'use strict';

const { Setting } = require('../models');           // uses your generic Setting model (no DB migration)
const { authenticator } = require('otplib');        // npm i otplib
authenticator.options = { window: 1 };              // tolerate slight clock drift

const APP_NAME = process.env.APP_NAME || 'MkopoSuite';
const KEY_FOR = (userId) => `user.2fa.${userId}`;

/**
 * GET /api/auth/2fa/status
 * -> { enabled: boolean }
 */
exports.status = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const cfg = await Setting.get(KEY_FOR(userId), null);
  res.json({ enabled: !!(cfg && cfg.enabled && cfg.secret) });
};

/**
 * POST /api/auth/2fa/setup
 * -> { secret, otpauthUrl }
 *
 * Generates a secret and stores it (enabled=false). User must verify next.
 */
exports.setup = async (req, res) => {
  const userId = req.user?.id;
  const email  = req.user?.email || 'user@example.com';
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(email, APP_NAME, secret);

  await Setting.set(
    KEY_FOR(userId),
    { enabled: false, secret },
    String(userId)
  );

  res.status(201).json({ secret, otpauthUrl });
};

/**
 * POST /api/auth/2fa/verify  body: { token }
 * -> enables 2FA if token matches the stored secret
 */
exports.verify = async (req, res) => {
  const userId = req.user?.id;
  const token  = String(req.body?.token || '').trim();
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  if (!token)  return res.status(400).json({ message: 'Token is required' });

  const cfg = await Setting.get(KEY_FOR(userId), null);
  if (!cfg?.secret) return res.status(400).json({ message: 'No 2FA setup in progress' });

  const isValid = authenticator.verify({ token, secret: cfg.secret });
  if (!isValid) return res.status(400).json({ message: 'Invalid code' });

  await Setting.set(
    KEY_FOR(userId),
    { enabled: true, secret: cfg.secret },
    String(userId)
  );

  res.json({ enabled: true });
};

/**
 * POST /api/auth/2fa/disable  body: { token }
 * -> disables 2FA (requires a valid current code)
 */
exports.disable = async (req, res) => {
  const userId = req.user?.id;
  const token  = String(req.body?.token || '').trim();
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  if (!token)  return res.status(400).json({ message: 'Token is required' });

  const cfg = await Setting.get(KEY_FOR(userId), null);
  if (!cfg?.secret || !cfg?.enabled) {
    return res.status(400).json({ message: '2FA is not enabled' });
  }

  const isValid = authenticator.verify({ token, secret: cfg.secret });
  if (!isValid) return res.status(400).json({ message: 'Invalid code' });

  await Setting.set(KEY_FOR(userId), { enabled: false, secret: null }, String(userId));
  res.json({ enabled: false });
};
