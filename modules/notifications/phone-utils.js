const { normalizeArgentinaWhatsapp } = require("../../whatsapp");

function normalizePhoneForWhatsApp(phone) {
  const normalized = normalizeArgentinaWhatsapp(phone, "3549");
  if (normalized) {
    return normalized;
  }

  console.warn(`[notifications] Could not normalize WhatsApp recipient: ${phone}`);
  return phone;
}

module.exports = {
  normalizePhoneForWhatsApp,
};
