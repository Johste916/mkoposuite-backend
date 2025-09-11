'use strict';
const name = (process.env.SMS_PROVIDER || 'smsco').toLowerCase();

let provider;
switch (name) {
  case 'smsco':
  case 'smsco.tz':
  case 'smscotz':
    provider = require('./providers/smsco');
    break;
  case 'twilio':
    provider = require('./providers/twilio');
    break;
  case 'africastalking':
  case 'at':
    provider = require('./providers/africasTalking');
    break;
  default:
    provider = require('./providers/smsco'); // default to SMS.co.tz
    break;
}

exports.send = (opts) => provider.send(opts);
exports.balance = () => provider.balance();
