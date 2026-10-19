import { ALERT_POLL_MS } from '@shared/alerts';

// How long an answer counts as fresh before the next read refreshes it behind the scenes.
// `delegated` leaves the term to the HTTP cache below, which follows the site's Cache-Control.
export const FRESH_MS = {
  delegated: 0,
  card: 20_000,
  owned: 20_000,
  favorites: 60_000,
  alerts: 60_000,
  votePauses: 60_000,
  alertSettings: ALERT_POLL_MS,
} as const;
