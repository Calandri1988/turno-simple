const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_BASE_URL;
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

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

test("getPublicBaseUrl usa PUBLIC_BASE_URL cuando esta definida", () => {
  const { getPublicBaseUrl } = require("../modules/notifications/getPublicBaseUrl");
  process.env.PUBLIC_BASE_URL = "https://turno-simple-production.up.railway.app";

  assert.equal(getPublicBaseUrl(), "https://turno-simple-production.up.railway.app");
});

test("getPublicBaseUrl usa APP_BASE_URL como segundo fallback", () => {
  const { getPublicBaseUrl } = require("../modules/notifications/getPublicBaseUrl");
  process.env.APP_BASE_URL = "https://app.turnosimple.com";

  assert.equal(getPublicBaseUrl(), "https://app.turnosimple.com");
});

test("getPublicBaseUrl elimina trailing slash", () => {
  const { getPublicBaseUrl } = require("../modules/notifications/getPublicBaseUrl");
  process.env.PUBLIC_BASE_URL = "https://turno-simple-production.up.railway.app/";

  assert.equal(getPublicBaseUrl(), "https://turno-simple-production.up.railway.app");
});

test("getPublicBaseUrl usa req como fallback si no hay env", () => {
  const { getPublicBaseUrl } = require("../modules/notifications/getPublicBaseUrl");
  const mockReq = {
    protocol: "https",
    get: () => "mi-app.railway.app",
  };

  assert.equal(getPublicBaseUrl(mockReq), "https://mi-app.railway.app");
});

test("getPublicBaseUrl en production con req usa req y no localhost", () => {
  const { getPublicBaseUrl } = require("../modules/notifications/getPublicBaseUrl");
  process.env.NODE_ENV = "production";
  const mockReq = {
    protocol: "https",
    get: () => "mi-app.railway.app",
  };

  const baseUrl = getPublicBaseUrl(mockReq);

  assert.equal(baseUrl, "https://mi-app.railway.app");
  assert.equal(baseUrl.includes("localhost"), false);
});

test("getPublicBaseUrl en production sin env ni req no devuelve localhost", () => {
  const { getPublicBaseUrl } = require("../modules/notifications/getPublicBaseUrl");
  process.env.NODE_ENV = "production";

  const baseUrl = getPublicBaseUrl();

  assert.equal(baseUrl, "");
  assert.equal(baseUrl.includes("localhost"), false);
});
