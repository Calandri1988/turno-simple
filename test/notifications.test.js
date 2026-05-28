const assert = require("node:assert/strict");
const test = require("node:test");

test("startWorker no arranca duplicado", () => {
  const workerPath = require.resolve("../modules/notifications/worker");
  delete require.cache[workerPath];

  const logs = [];
  const intervals = [];
  const originalLog = console.log;
  const originalSetInterval = global.setInterval;

  console.log = (message) => logs.push(message);
  global.setInterval = (handler, ms) => {
    intervals.push({ handler, ms });
    return intervals.length;
  };

  try {
    const worker = require("../modules/notifications/worker");
    worker.configureWorkerDatabase({
      all: async () => [],
    });

    worker.startWorker();
    worker.startWorker();

    assert.equal(intervals.length, 1);
    assert.equal(logs.filter((message) => String(message).includes("[notifications/worker] Started")).length, 1);
  } finally {
    console.log = originalLog;
    global.setInterval = originalSetInterval;
    delete require.cache[workerPath];
  }
});

test("normalizePhoneForWhatsApp normaliza telefono argentino comun", () => {
  const { normalizePhoneForWhatsApp } = require("../modules/notifications/phone-utils");

  assert.equal(normalizePhoneForWhatsApp("3549504056"), "5493549504056");
});
