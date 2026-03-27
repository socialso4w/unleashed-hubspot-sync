const crypto = require('crypto');
const config = require('../config');
const logger = require('./logger');

function buildApiSignature(requestQueryString, apiKey) {
  return crypto.createHmac('sha256', apiKey).update(requestQueryString || '').digest('base64');
}

function verifyWebhookSignature({ signature, timestamp, rawBody, signatureKey }) {
  if (!signature || !timestamp || !rawBody) return false;

  const currentTime = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(String(timestamp), 10);
  if (Number.isNaN(ts) || currentTime - ts > 300) {
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', signatureKey).update(signedPayload).digest('base64');

  const givenBuffer = Buffer.from(String(signature), 'base64');
  const expectedBuffer = Buffer.from(expected, 'base64');

  if (givenBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(givenBuffer, expectedBuffer);
}

async function unleashedRequest(path, { method = 'GET', query = '', body } = {}) {
  const url = `${config.unleashed.baseUrl}${path}${query ? `?${query}` : ''}`;
  const signature = buildApiSignature(query, config.unleashed.apiKey);

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'api-auth-id': config.unleashed.apiId,
      'api-auth-signature': signature,
      'client-type': config.unleashed.clientType,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(`Unleashed API ${method} ${path} failed with ${response.status}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

function normalizeSalesOrderResponse(payload) {
  if (!payload) return null;
  if (payload.Items && Array.isArray(payload.Items)) {
    return payload.Items[0] || null;
  }
  return payload;
}

async function getSalesOrder(orderGuid) {
  const payload = await unleashedRequest(`/SalesOrders/${encodeURIComponent(orderGuid)}`);
  return normalizeSalesOrderResponse(payload);
}

async function getSalesOrderEventually(orderGuid) {
  let attempt = 0;
  let lastError = null;

  while (attempt < config.unleashed.maxOrderFetchAttempts) {
    attempt += 1;
    try {
      const order = await getSalesOrder(orderGuid);
      if (!order) {
        throw new Error(`Sales order ${orderGuid} returned empty payload`);
      }
      return order;
    } catch (error) {
      lastError = error;

      const retryable404 = error.status === 404;
      const retryable5xx = error.status >= 500;
      const shouldRetry = retryable404 || retryable5xx;

      logger.warn('Unleashed sales order fetch failed', {
        orderGuid,
        attempt,
        status: error.status,
        payload: error.payload,
      });

      if (!shouldRetry || attempt >= config.unleashed.maxOrderFetchAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, config.unleashed.orderFetchBackoffMs * attempt));
    }
  }

  throw lastError;
}

module.exports = {
  verifyWebhookSignature,
  getSalesOrderEventually,
};
