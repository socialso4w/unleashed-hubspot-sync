CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  subscription_id TEXT,
  event_notification_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  created_on TIMESTAMPTZ,
  sales_order_guid TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS webhook_events_status_idx
  ON webhook_events (status, queued_at);

CREATE TABLE IF NOT EXISTS order_sync_state (
  sales_order_guid TEXT PRIMARY KEY,
  order_number TEXT,
  hubspot_contact_id TEXT,
  hubspot_deal_id TEXT,
  last_event_notification_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS line_item_sync_state (
  sales_order_guid TEXT NOT NULL,
  sales_order_line_guid TEXT NOT NULL,
  hubspot_line_item_id TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sales_order_guid, sales_order_line_guid)
);
