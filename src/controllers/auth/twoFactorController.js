'use strict';

const { Setting } = require('../../models');

// We store per-user 2FA config under user-scoped keys.
const keyFor = (userId) => `user:${userId}:2fa`;

/**
 * Shape:
 * {
 *   enabled: boolean,
 *   secret: string|null,        // base32
 *   issuer: string,             // e.g., MkopoSuite
 *   label: string               // shown in authenticator app
 * }
 */

function loadSpeakeasy() {
  try {
    // optional dependency; if missing, we return 501 gracefully
    return require('speakeasy');
  } catch (_) {
    return null;
  }
}

const ISSUER_DEFAULT = 'MkopoSuite';

exports.status = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, message: 'Unauthorized' });

    const cfg = await Setting.get(keyFor(userId), { enabled: false, secret: null, issuer: ISSUER_DEFAULT, label: req.user?.email || '' });
    return res.json({ ok: true, enabled: !!cfg.enabled });
  } catch (err) {
    console.error('2FA status error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to load 2FA status' });
  }
};

exports.setup = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, message: 'Unauthorized' });

    const speakeasy = loadSpeakeasy();
    if (!speakeasy) {
      return res.status(501).json({ ok: false, message: '2FA setup not available: install "speakeasy"' });
    }

    const issuer = ISSUER_DEFAULT;
    const label = req.user?.email || `user-${userId}`;
    const secret = speakeasy.generateSecret({ name: `${issuer}:${label}`, issuer });

    // Save draft secret (not enabled yet)
    await Setting.set(
      keyFor(userId),
      { enabled: false, secret: secret.base32, issuer, label },
      req.user?.id || null,
      req.user?.id || null
    );

    // Frontend can render a QR code from otpauth_url if needed
    return res.json({
      ok: true,
      otpauth_url: secret.otpauth_url,
      base32: secret.base32,
      issuer,
      label,
    });
  } catch (err) {
    console.error('2FA setup error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to start 2FA setup' });
  }
};

exports.verify = async (req, res) => {
  try {
    const userId = req.user?.id;
    const token = String(req.body?.token || '').trim();

    if (!userId) return res.status(401).json({ ok: false, message: 'Unauthorized' });
    if (!token) return res.status(400).json({ ok: false, message: 'Token required' });

    const speakeasy = loadSpeakeasy();
    if (!speakeasy) {
      return res.status(501).json({ ok: false, message: '2FA verify not available: install "speakeasy"' });
    }

    const cfg = await Setting.get(keyFor(userId), null);
    if (!cfg?.secret) return res.status(400).json({ ok: false, message: '2FA not in setup state' });

    const verified = speakeasy.totp.verify({
      secret: cfg.secret,
      encoding: 'base32',
      token,
      window: 1, // +/- 30s
    });

    if (!verified) return res.status(400).json({ ok: false, message: 'Invalid token' });

    // Enable 2FA
    await Setting.set(keyFor(userId), { ...cfg, enabled: true }, req.user?.id || null);
    return res.json({ ok: true, enabled: true });
  } catch (err) {
    console.error('2FA verify error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to verify token' });
  }
};

exports.disable = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, message: 'Unauthorized' });

    const cfg = await Setting.get(keyFor(userId), null);
    if (!cfg) {
      // already disabled / never configured
      return res.json({ ok: true, enabled: false });
    }

    await Setting.set(keyFor(userId), { ...cfg, enabled: false, secret: null }, req.user?.id || null);
    return res.json({ ok: true, enabled: false });
  } catch (err) {
    console.error('2FA disable error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to disable 2FA' });
  }
};
