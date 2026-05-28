let db;
let workerInterval = null;
let isWorkerStarted = false;

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;

function configureWorkerDatabase(database) {
  db = database;
}

function requireDb() {
  if (!db) {
    throw new Error("Notifications database is not configured");
  }
  return db;
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
      console.log(`[notifications/worker] SEND [${notification.channel.toUpperCase()}]`);
      console.log(`  → To: ${notification.recipient}`);
      console.log(`  → Type: ${notification.type}`);
      console.log(`  → Message: ${notification.message}`);

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
  configureWorkerDatabase,
  processPendingNotifications,
  startWorker,
};
