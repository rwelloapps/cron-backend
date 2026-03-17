/** Billing period length in days (one "month" for subscription) */
const BILLING_CYCLE_DAYS = 28;

/** If mandate fails and payment is pending for more than this many days, put subscription on hold */
const PENDING_HOLD_DAYS = 60;

/** Minimum number of past-due cycles (pending or failed) before putting subscription on hold/suspended */
const FAILED_CYCLES_FOR_HOLD = 2;

/** Mandate statuses considered invalid for charging */
const MANDATE_INVALID_STATUSES = ['rejected', 'expired', 'revoked', 'paused'];

/** Mandate status considered valid for recurring payment */
const MANDATE_CONFIRMED_STATUS = 'confirmed';

module.exports = {
  BILLING_CYCLE_DAYS,
  PENDING_HOLD_DAYS,
  FAILED_CYCLES_FOR_HOLD,
  MANDATE_INVALID_STATUSES,
  MANDATE_CONFIRMED_STATUS
};
