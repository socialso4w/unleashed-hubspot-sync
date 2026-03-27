const dotenv = require('dotenv');
dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback = '') {
  const value = process.env[name];
  return value == null ? fallback : value;
}

function asBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
}

function asInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

const dryRun = asBool('DRY_RUN', false);
const disableDatabase = asBool('DISABLE_DATABASE', false);

module.exports = {
  port: asInt('PORT', 3000),
  dryRun,
  disableDatabase,
  skipWebhookSignatureVerify: asBool('SKIP_WEBHOOK_SIGNATURE_VERIFY', false),
  databaseUrl: disableDatabase ? optional('DATABASE_URL', '') : required('DATABASE_URL'),
  unleashed: {
    baseUrl: optional('UNLEASHED_API_BASE_URL', 'https://api.unleashedsoftware.com').replace(/\/$/, ''),
    apiId: required('UNLEASHED_API_ID'),
    apiKey: required('UNLEASHED_API_KEY'),
    webhookSignatureKey: optional('UNLEASHED_WEBHOOK_SIGNATURE_KEY', ''),
    clientType: optional('UNLEASHED_CLIENT_TYPE', 'unleashed-hubspot-sync'),
    maxOrderFetchAttempts: asInt('MAX_ORDER_FETCH_ATTEMPTS', 5),
    orderFetchBackoffMs: asInt('ORDER_FETCH_BACKOFF_MS', 2000),
  },
  hubspot: {
    baseUrl: optional('HUBSPOT_API_BASE_URL', 'https://api.hubapi.com').replace(/\/$/, ''),
    accessToken: dryRun ? optional('HUBSPOT_ACCESS_TOKEN', 'dry-run') : required('HUBSPOT_ACCESS_TOKEN'),
    dealPipeline: optional('HUBSPOT_DEAL_PIPELINE', 'default'),
    dealStage: optional('HUBSPOT_DEAL_STAGE', 'appointmentscheduled'),
    dealExternalIdProperty: optional('DEAL_EXTERNAL_ID_PROPERTY', 'unleashed_order_number'),
    dealGuidProperty: optional('DEAL_GUID_PROPERTY', 'unleashed_sales_order_guid'),
    lineItemExternalIdProperty: optional('LINE_ITEM_EXTERNAL_ID_PROPERTY', 'unleashed_sales_order_line_guid'),
    lineItemOrderNumberProperty: optional('LINE_ITEM_ORDER_NUMBER_PROPERTY', 'unleashed_order_number'),
    contactFallbackProperty: optional('CONTACT_FALLBACK_PROPERTY', ''),
    allowContactCreateWithoutEmail: asBool('ALLOW_CONTACT_CREATE_WITHOUT_EMAIL', true),
    deleteMissingLineItems: asBool('DELETE_MISSING_LINE_ITEMS', false),
    contactOwnerId: optional('CONTACT_OWNER_ID', ''),
    dealOwnerId: optional('DEAL_OWNER_ID', ''),
  },
  workerPollMs: asInt('WORKER_POLL_MS', 2000),
  processOnlyEventsCreatedAfter: optional('PROCESS_ONLY_EVENTS_CREATED_AFTER', ''),
  autoIgnoreEventsOlderThanStartup: asBool('AUTO_IGNORE_EVENTS_OLDER_THAN_STARTUP', false),
};
