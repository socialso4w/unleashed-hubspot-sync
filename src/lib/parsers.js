

function splitDeliveryName(deliveryName) {
  const value = String(deliveryName || '').trim().replace(/\s+/g, ' ');
  if (!value) {
    return { firstName: '', lastName: '', fullName: '' };
  }

  const parts = value.split(' ');
  const firstName = parts.shift() || '';
  const lastName = parts.join(' ');

  return {
    firstName,
    lastName,
    fullName: value,
  };
}

function extractEmail(text) {
  const match = String(text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return match ? match[0].trim() : '';
}

function extractPhone(text) {
  const match = String(text || '').match(/\+?[0-9][0-9\s-]{7,}[0-9]/);
  return match ? match[0].trim().replace(/\s+/g, ' ') : '';
}

function parseUnleashedDate(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    const match = value.match(/\/Date\((\d+)\)\//);
    if (match) {
      return new Date(Number(match[1])).toISOString();
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return '';
}

function buildContactFromOrder(order) {
  const name = splitDeliveryName(order.DeliveryName || order.Customer?.CustomerName || '');
  const comments = order.Comments || '';

  return {
    fullName: name.fullName,
    firstName: name.firstName,
    lastName: name.lastName,
    email: extractEmail(comments),
    phone: extractPhone(comments),
    customerReference: String(order.CustomerRef || '').trim(),
    address: String(order.DeliveryStreetAddress || '').trim(),
    address2: String(order.DeliveryStreetAddress2 || '').trim(),
    suburb: String(order.DeliverySuburb || '').trim(),
    city: String(order.DeliveryCity || '').trim(),
    state: String(order.DeliveryRegion || '').trim(),
    zip: String(order.DeliveryPostCode || '').trim(),
    comments,
  };
}

module.exports = {
  splitDeliveryName,
  extractEmail,
  extractPhone,
  parseUnleashedDate,
  buildContactFromOrder,
};