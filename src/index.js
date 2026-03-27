const express = require('express');
const config = require('./config');
const db = require('./db');
const logger = require('./lib/logger');
const { verifyWebhookSignature, getSalesOrderEventually } = require('./lib/unleashed');
const { syncSalesOrder } = require('./services/syncSalesOrder');

const app = express();
const serverStartedAtIso = new Date().toISOString();

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

app.get('/health', async (_req, res) => {
  if (config.disableDatabase) {
    return res.json({ ok: true, database: 'disabled', dryRun: config.dryRun });
  }
  await db.query('SELECT 1');
  res.json({ ok: true, database: 'connected', dryRun: config.dryRun });
});

function parsePayloadData(payload) {
  try {
    return typeof payload.data === 'string' ? JSON.parse(payload.data) : (payload.data || {});
  } catch {
    return {};
  }
}

async function processPayloadDirect(payload) {
  const eventType = payload.eventType;

  if (isOlderThanCutoff(payload.createdOn)) {
    return { ignored: true, reason: `Ignored because createdOn is older than the active cutoff (${getEffectiveCutoffIso()})` };
  }

  if (!['salesorder.created', 'salesorder.updated'].includes(eventType)) {
    return { ignored: true, reason: `Ignored unsupported event type: ${eventType}` };
  }

  const eventData = parsePayloadData(payload);
  const salesOrderGuid = eventData.salesOrderGuid || eventData.SalesOrderGuid || null;

  if (!salesOrderGuid) {
    return { ignored: true, reason: 'No salesOrderGuid present in webhook payload' };
  }

  const order = await getSalesOrderEventually(salesOrderGuid);
  const result = await syncSalesOrder(order, payload.eventNotificationId || 'direct-test');
  return {
    ok: true,
    salesOrderGuid,
    orderNumber: order.OrderNumber,
    result,
  };
}

app.post('/webhooks/unleashed', async (req, res) => {
  try {
    const signature = req.headers['x-unleashed-signature'];
    const timestamp = req.headers['x-unleashed-timestamp'];

    const valid = config.skipWebhookSignatureVerify || verifyWebhookSignature({
      signature,
      timestamp,
      rawBody: req.rawBody,
      signatureKey: config.unleashed.webhookSignatureKey,
    });

    if (!valid) {
      logger.warn('Rejected webhook with invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = req.body;
    const eventData = parsePayloadData(payload);
    const salesOrderGuid = eventData.salesOrderGuid || eventData.SalesOrderGuid || null;

    if (config.disableDatabase) {
      const directResult = await processPayloadDirect(payload);
      return res.status(200).json(directResult);
    }

    await db.query(
      `
        INSERT INTO webhook_events (
          subscription_id,
          event_notification_id,
          event_type,
          created_on,
          sales_order_guid,
          payload,
          status,
          queued_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'queued', NOW())
        ON CONFLICT (event_notification_id) DO NOTHING
      `,
      [
  payload.subscriptionId || payload.SubscriptionId || null,
  payload.eventNotificationId || payload.EventNotificationId || payload.id || payload.Id,
  payload.eventType || payload.EventType,
  payload.createdOn || payload.CreatedOn || null,
  salesOrderGuid,
  payload,
],
    );

    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Webhook handler failed', {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function claimNextEvent() {
  return db.withTransaction(async (client) => {
    const result = await client.query(
      `
        WITH next_event AS (
          SELECT id
          FROM webhook_events
          WHERE status = 'queued'
          ORDER BY queued_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE webhook_events e
        SET status = 'processing',
            attempts = attempts + 1,
            started_at = NOW()
        FROM next_event
        WHERE e.id = next_event.id
        RETURNING e.*
      `,
    );

    return result.rows[0] || null;
  });
}

async function markProcessed(id) {
  await db.query(
    `UPDATE webhook_events SET status = 'processed', processed_at = NOW(), last_error = NULL WHERE id = $1`,
    [id],
  );
}

async function markIgnored(id, reason) {
  await db.query(
    `UPDATE webhook_events SET status = 'ignored', processed_at = NOW(), last_error = $2 WHERE id = $1`,
    [id, reason],
  );
}

async function markFailed(id, error) {
  await db.query(
    `UPDATE webhook_events SET status = 'failed', last_error = $2 WHERE id = $1`,
    [id, error?.message || String(error)],
  );
}

function getEffectiveCutoffIso() {
  if (config.processOnlyEventsCreatedAfter) return config.processOnlyEventsCreatedAfter;
  if (config.autoIgnoreEventsOlderThanStartup) return serverStartedAtIso;
  return '';
}

function isOlderThanCutoff(createdOn) {
  const cutoffIso = getEffectiveCutoffIso();
  if (!cutoffIso) return false;
  if (!createdOn) return false;
  const created = new Date(createdOn);
  const cutoff = new Date(cutoffIso);
  if (Number.isNaN(created.getTime()) || Number.isNaN(cutoff.getTime())) return false;
  return created < cutoff;
}

async function processEvent(eventRow) {
  const payload = eventRow.payload;
  const eventType = payload.eventType;

  if (isOlderThanCutoff(payload.createdOn)) {
    await markIgnored(eventRow.id, `Ignored because createdOn is older than the active cutoff (${getEffectiveCutoffIso()})`);
    return;
  }

  if (!['salesorder.created', 'salesorder.updated'].includes(eventType)) {
    await markIgnored(eventRow.id, `Ignored unsupported event type: ${eventType}`);
    return;
  }

  const eventData = parsePayloadData(payload);

  const salesOrderGuid = eventData.salesOrderGuid || eventData.SalesOrderGuid || eventRow.sales_order_guid;
  if (!salesOrderGuid) {
    await markIgnored(eventRow.id, 'No salesOrderGuid present in webhook payload');
    return;
  }

  const order = await getSalesOrderEventually(salesOrderGuid);
  const result = await syncSalesOrder(order, payload.eventNotificationId);

  logger.info('Sales order synced', {
    eventNotificationId: payload.eventNotificationId,
    salesOrderGuid,
    orderNumber: order.OrderNumber,
    ...result,
  });

  await markProcessed(eventRow.id);
}

let workerRunning = false;

async function workerTick() {
  if (workerRunning) return;
  workerRunning = true;

  try {
    const nextEvent = await claimNextEvent();
    if (!nextEvent) return;

    try {
      await processEvent(nextEvent);
    } catch (error) {
      logger.error('Failed to process queued event', {
        id: nextEvent.id,
        error: error.message,
        status: error.status,
        payload: error.payload,
      });
      await markFailed(nextEvent.id, error);
    }
  } finally {
    workerRunning = false;
  }
}

if (!config.disableDatabase) {
  setInterval(() => {
    workerTick().catch((error) => {
      logger.error('Worker tick crashed', { error: error.message, stack: error.stack });
    });
  }, config.workerPollMs);
}

app.listen(config.port, () => {
  logger.info(`Server listening on port ${config.port}`, {
    startupCutoff: config.autoIgnoreEventsOlderThanStartup ? serverStartedAtIso : null,
    processOnlyEventsCreatedAfter: config.processOnlyEventsCreatedAfter || null,
    disableDatabase: config.disableDatabase,
    dryRun: config.dryRun,
  });
});
