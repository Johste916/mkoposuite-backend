// src/services/paymentGateway.js
// Minimal abstraction to normalize webhook payloads from mobile money / bank.
// Replace stubs with actual verification using provider secrets.

module.exports = () => {
  // Normalize a generic webhook payload into { loanReference, amount, currency, paidAt, gateway, gatewayRef, method }
  const normalizeWebhook = (provider, body) => {
    switch (provider) {
      case 'mobile':
        // Example expected body shape; adapt to your provider
        // { accountRef: 'LN-...', amount: '1000', currency: 'TZS', txn_id: 'ABC123', paid_at: '2025-08-21T10:00:00Z' }
        return {
          loanReference: body.accountRef || body.BillRefNumber || body.account_reference,
          amount: Number(body.amount || body.Amount || 0),
          currency: body.currency || body.Currency || 'TZS',
          paidAt: body.paid_at || body.TransTime || new Date().toISOString(),
          gateway: body.gateway || 'mobile',
          gatewayRef: body.txn_id || body.TransactionID || body.txnId,
          method: 'mobile',
        };
      case 'bank':
        // Example bank payload
        // { meta: { reference: 'LN-...' }, amount: 1000, currency: 'TZS', valueDate: '2025-08-21', id: 'BANK123' }
        return {
          loanReference: body?.meta?.reference || body.reference,
          amount: Number(body.amount || 0),
          currency: body.currency || 'TZS',
          paidAt: body.valueDate || new Date().toISOString(),
          gateway: 'bank',
          gatewayRef: body.id || body.transactionId,
          method: 'bank',
        };
      default:
        return null;
    }
  };

  const verifySignature = (provider, headers, rawBody) => {
    // TODO: implement signature verification using env secrets
    // For now, return true to accept.
    return true;
  };

  return { normalizeWebhook, verifySignature };
};
