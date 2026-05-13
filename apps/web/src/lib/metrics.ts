import { logger } from './logger';
import { captureMessage } from './sentry';

const log = logger.child({ component: 'metrics' });

export type MetricName =
  | 'registration_started'
  | 'registration_validated'
  | 'registration_validation_failed'
  | 'registration_completed'
  | 'registration_failed'
  | 'registration_rate_limited'
  | 'registration_pricing'
  | 'bot_check_passed'
  | 'bot_check_failed'
  | 'payment_required'
  | 'payment_invalid'
  | 'payment_settled'
  | 'payment_settlement_failed'
  | 'treasury_fee_swept'
  | 'treasury_fee_sweep_failed'
  | 'lifi_funding_skipped'
  | 'lifi_funding_quoted'
  | 'lifi_approval_submitted'
  | 'lifi_funding_submitted'
  | 'lifi_funding_completed'
  | 'lifi_funding_failed'
  | 'email_inbound_ignored'
  | 'email_inbound_blocked'
  | 'email_inbound_stored'
  | 'email_sent'
  | 'mint_submitted'
  | 'mint_succeeded'
  | 'mint_failed';

export function recordMetric(name: MetricName, fields: Record<string, unknown> = {}, value = 1) {
  log.info('metric', {
    metric: name,
    value,
    ...fields,
  });

  if (name.endsWith('_failed')) {
    captureMessage(`metric:${name}`, 'warning').catch(() => {});
  }
}
