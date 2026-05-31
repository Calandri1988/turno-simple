const { normalizePhone } = require("../../whatsapp");

function normalizePhoneForWhatsApp(phone) {
  const result = normalizePhone(phone);
  if (result.ok) {
    return result.normalized;
  }

  console.warn(`[notifications] Could not normalize WhatsApp recipient: ${phone} error=${result.error}`);
  return phone;
}

module.exports = {
  normalizePhone,
  normalizePhoneForWhatsApp,
};
