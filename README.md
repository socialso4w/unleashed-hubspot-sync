# Unleashed → HubSpot sync service

This is a small Node.js service that replaces your Make scenario.

It does the same core jobs:
- receives the Unleashed webhook
- verifies the webhook signature
- dedupes on `eventNotificationId`
- fetches the full sales order from Unleashed with `GET /SalesOrders/{orderGuid}`
- splits `DeliveryName` into HubSpot first name / last name
- extracts email and phone from the order `Comments`
- finds or creates/updates the HubSpot contact
- finds or creates/updates the HubSpot deal using the order number on the deal
- associates contact ↔ deal
- creates or updates HubSpot line items
- associates deal ↔ line items
- stores sync state in Postgres

## Assumptions

This starter matches the logic you described, but a few things are account-specific and need your property names:
- `DEAL_EXTERNAL_ID_PROPERTY` should be the HubSpot deal property where you store the Unleashed order number.
- `LINE_ITEM_EXTERNAL_ID_PROPERTY` should be the HubSpot line item property where you store the Unleashed sales order line GUID.
- `DEAL_GUID_PROPERTY` is optional, but useful if you also want the Unleashed SalesOrderGuid on the deal.
- `CONTACT_FALLBACK_PROPERTY` is optional. If you have no email in comments, the service can search a contact using that custom property.

If you do not want fallback contact matching, leave `CONTACT_FALLBACK_PROPERTY` blank.

## Quick start

1. Create a Postgres database.
2. Run the SQL in `db/schema.sql`.
3. Copy `.env.example` to `.env` and fill in your real keys/tokens.
4. Install packages:

```bash
npm install
```

5. Start the service:

```bash
npm start
```

6. Optional safety switch for go-live: set `AUTO_IGNORE_EVENTS_OLDER_THAN_STARTUP=true` in `.env` if you want the service to ignore backlog events created before you start it.
7. Optional safe test mode: set `DRY_RUN=true` in `.env` if you want to receive the webhook, fetch the order, parse contact details, and skip all HubSpot writes.
8. Point your Unleashed webhook subscription to:

```text
https://your-domain.com/webhooks/unleashed
```

## Render deployment

- Create a new **Web Service** on Render from this repo.
- Set the start command to:

```bash
npm start
```

- Add all environment variables from `.env.example`.
- Provision a Postgres database and set `DATABASE_URL`.

## Notes

- The service returns `200 OK` quickly, then processes the event in the background, which is what Unleashed recommends for webhooks.
- It retries order fetches when the webhook arrives before the order is immediately retrievable.
- In `DRY_RUN=true`, it still receives the webhook and fetches/parses the order, but it does not create or update anything in HubSpot.
- It ignores exact duplicate webhook deliveries using `eventNotificationId`.
- It can ignore old backlog events with `PROCESS_ONLY_EVENTS_CREATED_AFTER`.
- Or you can set `AUTO_IGNORE_EVENTS_OLDER_THAN_STARTUP=true` to treat app startup time as the go-live cutoff.
- For deal ↔ line item create requests, it uses HubSpot's documented line-item create payload with association type `20`.

## Files

- `src/index.js` – Express app + worker loop
- `src/lib/unleashed.js` – Unleashed API client
- `src/lib/hubspot.js` – HubSpot API client
- `src/lib/parsers.js` – name/email/phone parsing
- `src/services/syncSalesOrder.js` – main sync logic
- `db/schema.sql` – database tables

