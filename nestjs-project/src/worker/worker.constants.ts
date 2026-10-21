/** Hourly: abandoned uploads waste storage but nothing is time-critical. */
export const UPLOAD_REAP_CRON = '0 * * * *';

/**
 * An open upload untouched for this long is considered abandoned. Neither the
 * plan nor any TD defines it; 24 h leaves room for a slow 10 GB upload.
 */
export const UPLOAD_INACTIVITY_LIMIT_MS = 24 * 60 * 60 * 1000;

/** Videos reaped per run; the rest is picked up by the next run. */
export const UPLOAD_REAP_BATCH_SIZE = 100;
