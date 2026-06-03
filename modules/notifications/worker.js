const { sendWhatsApp } = require("../../services/whatsapp");
const { formatDate } = require("./date-utils");

let db;
let workerInterval = null;
let isWorkerStarted = false;

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;
const META_TEMPLATE_BY_NOTIFICATION_TYPE = {
  booking_cancelled: "booking_cancelled_v2",
};
const REAL_WHATSAPP_TEMPLATES = new Set([
  "booking_confirmed",
  "booking_payment_request",
  "booking_payment_confirmed",
  "booking_reminder_24h",
  "booking_cancelled_v2",
]);

function configureWorkerDatabase(database) {
  db = database;
}

function requireDb() {
  if (!db) {
    throw new Error("Notifications database is not configured");
  }
  return db;
}

function isWhatsAppEnabled() {
  return process.env.WHATSAPP_ENABLED === "true";
}

function getMetaTemplateName(notificationType) {
  return META_TEMPLATE_BY_NOTIFICATION_TYPE[notificationType] || notificationType;
}

function extractCancelledFallbackParameters(message) {
  const text = String(message || "");
  const match = text.match(
    /(?:¡|Â¡)?Hola\s+(.+?)!\s*.*?turno para\s+(.+?)\s+en\s+(.+?),\s+programado para el (?:día|dÃ­a)\s+(\d{2}\/\d{2}\/\d{4})\s+a las\s+(\d{2}:\d{2}).*?al\s+(.+?)\./is,
  );
  if (!match) {
    return null;
  }
  return [
    match[1].trim(),
    match[2].trim(),
    match[3].trim(),
    match[4].trim(),
    match[5].trim(),
    match[6].trim(),
  ];
}

async function buildWhatsAppTemplatePayload(database, notification) {
  const booking = notification.booking_id
    ? await database.get(
        `
          SELECT
            r.*,
            b.name AS business_name,
            b.address AS business_address,
            b.payment_alias,
            b.whatsapp AS business_phone
          FROM reservations r
          JOIN businesses b ON b.id = r.business_id
          WHERE r.id = ?
            AND r.business_id = ?
        `,
        [notification.booking_id, notification.business_id],
      )
    : null;

  if (!booking) {
    if (notification.type === "booking_cancelled") {
      const parameters = extractCancelledFallbackParameters(notification.message);
      if (parameters) {
        console.warn(`[notifications/worker] Using fallback template parameters for deleted booking id=${notification.booking_id}`);
        return { template: getMetaTemplateName(notification.type), parameters };
      }
    }
    throw new Error(`Cannot build WhatsApp template parameters for notification ${notification.id}`);
  }

  const date = formatDate(booking.date);
  const businessReference = booking.business_address || booking.business_name || "";

  if (notification.type === "booking_payment_request") {
    const service = await database.get(
      "SELECT deposit_amount FROM services WHERE business_id = ? AND id = ?",
      [booking.business_id, booking.service_id],
    );
    return {
      template: notification.type,
      parameters: [
        booking.customer_name,
        booking.service_name,
        service?.deposit_amount || 0,
        booking.payment_alias || "",
      ],
    };
  }

  if (
    notification.type === "booking_confirmed" ||
    notification.type === "booking_reminder_24h"
  ) {
    return {
      template: notification.type,
      parameters: [booking.customer_name, booking.service_name, date, booking.time, businessReference],
    };
  }

  if (notification.type === "booking_payment_confirmed") {
    return {
      template: notification.type,
      parameters: [booking.customer_name, booking.service_name, date, booking.time],
    };
  }

  if (notification.type === "booking_cancelled") {
    return {
      template: getMetaTemplateName(notification.type),
      parameters: [
        booking.customer_name,
        booking.service_name,
        booking.business_name || "el negocio",
        date,
        booking.time,
        booking.business_phone || "el negocio",
      ],
    };
  }

  return {
    template: getMetaTemplateName(notification.type),
    parameters: [],
  };
}

async function deliverNotification(database, notification) {
  const whatsappEnabled = process.env.WHATSAPP_ENABLED === "true";

  if (!whatsappEnabled) {
    console.log("[notifications/worker] SIMULATED [WHATSAPP_DISABLED]");
    console.log(`  -> To: ${notification.recipient}`);
    console.log(`  -> Type: ${notification.type}`);
    console.log(`  -> Message: ${notification.message}`);
    return;
  }

  const metaTemplate = getMetaTemplateName(notification.type);

  if (!REAL_WHATSAPP_TEMPLATES.has(metaTemplate)) {
    console.log(`[notifications/worker] skipped real WhatsApp: template not approved (${metaTemplate})`);
    return;
  }

  console.log(`[notifications/worker] SEND [${notification.channel.toUpperCase()}]`);
  console.log(`  -> To: ${notification.recipient}`);
  console.log(`  -> Type: ${notification.type}`);
  console.log(`  -> Meta template: ${metaTemplate}`);

  const payload = await buildWhatsAppTemplatePayload(database, notification);
  await sendWhatsApp({
    to: notification.recipient,
    template: payload.template,
    parameters: payload.parameters,
  });
}

async function processPendingNotifications() {
  const database = requireDb();
  const now = new Date().toISOString();
  const pending = await database.all(
    `
      SELECT *
      FROM notifications
      WHERE status = 'pending'
        AND scheduled_for <= ?
        AND attempts < ?
      ORDER BY scheduled_for ASC
      LIMIT ?
    `,
    [now, MAX_ATTEMPTS, BATCH_SIZE],
  );

  if (pending.length === 0) {
    return;
  }

  console.log(`[notifications/worker] Processing ${pending.length} notification(s)...`);

  for (const notification of pending) {
    try {
      await deliverNotification(database, notification);

      await database.run(
        `
          UPDATE notifications
          SET status = 'sent',
              sent_at = ?,
              attempts = attempts + 1
          WHERE id = ?
        `,
        [new Date().toISOString(), notification.id],
      );
    } catch (error) {
      console.error(`[notifications/worker] Failed id=${notification.id}:`, error.message);

      const newAttempts = notification.attempts + 1;
      const newStatus = newAttempts >= MAX_ATTEMPTS ? "failed" : "pending";

      await database.run(
        `
          UPDATE notifications
          SET status = ?,
              attempts = ?,
              last_error = ?
          WHERE id = ?
        `,
        [newStatus, newAttempts, error.message, notification.id],
      );
    }
  }
}

function startWorker() {
  if (isWorkerStarted) {
    return;
  }

  isWorkerStarted = true;
  console.log(`[notifications/worker] Started. Polling every ${POLL_INTERVAL_MS / 1000}s`);
  processPendingNotifications().catch((error) => {
    console.error("[notifications/worker] Initial run failed:", error.message);
  });
  workerInterval = setInterval(() => {
    processPendingNotifications().catch((error) => {
      console.error("[notifications/worker] Run failed:", error.message);
    });
  }, POLL_INTERVAL_MS);
}

module.exports = {
  buildWhatsAppTemplatePayload,
  configureWorkerDatabase,
  deliverNotification,
  getMetaTemplateName,
  isWhatsAppEnabled,
  processPendingNotifications,
  startWorker,
};
