const db = require('../db');
const config = require('../config');
const logger = require('../lib/logger');
const hubspot = require('../lib/hubspot');
const { buildContactFromOrder, parseUnleashedDate } = require('../lib/parsers');

async function saveOrderState(orderGuid, orderNumber, contactId, dealId, eventNotificationId) {
  await db.query(
    `
      INSERT INTO order_sync_state (
        sales_order_guid,
        order_number,
        hubspot_contact_id,
        hubspot_deal_id,
        last_event_notification_id,
        synced_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (sales_order_guid)
      DO UPDATE SET
        order_number = EXCLUDED.order_number,
        hubspot_contact_id = EXCLUDED.hubspot_contact_id,
        hubspot_deal_id = EXCLUDED.hubspot_deal_id,
        last_event_notification_id = EXCLUDED.last_event_notification_id,
        synced_at = NOW()
    `,
    [orderGuid, orderNumber, contactId || null, dealId || null, eventNotificationId || null],
  );
}

async function saveLineItemState(orderGuid, lineGuid, hubspotLineItemId) {
  await db.query(
    `
      INSERT INTO line_item_sync_state (
        sales_order_guid,
        sales_order_line_guid,
        hubspot_line_item_id,
        synced_at
      )
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (sales_order_guid, sales_order_line_guid)
      DO UPDATE SET
        hubspot_line_item_id = EXCLUDED.hubspot_line_item_id,
        synced_at = NOW()
    `,
    [orderGuid, lineGuid, hubspotLineItemId],
  );
}

async function deleteMissingLineItems(orderGuid, liveLineGuids) {
  if (!config.hubspot.deleteMissingLineItems) return;

  const result = await db.query(
    `SELECT sales_order_line_guid, hubspot_line_item_id
     FROM line_item_sync_state
     WHERE sales_order_guid = $1`,
    [orderGuid],
  );

  for (const row of result.rows) {
    if (liveLineGuids.has(row.sales_order_line_guid)) continue;

    logger.info('Archiving missing HubSpot line item', row);
    await hubspot.deleteObject('line_items', row.hubspot_line_item_id);
    await db.query(
      `DELETE FROM line_item_sync_state WHERE sales_order_guid = $1 AND sales_order_line_guid = $2`,
      [orderGuid, row.sales_order_line_guid],
    );
  }
}

async function syncSalesOrder(order, eventNotificationId) {
  order.OrderDateIso = parseUnleashedDate(order.OrderDate);

  const parsedContact = buildContactFromOrder(order);
  parsedContact.fallbackValue = parsedContact.fullName || order.Customer?.CustomerName || order.OrderNumber;

  const lines = Array.isArray(order.SalesOrderLines) ? order.SalesOrderLines : [];
  const currentLineGuids = new Set(lines.filter((line) => line?.Guid).map((line) => line.Guid));

  if (config.dryRun) {
    logger.info('DRY RUN: order parsed successfully; skipping HubSpot writes', {
      eventNotificationId,
      salesOrderGuid: order.Guid,
      orderNumber: order.OrderNumber,
      parsedContact,
      lineCount: currentLineGuids.size,
    });

    await saveOrderState(order.Guid, order.OrderNumber, null, null, eventNotificationId);

    return {
      dryRun: true,
      contactPreview: parsedContact,
      dealPreview: {
        orderNumber: order.OrderNumber,
        guid: order.Guid,
        orderDateIso: order.OrderDateIso || null,
      },
      lineCount: currentLineGuids.size,
    };
  }

  const contact = await hubspot.upsertContact(parsedContact);
  const deal = await hubspot.upsertDeal(order, contact);

  if (contact?.id && deal?.id) {
    await hubspot.associateDefault('contact', contact.id, 'deal', deal.id);
  }

  for (const line of lines) {
    if (!line?.Guid) continue;

    const hubspotLineItem = await hubspot.createOrUpdateLineItem(line, order, deal.id);
    await saveLineItemState(order.Guid, line.Guid, hubspotLineItem.id);
  }

  await deleteMissingLineItems(order.Guid, currentLineGuids);
  await saveOrderState(order.Guid, order.OrderNumber, contact?.id, deal?.id, eventNotificationId);

  return {
    contactId: contact?.id || null,
    dealId: deal?.id || null,
    lineCount: currentLineGuids.size,
  };
}

module.exports = {
  syncSalesOrder,
};
