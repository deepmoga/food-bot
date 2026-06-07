const { getSetting } = require('./settings');

/**
 * Calculates the active automatic discount (Happy Hour or Store-wide) for a given cart total.
 * Happy Hour discount takes precedence over Store-wide discount.
 * 
 * @param {number} cartTotal - The total price of items in the cart
 * @param {number} vendorId - The ID of the vendor
 * @returns {Promise<number>} - The discount amount
 */
async function getAutomaticDiscount(cartTotal, vendorId) {
  let discount = 0;
  let happyHourApplied = false;

  // 1. Check Happy Hour Discount
  const happyHourEnabled = await getSetting('happy_hour_enabled', vendorId) === '1';
  if (happyHourEnabled) {
    const startStr = await getSetting('happy_hour_start', vendorId) || '16:00';
    const endStr = await getSetting('happy_hour_end', vendorId) || '19:00';
    
    const timezone = await getSetting('store_timezone', vendorId) || 'Asia/Kolkata';
    const now = new Date();
    
    // Get current time string in store's timezone (HH:MM:SS format)
    const localTimeStr = now.toLocaleTimeString('en-US', { timeZone: timezone, hour12: false });
    
    // Helper to normalize time "HH:MM:SS" or "HH:MM" to minutes of the day
    const normalizeTime = (t) => {
      const parts = t.split(':');
      return parseInt(parts[0]) * 60 + (parseInt(parts[1]) || 0);
    };

    const nowMinutes = normalizeTime(localTimeStr);
    const startMinutes = normalizeTime(startStr);
    const endMinutes = normalizeTime(endStr);

    let isHappyHour = false;
    if (startMinutes <= endMinutes) {
      isHappyHour = nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    } else {
      // Over midnight case (e.g. 23:00 to 01:00)
      isHappyHour = nowMinutes >= startMinutes || nowMinutes <= endMinutes;
    }

    if (isHappyHour) {
      const type = await getSetting('happy_hour_type', vendorId) || 'percent';
      const val = parseFloat(await getSetting('happy_hour_value', vendorId)) || 0;
      if (val > 0) {
        happyHourApplied = true;
        if (type === 'flat') {
          discount = val;
        } else {
          discount = (cartTotal * val) / 100;
        }
      }
    }
  }

  // 2. If Happy Hour not applied, check store-wide discount
  if (!happyHourApplied) {
    const storeDiscountEnabled = await getSetting('store_discount_enabled', vendorId) === '1';
    if (storeDiscountEnabled) {
      const type = await getSetting('store_discount_type', vendorId) || 'percent';
      const val = parseFloat(await getSetting('store_discount_value', vendorId)) || 0;
      if (val > 0) {
        if (type === 'flat') {
          discount = val;
        } else {
          discount = (cartTotal * val) / 100;
        }
      }
    }
  }

  // Cap discount to cart total
  discount = parseFloat(Math.min(discount, cartTotal).toFixed(2));
  return discount;
}

module.exports = { getAutomaticDiscount };
