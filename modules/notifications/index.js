const {
  cancelPendingReminder,
  configureNotificationsDatabase,
  enqueueNotification,
} = require("./enqueue");
const { normalizePhoneForWhatsApp } = require("./phone-utils");
const { renderTemplate } = require("./templates");
const {
  configureWorkerDatabase,
  processPendingNotifications,
  startWorker,
} = require("./worker");

function configureNotifications(database) {
  configureNotificationsDatabase(database);
  configureWorkerDatabase(database);
}

module.exports = {
  cancelPendingReminder,
  configureNotifications,
  enqueueNotification,
  normalizePhoneForWhatsApp,
  processPendingNotifications,
  renderTemplate,
  startWorker,
};
