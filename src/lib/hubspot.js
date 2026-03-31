const config = require('../config');

async function hubspotRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${config.hubspot.baseUrl}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${config.hubspot.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
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
    const error = new Error(`HubSpot API ${method} ${path} failed with ${response.status}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

async function searchObject(objectType, propertyName, value, properties = []) {
  if (!propertyName || !value) return null;

  const payload = await hubspotRequest(`/crm/v3/objects/${objectType}/search`, {
    method: 'POST',
    body: {
      filterGroups: [
        {
          filters: [
            {
              propertyName,
              operator: 'EQ',
              value: String(value),
            },
          ],
        },
      ],
      properties,
      limit: 1,
    },
  });

  return payload.results?.[0] || null;
}

async function createObject(objectType, properties, associations) {
  const body = { properties };
  if (associations && associations.length) {
    body.associations = associations;
  }

  return hubspotRequest(`/crm/v3/objects/${objectType}`, {
    method: 'POST',
    body,
  });
}

async function updateObject(objectType, objectId, properties) {
  return hubspotRequest(`/crm/v3/objects/${objectType}/${objectId}`, {
    method: 'PATCH',
    body: { properties },
  });
}

async function deleteObject(objectType, objectId) {
  return hubspotRequest(`/crm/v3/objects/${objectType}/${objectId}`, {
    method: 'DELETE',
  });
}

async function associateDefault(fromType, fromId, toType, toId) {
  return hubspotRequest(`/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`, {
    method: 'PUT',
  });
}

function compactProperties(properties) {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== '' && value != null));
}

async function findContactByEmail(email) {
  return searchObject('contacts', 'email', email, ['firstname', 'lastname', 'email', 'phone']);
}

async function findContactByFallback(propertyName, value) {
  return searchObject('contacts', propertyName, value, ['firstname', 'lastname', 'email', 'phone']);
}


async function upsertContact(contact) {
  const properties = compactProperties({
  firstname: contact.firstName,
  lastname: contact.lastName,
  email: contact.email,
  phone: contact.phone,
  address: contact.address,
  address_line_2: contact.address2,
  city: contact.city,
  state: contact.state,
  zip: contact.zip,
  customer_reference: contact.customerReference,
  suburb: contact.suburb,
unleashed_comments: contact.comments || undefined,
  ...(config.hubspot.contactFallbackProperty && contact.fallbackValue
    ? { [config.hubspot.contactFallbackProperty]: contact.fallbackValue }
    : {}),
  ...(config.hubspot.contactOwnerId ? { hubspot_owner_id: config.hubspot.contactOwnerId } : {}),
});


  let existing = null;
  if (contact.email) {
    existing = await findContactByEmail(contact.email);
  }

  if (!existing && config.hubspot.contactFallbackProperty && contact.fallbackValue) {
    existing = await findContactByFallback(config.hubspot.contactFallbackProperty, contact.fallbackValue);
  }

  if (existing) {
    return updateObject('contacts', existing.id, properties);
  }

  if (!contact.email && !config.hubspot.allowContactCreateWithoutEmail) {
    return null;
  }

  return createObject('contacts', properties);
}

async function findDealByOrderNumber(orderNumber) {
  return searchObject('deals', config.hubspot.dealExternalIdProperty, orderNumber, [
    'dealname',
    config.hubspot.dealExternalIdProperty,
    config.hubspot.dealGuidProperty,
  ]);
}

async function upsertDeal(order, contact) {
  const properties = compactProperties({
    dealname: `${order.OrderNumber}${order.Customer?.CustomerName ? ` - ${order.Customer.CustomerName}` : ''}`,
    amount: order.Total,
    dealstage: config.hubspot.dealStage,
    pipeline: config.hubspot.dealPipeline,
    unleashed_comments: order.Comments || undefined,
    closedate: order.OrderDateIso || undefined,
    [config.hubspot.dealExternalIdProperty]: order.OrderNumber,
    ...(config.hubspot.dealGuidProperty ? { [config.hubspot.dealGuidProperty]: order.Guid } : {}),
    ...(config.hubspot.dealOwnerId ? { hubspot_owner_id: config.hubspot.dealOwnerId } : {}),
  });

  const existing = await findDealByOrderNumber(order.OrderNumber);
  if (existing) {
    return updateObject('deals', existing.id, properties);
  }

  const associations = [];
  if (contact?.id) {
    // Use a default unlabeled association.
    // We create it explicitly after the deal is created as well, because create-association behavior can vary by portal.
  }

  return createObject('deals', properties, associations);
}

async function findLineItemByExternalId(externalId) {
  return searchObject('line_items', config.hubspot.lineItemExternalIdProperty, externalId, [
    'name',
    'quantity',
    'price',
    config.hubspot.lineItemExternalIdProperty,
  ]);
}

async function createOrUpdateLineItem(line, order, dealId) {
  const properties = compactProperties({
    name: line.Product?.ProductDescription || line.Product?.ProductCode || `Line ${line.LineNumber || ''}`.trim(),
    quantity: line.OrderQuantity,
    price: line.UnitPrice,
    amount: line.LineTotal,
    hs_sku: line.Product?.ProductCode,
    hs_line_item_currency_code: order.Currency?.CurrencyCode,
    [config.hubspot.lineItemExternalIdProperty]: line.Guid,
    ...(config.hubspot.lineItemOrderNumberProperty ? { [config.hubspot.lineItemOrderNumberProperty]: order.OrderNumber } : {}),
  });

  const existing = await findLineItemByExternalId(line.Guid);

  if (existing) {
    const updated = await updateObject('line_items', existing.id, properties);
    await associateDefault('line_item', updated.id, 'deal', dealId);
    return updated;
  }

  return createObject('line_items', properties, [
    {
      to: { id: Number(dealId) },
      types: [
        {
          associationCategory: 'HUBSPOT_DEFINED',
          associationTypeId: 20,
        },
      ],
    },
  ]);
}

module.exports = {
  upsertContact,
  upsertDeal,
  createOrUpdateLineItem,
  associateDefault,
  deleteObject,
};
