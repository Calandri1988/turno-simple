const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_BASE_URL;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_TEMPLATE_LANGUAGE;
  delete process.env.WHATSAPP_ENABLED;
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test("buildWhatsAppTemplateBody normaliza telefono y arma componentes", () => {
  const { buildWhatsAppTemplateBody } = require("../services/whatsapp");

  const { body, normalizedPhone } = buildWhatsAppTemplateBody({
    to: "+549 3549-558019",
    template: "booking_confirmed",
    language: "es",
    parameters: ["Juan", "Corte + Barba", "03/06/2026", "10:00"],
  });

  assert.equal(normalizedPhone, "5493549558019");
  assert.deepEqual(body, {
    messaging_product: "whatsapp",
    to: "5493549558019",
    type: "template",
    template: {
      name: "booking_confirmed",
      language: {
        code: "es",
      },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Juan" },
            { type: "text", text: "Corte + Barba" },
            { type: "text", text: "03/06/2026" },
            { type: "text", text: "10:00" },
          ],
        },
      ],
    },
  });
});

test("buildWhatsAppTemplateBody no envia components sin parametros", () => {
  const { buildWhatsAppTemplateBody } = require("../services/whatsapp");

  const { body } = buildWhatsAppTemplateBody({
    to: "5493549558019",
    template: "hello_world",
    language: "en_US",
    parameters: [],
  });

  assert.equal(body.template.components, undefined);
});

test("sendWhatsApp usa endpoint oficial y no loguea token", async () => {
  const { sendWhatsApp } = require("../services/whatsapp");
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1115702228296745";
  process.env.WHATSAPP_ACCESS_TOKEN = "TOKEN_SECRETO";
  process.env.WHATSAPP_TEMPLATE_LANGUAGE = "es";
  const calls = [];

  const result = await sendWhatsApp({
    to: "+5493549558019",
    template: "booking_cancelled",
    parameters: ["Juan", "Corte", "03/06/2026"],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: "wamid.test" }] }),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://graph.facebook.com/v25.0/1115702228296745/messages");
  assert.equal(calls[0].options.headers.Authorization, "Bearer TOKEN_SECRETO");
  assert.equal(JSON.parse(calls[0].options.body).to, "5493549558019");
});

test("sendWhatsApp valida variables requeridas", async () => {
  const { sendWhatsApp } = require("../services/whatsapp");

  await assert.rejects(
    () => sendWhatsApp({ to: "5493549558019", template: "hello_world" }),
    /WHATSAPP_PHONE_NUMBER_ID/,
  );
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

test("processPendingNotifications simula envio si WHATSAPP_ENABLED no esta true", async () => {
  const workerPath = require.resolve("../modules/notifications/worker");
  delete require.cache[workerPath];
  const worker = require("../modules/notifications/worker");
  const updates = [];
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(String(message));

  try {
    worker.configureWorkerDatabase({
      all: async () => [
        {
          id: 1,
          business_id: 1,
          booking_id: 123,
          type: "booking_confirmed",
          channel: "whatsapp",
          recipient: "5493549504056",
          message: "Mensaje simulado",
          attempts: 0,
        },
      ],
      get: async () => {
        throw new Error("No deberia buscar reserva si WhatsApp esta deshabilitado");
      },
      run: async (sql, params) => {
        updates.push({ sql, params });
        return {};
      },
    });

    await worker.processPendingNotifications();

    assert.equal(worker.isWhatsAppEnabled(), false);
    assert.equal(updates.length, 1);
    assert.match(updates[0].sql, /SET status = 'sent'/);
    assert.ok(logs.some((message) => message.includes("SIMULATED [WHATSAPP_DISABLED]")));
    assert.ok(!logs.some((message) => message.includes("SEND [WHATSAPP]")));
  } finally {
    console.log = originalLog;
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
