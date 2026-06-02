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

test("buildWhatsAppTemplateBody usa es_AR por defecto", () => {
  const { buildWhatsAppTemplateBody } = require("../services/whatsapp");

  const { body } = buildWhatsAppTemplateBody({
    to: "5493549558019",
    template: "booking_confirmed",
    parameters: ["Juan", "Corte", "03/06/2026", "10:00", "Local"],
  });

  assert.equal(body.template.language.code, "es_AR");
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

test("buildWhatsAppTemplatePayload usa variables aprobadas por plantilla", async () => {
  const workerPath = require.resolve("../modules/notifications/worker");
  delete require.cache[workerPath];
  const { buildWhatsAppTemplatePayload } = require("../modules/notifications/worker");
  const booking = {
    id: 1,
    business_id: 1,
    service_id: "coloracion",
    service_name: "Coloración",
    customer_name: "Ana",
    date: "2026-06-08",
    time: "10:00",
    business_name: "Barbería Central",
    business_address: "Centro - Cruz del Eje",
    business_phone: "3549432877",
    payment_alias: "barberia.central.mp",
  };
  const database = {
    get: async (sql) => {
      if (String(sql).includes("FROM reservations")) return booking;
      if (String(sql).includes("FROM services")) return { deposit_amount: 8000 };
      return null;
    },
  };

  const confirmed = await buildWhatsAppTemplatePayload(database, {
    id: 1,
    business_id: 1,
    booking_id: 1,
    type: "booking_confirmed",
  });
  const paymentRequest = await buildWhatsAppTemplatePayload(database, {
    id: 2,
    business_id: 1,
    booking_id: 1,
    type: "booking_payment_request",
  });
  const paymentConfirmed = await buildWhatsAppTemplatePayload(database, {
    id: 3,
    business_id: 1,
    booking_id: 1,
    type: "booking_payment_confirmed",
  });
  const reminder = await buildWhatsAppTemplatePayload(database, {
    id: 4,
    business_id: 1,
    booking_id: 1,
    type: "booking_reminder_24h",
  });
  const cancelled = await buildWhatsAppTemplatePayload(database, {
    id: 5,
    business_id: 1,
    booking_id: 1,
    type: "booking_cancelled",
  });

  assert.deepEqual(confirmed.parameters, ["Ana", "Coloración", "08/06/2026", "10:00", "Centro - Cruz del Eje"]);
  assert.deepEqual(paymentRequest.parameters, ["Ana", "Coloración", 8000, "barberia.central.mp"]);
  assert.deepEqual(paymentConfirmed.parameters, ["Ana", "Coloración", "08/06/2026", "10:00"]);
  assert.deepEqual(reminder.parameters, ["Ana", "Coloración", "08/06/2026", "10:00", "Centro - Cruz del Eje"]);
  assert.deepEqual(cancelled.parameters, ["Ana", "Coloración", "Barbería Central", "08/06/2026", "10:00", "3549432877"]);
});

test("processPendingNotifications no revienta si Meta falla", async () => {
  const workerPath = require.resolve("../modules/notifications/worker");
  delete require.cache[workerPath];
  process.env.WHATSAPP_ENABLED = "true";
  const worker = require("../modules/notifications/worker");
  const updates = [];

  worker.configureWorkerDatabase({
    all: async () => [
      {
        id: 1,
        business_id: 1,
        booking_id: 1,
        type: "booking_confirmed",
        channel: "whatsapp",
        recipient: "5493549504056",
        message: "Mensaje",
        attempts: 0,
      },
    ],
    get: async () => ({
      id: 1,
      business_id: 1,
      service_name: "Corte",
      customer_name: "Juan",
      date: "2026-06-08",
      time: "09:00",
      business_name: "Barbería Central",
      business_address: "Centro - Cruz del Eje",
      payment_alias: "barberia.central.mp",
    }),
    run: async (sql, params) => {
      updates.push({ sql, params });
      return {};
    },
  });

  await worker.processPendingNotifications();

  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /SET status = \?/);
  assert.equal(updates[0].params[0], "pending");
  assert.match(updates[0].params[2], /WHATSAPP_PHONE_NUMBER_ID/);
  delete require.cache[workerPath];
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
