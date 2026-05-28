const { normalizePhoneForWhatsApp } = require("./phone-utils");

let db;

function configureNotificationsDatabase(database) {
  db = database;
}

function requireDb() {
  if (!db) {
    throw new Error("Notifications database is not configured");
  }
  return db;
}

async function enqueueNotification({
  businessId,
  bookingId,
  type,
  channel = "whatsapp",
  recipient,
  message,
  scheduledFor,
}) {
  const database = requireDb();
  const normalizedRecipient = normalizePhoneForWhatsApp(recipient);
  const scheduledValue = scheduledFor instanceof Date
    ? scheduledFor.toISOString()
    : scheduledFor;

  const result = await database.run(
    `
      INSERT OR IGNORE INTO notifications (
        business_id,
        booking_id,
        type,
        channel,
        recipient,
        message,
        status,
        scheduled_for
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `,
    [
      businessId,
      bookingId ?? null,
      type,
      channel,
      normalizedRecipient,
      message,
      scheduledValue,
    ],
  );

  console.log(`[notifications] Enqueued: type=${type} | recipient=${normalizedRecipient}`);
  return result.lastID || result.lastInsertRowid || null;
}

async function cancelPendingReminder(bookingId) {
  const database = requireDb();
  return database.run(
    `
      UPDATE notifications
      SET status = 'cancelled'
      WHERE booking_id = ?
        AND type = 'booking_reminder_24h'
        AND status = 'pending'
    `,
    bookingId,
  );
}

module.exports = {
  cancelPendingReminder,
  configureNotificationsDatabase,
  enqueueNotification,
};
