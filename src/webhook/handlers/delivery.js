const db = require('../../config/db');
const { handleDeliveryConfirmed, handleDeliveryIssue } = require('../../helpers/delivery');

async function handleDeliveryButtons(replyId, phone, vendorId) {
  if (replyId.startsWith('db_delivered_')) {
    const orderId = parseInt(replyId.replace('db_delivered_', ''));
    await handleDeliveryConfirmed(phone, orderId, vendorId);
    return true;
  }
  if (replyId.startsWith('db_issue_')) {
    const orderId = parseInt(replyId.replace('db_issue_', ''));
    await handleDeliveryIssue(phone, orderId, vendorId);
    return true;
  }
  return false;
}

module.exports = { handleDeliveryButtons };
