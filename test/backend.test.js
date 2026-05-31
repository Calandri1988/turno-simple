const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

let baseUrl;
let serverProcess;
let tempDir;
let tempDbPath;
let adminToken;
const DEMO_API = "/api/businesses/demo";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      const response = await fetch(`${url}${DEMO_API}/services`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error("El servidor de test no inicio a tiempo.");
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  let body = null;

  try {
    body = await response.json();
  } catch (error) {
    // 204 responses do not have JSON bodies.
  }

  return { body, status: response.status };
}

function adminHeaders(extraHeaders = {}) {
  return {
    ...extraHeaders,
    Authorization: `Bearer ${adminToken}`,
  };
}

async function adminRequest(pathname, options = {}) {
  return request(pathname, {
    ...options,
    headers: adminHeaders(options.headers || {}),
  });
}

async function loginAdmin(email = "admin@demo.com", password = "admin123", slug = "demo") {
  return request(`/api/businesses/${slug}/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
}

async function withDb(callback) {
  const db = await open({ filename: tempDbPath, driver: sqlite3.Database });
  try {
    return await callback(db);
  } finally {
    await db.close();
  }
}

async function createOtherBusiness() {
  return withDb(async (db) => {
    await db.run(
      `
        INSERT INTO businesses (name, slug, category, city)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          city = excluded.city
      `,
      ["Otro Negocio", "otro", "General", "Cordoba"],
    );
    const business = await db.get("SELECT * FROM businesses WHERE slug = ?", "otro");
    await db.run(
      `
        INSERT INTO services (business_id, id, name, duration_minutes, price)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(business_id, id) DO UPDATE SET
          name = excluded.name,
          duration_minutes = excluded.duration_minutes,
          price = excluded.price
      `,
      [business.id, "consulta", "Consulta Otro", 30, null],
    );
    await db.run(
      `
        INSERT INTO services (business_id, id, name, duration_minutes, price)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(business_id, id) DO UPDATE SET
          name = excluded.name,
          duration_minutes = excluded.duration_minutes,
          price = excluded.price
      `,
      [business.id, "otro", "Servicio Otro", 30, null],
    );
    await db.run(
      "INSERT OR IGNORE INTO professionals (business_id, name) VALUES (?, ?)",
      [business.id, "Profesional Otro"],
    );
    const professional = await db.get(
      "SELECT * FROM professionals WHERE business_id = ? AND name = ?",
      [business.id, "Profesional Otro"],
    );
    const passwordHash = await bcrypt.hash("otro123", 10);
    await db.run(
      `
        INSERT INTO business_users (business_id, email, password_hash, role)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(business_id, email) DO UPDATE SET
          password_hash = excluded.password_hash,
          role = excluded.role
      `,
      [business.id, "admin@otro.com", passwordHash, "owner"],
    );

    for (const weekday of [0, 1]) {
      await db.run(
        `
          INSERT OR IGNORE INTO professional_schedules (
            business_id,
            professional_id,
            weekday,
            start_time,
            end_time,
            interval_minutes
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [business.id, professional.id, weekday, "09:00", "17:00", 30],
      );
    }

    return { business, professional };
  });
}

async function createOtherReservation() {
  await createOtherBusiness();
  return createReservation({
    slug: "otro",
    serviceId: "consulta",
    professionalId: null,
    date: "2026-06-08",
    time: "09:00",
    customerName: "Otro Cliente",
    customerPhone: "3549432877",
  });
}

function reservation(overrides = {}) {
  return {
    serviceId: "consulta",
    professionalId: 1,
    date: "2026-06-08",
    time: "09:00",
    customerName: "Cliente Test",
    customerPhone: "3549504056",
    ...overrides,
  };
}

async function createReservation(overrides = {}) {
  const slug = overrides.slug || "demo";
  const payload = { ...overrides };
  delete payload.slug;

  return request(`/api/businesses/${slug}/reservations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reservation(payload)),
  });
}

async function createDepositService(id = "sena-test", depositAmount = 1000) {
  return adminRequest(`${DEMO_API}/admin/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      name: "Servicio con seña",
      durationMinutes: 30,
      requiresDeposit: true,
      depositAmount,
      paymentInstructions: "",
    }),
  });
}

async function insertNotification(slug = "demo", overrides = {}) {
  return withDb(async (db) => {
    const business = await db.get("SELECT id FROM businesses WHERE slug = ?", slug);
    const createdAt = overrides.createdAt || new Date().toISOString();
    const scheduledFor = overrides.scheduledFor || createdAt;
    const result = await db.run(
      `
        INSERT INTO notifications (
          business_id,
          booking_id,
          type,
          channel,
          recipient,
          message,
          status,
          attempts,
          scheduled_for,
          sent_at,
          last_error,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        business.id,
        overrides.bookingId ?? null,
        overrides.type || "booking_confirmed",
        overrides.channel || "whatsapp",
        overrides.recipient || "5493549504056",
        overrides.message || "Mensaje de prueba para diagnostico",
        overrides.status || "pending",
        overrides.attempts ?? 0,
        scheduledFor,
        overrides.sentAt || null,
        overrides.lastError || null,
        createdAt,
      ],
    );
    return result.lastID;
  });
}

before(async () => {
  const port = await getFreePort();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "turno-simple-test-"));
  tempDbPath = path.join(tempDir, "turnos-test.sqlite");
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      DB_PATH: tempDbPath,
      PORT: String(port),
      PUBLIC_BASE_URL: "https://turno-simple-production.up.railway.app",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  serverProcess.stdout.on("data", (data) => {
    serverOutput += data.toString();
  });
  serverProcess.stderr.on("data", (data) => {
    serverOutput += data.toString();
  });

  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(serverOutput);
    }
  });

  await waitForServer(baseUrl);
});

beforeEach(async () => {
  const login = await loginAdmin();
  adminToken = login.body.token;
  await withDb(async (db) => {
    await db.run("DELETE FROM reservations");
    await db.run("DELETE FROM notifications");
  });
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    const exited = new Promise((resolve) => {
      serverProcess.once("exit", resolve);
    });
    serverProcess.kill();
    await exited;
  }

  if (tempDir) {
    await fs.rm(tempDir, { force: true, recursive: true });
  }
});

test("servicio inexistente rechaza 400", async () => {
  const response = await createReservation({ serviceId: "no-existe" });
  assert.equal(response.status, 400);
});

test("slug inexistente devuelve 404", async () => {
  const response = await request("/api/businesses/no-existe/services");
  assert.equal(response.status, 404);
});

test("GET /api/businesses/demo devuelve 200", async () => {
  const response = await request(`${DEMO_API}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.slug, "demo");
  assert.equal(response.body.name, "Barbería Central");
  assert.equal(response.body.category, "Barbería");
  assert.equal(response.body.city, "Cruz del Eje");
  assert.equal(response.body.whatsapp, "");
  assert.equal(response.body.address, "");
  assert.equal(response.body.paymentAlias, "");
});

test("GET /api/businesses/slug-inexistente devuelve 404", async () => {
  const response = await request("/api/businesses/slug-inexistente");
  assert.equal(response.status, 404);
});

test("actualizar datos del negocio desde admin se refleja en negocio publico", async () => {
  const updated = await adminRequest(`${DEMO_API}/admin/business`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      whatsapp: "351 555-1234",
      address: "San Martin 123",
      paymentAlias: "turno.demo.mp",
    }),
  });
  const publicBusiness = await request(`${DEMO_API}`);

  assert.equal(updated.status, 200);
  assert.equal(updated.body.whatsapp, "351 555-1234");
  assert.equal(updated.body.address, "San Martin 123");
  assert.equal(updated.body.paymentAlias, "turno.demo.mp");
  assert.equal(publicBusiness.body.whatsapp, "351 555-1234");
  assert.equal(publicBusiness.body.address, "San Martin 123");
  assert.equal(publicBusiness.body.paymentAlias, "turno.demo.mp");
});

test("usuario de otro negocio no puede actualizar datos ajenos", async () => {
  await createOtherBusiness();
  const login = await loginAdmin("admin@otro.com", "otro123", "otro");
  const response = await request(`${DEMO_API}/admin/business`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${login.body.token}`,
    },
    body: JSON.stringify({ whatsapp: "999", address: "Otra", paymentAlias: "otro.mp" }),
  });

  assert.equal(response.status, 403);
});

test("GET /demo carga correctamente el negocio demo", async () => {
  const response = await fetch(`${baseUrl}/demo`);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.ok(text.includes('id="business-name"'));
  assert.ok(text.includes("public.js"));
});

test("GET /slug-inexistente carga la app para mostrar manejo correcto", async () => {
  const response = await fetch(`${baseUrl}/slug-inexistente`);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.ok(text.includes('id="business-name"'));
  assert.ok(text.includes("public.js"));
});

test("GET /demo/admin carga panel admin", async () => {
  const response = await fetch(`${baseUrl}/demo/admin`);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.ok(text.includes("admin.js"));
});

test("GET /demo/admin/notifications carga vista admin de notificaciones", async () => {
  const response = await fetch(`${baseUrl}/demo/admin/notifications`);
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.ok(text.includes("admin.js"));
  assert.ok(text.includes("admin-notifications-link"));
});

test("GET /admin/test-whatsapp responde error claro sin credenciales Meta", async () => {
  const response = await request("/admin/test-whatsapp");

  assert.equal(response.status, 500);
  assert.equal(response.body.ok, false);
  assert.match(response.body.error, /WHATSAPP_/);
});

test("GET /api/businesses/demo/admin/notifications sin token devuelve 401", async () => {
  const response = await request(`${DEMO_API}/admin/notifications`);
  assert.equal(response.status, 401);
});

test("POST test whatsapp template requiere JWT admin", async () => {
  const response = await request(`${DEMO_API}/admin/test-whatsapp-template`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: "5493549432877",
      template: "booking_confirmed",
    }),
  });

  assert.equal(response.status, 401);
});

test("GET /api/businesses/demo/admin/notifications con token valido devuelve 200", async () => {
  await insertNotification("demo", { message: "Mensaje de diagnostico demo" });
  const response = await request(`${DEMO_API}/admin/notifications`, {
    headers: adminHeaders(),
  });

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.notifications));
  assert.equal(response.body.notifications.length, 1);
  assert.equal(response.body.notifications[0].message, "Mensaje de diagnostico demo");
  assert.equal(response.body.notifications[0].message_preview, "Mensaje de diagnostico demo");
});

test("GET admin notifications devuelve solo notificaciones del negocio correspondiente", async () => {
  await createOtherBusiness();
  await insertNotification("demo", { message: "Mensaje demo" });
  await insertNotification("otro", { message: "Mensaje otro" });
  const response = await request(`${DEMO_API}/admin/notifications`, {
    headers: adminHeaders(),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.notifications.length, 1);
  assert.equal(response.body.notifications[0].message, "Mensaje demo");
});

test("GET admin notifications ordena por created_at DESC", async () => {
  await insertNotification("demo", {
    message: "Mas antigua",
    createdAt: "2026-05-27T10:00:00.000Z",
  });
  await insertNotification("demo", {
    message: "Mas nueva",
    createdAt: "2026-05-28T10:00:00.000Z",
  });
  const response = await request(`${DEMO_API}/admin/notifications`, {
    headers: adminHeaders(),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.notifications.map((item) => item.message),
    ["Mas nueva", "Mas antigua"],
  );
});

test("GET admin notifications limita a 100 registros", async () => {
  for (let index = 0; index < 105; index += 1) {
    await insertNotification("demo", {
      message: `Mensaje ${index}`,
      createdAt: new Date(Date.UTC(2026, 4, 28, 10, 0, index)).toISOString(),
    });
  }
  const response = await request(`${DEMO_API}/admin/notifications`, {
    headers: adminHeaders(),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.notifications.length, 100);
  assert.equal(response.body.notifications[0].message, "Mensaje 104");
  assert.equal(response.body.notifications.at(-1).message, "Mensaje 5");
});

test("GET admin notifications no permite acceder a otro negocio", async () => {
  await createOtherBusiness();
  const login = await loginAdmin("admin@otro.com", "otro123", "otro");
  const response = await request(`${DEMO_API}/admin/notifications`, {
    headers: {
      Authorization: `Bearer ${login.body.token}`,
    },
  });

  assert.equal(login.status, 200);
  assert.equal(response.status, 403);
});

test("GET /api/businesses/demo/services devuelve solo servicios del negocio demo", async () => {
  await createOtherBusiness();
  const response = await request(`${DEMO_API}/services`);

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body));
  assert.deepEqual(
    response.body.map((service) => service.id).sort(),
    ["asesoria", "coloracion", "consulta", "corte"],
  );
  assert.ok(!response.body.some((service) => service.id === "otro"));
});

test("GET /api/businesses/demo/reservations sin token devuelve 401", async () => {
  const response = await request(`${DEMO_API}/reservations`);
  assert.equal(response.status, 401);
});

test("login con contraseña incorrecta devuelve 401", async () => {
  const response = await loginAdmin("admin@demo.com", "incorrecta");
  assert.equal(response.status, 401);
});

test("login con usuario inexistente devuelve 401", async () => {
  const response = await loginAdmin("no-existe@demo.com", "admin123");
  assert.equal(response.status, 401);
});

test("login correcto devuelve token", async () => {
  const response = await loginAdmin("admin@demo.com", "admin123");
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.token, "string");
  assert.ok(response.body.token.length > 20);
  assert.equal(response.body.user.email, "admin@demo.com");
  assert.equal(response.body.user.role, "owner");
  assert.equal(response.body.business.slug, "demo");
});

test("GET /api/businesses/demo/reservations con token valido devuelve 200", async () => {
  const response = await request(`${DEMO_API}/reservations`, {
    headers: adminHeaders(),
  });

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body));
});

test("token valido pero slug de otro negocio devuelve 403", async () => {
  await createOtherBusiness();
  const response = await request("/api/businesses/otro/reservations", {
    headers: adminHeaders(),
  });

  assert.equal(response.status, 403);
});

test("usuario de otro negocio no accede a demo", async () => {
  await createOtherBusiness();
  const login = await loginAdmin("admin@otro.com", "otro123", "otro");
  const response = await request(`${DEMO_API}/reservations`, {
    headers: {
      Authorization: `Bearer ${login.body.token}`,
    },
  });

  assert.equal(login.status, 200);
  assert.equal(response.status, 403);
});

test("DELETE /api/businesses/demo/reservations/:id sin token devuelve 401", async () => {
  const reservationResponse = await createReservation();
  const response = await request(`${DEMO_API}/reservations/${reservationResponse.body.id}`, {
    method: "DELETE",
  });

  assert.equal(reservationResponse.status, 201);
  assert.equal(response.status, 401);
});

test("DELETE /api/businesses/demo/reservations/:id con token valido elimina", async () => {
  const reservationResponse = await createReservation();
  const response = await request(`${DEMO_API}/reservations/${reservationResponse.body.id}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
  const list = await request(`${DEMO_API}/reservations`, {
    headers: adminHeaders(),
  });

  assert.equal(reservationResponse.status, 201);
  assert.equal(response.status, 204);
  assert.equal(list.body.length, 0);
});

test("fecha invalida rechaza 400", async () => {
  const response = await createReservation({ date: "2026-02-30" });
  assert.equal(response.status, 400);
});

test("horario invalido rechaza 400", async () => {
  const response = await createReservation({ time: "9:00" });
  assert.equal(response.status, 400);
});

test("telefono local ambiguo con 15 rechaza 400", async () => {
  const response = await createReservation({ customerPhone: "15-432877" });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "missing_area_code");
  assert.match(response.body.error, /código de área/);
});

test("reserva valida con profesional especifico acepta 201", async () => {
  const response = await createReservation({
    serviceId: "asesoria",
    professionalId: 1,
    time: "09:00",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.professionalId, 1);
  assert.equal(response.body.date, "2026-06-08");
  assert.equal(response.body.durationMinutes, 60);
});

test("POST /api/businesses/demo/reservations crea reserva valida y devuelve 201", async () => {
  const response = await createReservation();

  assert.equal(response.status, 201);
  assert.equal(response.body.businessId > 0, true);
  assert.equal(response.body.serviceId, "consulta");
  assert.equal(typeof response.body.cancelToken, "string");
  assert.equal(response.body.cancelToken.length, 64);
});

test("crear reserva encola confirmacion y recordatorio", async () => {
  const response = await createReservation({
    customerName: "Juan Perez",
    customerPhone: "3549504056",
  });

  assert.equal(response.status, 201);

  const notifications = await withDb((db) => db.all(
    `
      SELECT *
      FROM notifications
      WHERE booking_id = ?
      ORDER BY type ASC
    `,
    response.body.id,
  ));

  assert.equal(notifications.length, 2);
  assert.deepEqual(notifications.map((item) => item.type).sort(), ["booking_confirmed", "booking_reminder_24h"]);
  assert.ok(notifications.every((item) => item.business_id === response.body.businessId));
  assert.ok(notifications.every((item) => item.channel === "whatsapp"));
  assert.ok(notifications.every((item) => item.recipient === "5493549504056"));
  assert.ok(notifications.find((item) => item.type === "booking_confirmed").message.includes("Hola Juan Perez"));
  assert.equal(notifications.find((item) => item.type === "booking_reminder_24h").status, "pending");
});

test("no encola recordatorio si el turno empieza en menos de 24 horas", async () => {
  const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const date = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
  const time = `${String(soon.getHours()).padStart(2, "0")}:${String(soon.getMinutes()).padStart(2, "0")}`;
  await withDb(async (db) => {
    await db.run("DELETE FROM professional_schedules WHERE business_id = 1 AND professional_id = 1 AND weekday = ?", soon.getDay());
    await db.run(
      `
        INSERT INTO professional_schedules (business_id, professional_id, weekday, start_time, end_time, interval_minutes)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [1, 1, soon.getDay(), "00:00", "23:59", 1],
    );
  });

  const response = await createReservation({
    date,
    time,
    customerPhone: "3549504056",
  });

  assert.equal(response.status, 201);

  const notifications = await withDb((db) => db.all(
    "SELECT type, recipient FROM notifications WHERE booking_id = ? ORDER BY type",
    response.body.id,
  ));

  assert.deepEqual(notifications.map((item) => item.type), ["booking_confirmed"]);
  assert.equal(notifications[0].recipient, "5493549504056");
});

test("reserva con seña encola pedido de pago y no recordatorio", async () => {
  await createDepositService("sena-notificacion", 1800);
  const response = await createReservation({
    serviceId: "sena-notificacion",
    professionalId: 1,
    time: "09:00",
    customerName: "Cliente Seña",
    customerPhone: "3549504056",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.depositStatus, "pending");

  const notifications = await withDb((db) => db.all(
    "SELECT type, message FROM notifications WHERE booking_id = ? ORDER BY type",
    response.body.id,
  ));

  assert.deepEqual(notifications.map((item) => item.type), ["booking_payment_request"]);
  assert.ok(notifications[0].message.includes("1800"));
  assert.ok(notifications[0].message.includes(`/demo/cancelar/${response.body.cancelToken}`));
});

test("confirmar pago encola confirmacion de seña y recordatorio", async () => {
  await createDepositService("sena-pago", 2000);
  const created = await createReservation({
    serviceId: "sena-pago",
    professionalId: 1,
    time: "09:00",
    customerName: "Cliente Pago",
  });
  const confirmed = await adminRequest(`${DEMO_API}/admin/bookings/${created.body.id}/confirm-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, "confirmado");
  assert.equal(confirmed.body.depositStatus, "paid");

  const notifications = await withDb((db) => db.all(
    "SELECT type, status, message FROM notifications WHERE booking_id = ? ORDER BY type",
    created.body.id,
  ));

  assert.deepEqual(
    notifications.map((item) => item.type).sort(),
    ["booking_payment_confirmed", "booking_payment_request", "booking_reminder_24h"],
  );
  assert.equal(notifications.find((item) => item.type === "booking_reminder_24h").status, "pending");
  assert.ok(notifications.find((item) => item.type === "booking_payment_confirmed").message.includes("Recibimos correctamente"));
});

test("cancelar reserva cancela recordatorio pendiente y encola cancelacion", async () => {
  const created = await createReservation({
    customerName: "Juan Cancelado",
    customerPhone: "3549504056",
  });
  assert.equal(created.status, 201);

  const deleted = await adminRequest(`${DEMO_API}/reservations/${created.body.id}`, {
    method: "DELETE",
  });
  assert.equal(deleted.status, 204);

  const notifications = await withDb((db) => db.all(
    `
      SELECT type, status, message
      FROM notifications
      WHERE booking_id = ?
      ORDER BY type ASC
    `,
    created.body.id,
  ));

  const reminder = notifications.find((item) => item.type === "booking_reminder_24h");
  const cancellation = notifications.find((item) => item.type === "booking_cancelled");

  assert.equal(reminder.status, "cancelled");
  assert.equal(cancellation.status, "pending");
  assert.ok(cancellation.message.includes("Juan Cancelado"));
  assert.ok(cancellation.message.includes("https://turno-simple-production.up.railway.app/demo"));
  assert.equal(cancellation.message.includes("localhost:8080"), false);
});

test("booking_cancelled en PATCH status cancelado usa PUBLIC_BASE_URL", async () => {
  const created = await createReservation({
    customerName: "Juan Patch",
    customerPhone: "3549504056",
  });
  assert.equal(created.status, 201);

  const updated = await adminRequest(`${DEMO_API}/admin/reservations/${created.body.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cancelado" }),
  });
  assert.equal(updated.status, 200);

  const cancellation = await withDb((db) => db.get(
    `
      SELECT message
      FROM notifications
      WHERE booking_id = ?
        AND type = 'booking_cancelled'
    `,
    created.body.id,
  ));

  assert.ok(cancellation.message.includes("https://turno-simple-production.up.railway.app/demo"));
  assert.equal(cancellation.message.includes("localhost:8080"), false);
});

test("cancelacion publica cancela reserva y encola booking_cancelled", async () => {
  const created = await createReservation({
    customerName: "Cliente Publico",
    customerPhone: "3549504056",
  });
  const page = await fetch(`${baseUrl}/demo/cancelar/${created.body.cancelToken}`);
  const pageText = await page.text();
  const cancelled = await fetch(`${baseUrl}/demo/cancelar/${created.body.cancelToken}`, {
    method: "POST",
  });
  const successText = await cancelled.text();

  assert.equal(page.status, 200);
  assert.ok(pageText.includes("Cancelar turno"));
  assert.equal(cancelled.status, 200);
  assert.ok(successText.includes("Turno cancelado"));

  const row = await withDb((db) => db.get(
    "SELECT status, cancelled_by FROM reservations WHERE id = ?",
    created.body.id,
  ));
  const cancellation = await withDb((db) => db.get(
    "SELECT type, message FROM notifications WHERE booking_id = ? AND type = 'booking_cancelled'",
    created.body.id,
  ));

  assert.equal(row.status, "cancelado");
  assert.equal(row.cancelled_by, "client");
  assert.equal(cancellation.type, "booking_cancelled");
  assert.ok(cancellation.message.includes("Cliente Publico"));
});

test("cancelacion publica doble no duplica booking_cancelled", async () => {
  const created = await createReservation();
  const url = `${baseUrl}/demo/cancelar/${created.body.cancelToken}`;
  const first = await fetch(url, { method: "POST" });
  const second = await fetch(url, { method: "POST" });
  const secondText = await second.text();

  const count = await withDb((db) => db.get(
    "SELECT COUNT(*) AS count FROM notifications WHERE booking_id = ? AND type = 'booking_cancelled'",
    created.body.id,
  ));

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.ok(secondText.includes("ya estaba cancelado"));
  assert.equal(count.count, 1);
});

test("un profesional de otro negocio no puede recibir reserva en demo", async () => {
  const { professional } = await createOtherBusiness();
  const response = await createReservation({
    professionalId: professional.id,
    time: "09:00",
  });

  assert.equal(response.status, 400);
});

test("solapamientos no cruzan entre negocios distintos", async () => {
  await createOtherBusiness();
  const other = await createReservation({
    slug: "otro",
    serviceId: "consulta",
    professionalId: null,
    time: "09:00",
  });
  const demo = await createReservation({
    serviceId: "consulta",
    professionalId: 1,
    time: "09:00",
  });

  assert.equal(other.status, 201);
  assert.equal(demo.status, 201);
});

test("reserva solapada rechaza 409", async () => {
  const first = await createReservation({
    serviceId: "asesoria",
    professionalId: 1,
    time: "09:00",
  });
  const overlap = await createReservation({
    serviceId: "consulta",
    professionalId: 1,
    time: "09:30",
  });

  assert.equal(first.status, 201);
  assert.equal(overlap.status, 409);
});

test("reserva no solapada acepta 201", async () => {
  const first = await createReservation({
    serviceId: "asesoria",
    professionalId: 1,
    time: "09:00",
  });
  const second = await createReservation({
    serviceId: "consulta",
    professionalId: 1,
    time: "10:00",
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
});

test("Cualquiera disponible asigna profesional libre", async () => {
  const first = await createReservation({
    serviceId: "consulta",
    professionalId: 1,
    time: "09:00",
  });
  const automatic = await createReservation({
    serviceId: "consulta",
    professionalId: null,
    time: "09:00",
  });

  assert.equal(first.status, 201);
  assert.equal(automatic.status, 201);
  assert.equal(automatic.body.professionalName, "Bruno Ruiz");
});

test("Cualquiera disponible solo asigna profesionales del mismo negocio", async () => {
  await createOtherBusiness();
  await withDb((db) => db.run(
    "DELETE FROM professional_schedules WHERE business_id = 1 AND weekday = 0",
  ));
  const demo = await createReservation({
    serviceId: "consulta",
    professionalId: null,
    date: "2026-06-07",
    time: "09:00",
  });
  const other = await createReservation({
    slug: "otro",
    serviceId: "consulta",
    professionalId: null,
    date: "2026-06-07",
    time: "09:00",
  });

  assert.equal(demo.status, 409);
  assert.equal(other.status, 201);
  assert.equal(other.body.professionalName, "Profesional Otro");
});

test("Cualquiera disponible rechaza si nadie esta libre", async () => {
  const ana = await createReservation({
    serviceId: "consulta",
    professionalId: 1,
    time: "09:00",
  });
  const bruno = await createReservation({
    serviceId: "consulta",
    professionalId: 2,
    time: "09:00",
  });
  const automatic = await createReservation({
    serviceId: "consulta",
    professionalId: null,
    time: "09:00",
  });

  assert.equal(ana.status, 201);
  assert.equal(bruno.status, 201);
  assert.equal(automatic.status, 409);
});

test("CRUD servicios admin funciona y no cruza negocios", async () => {
  await createOtherBusiness();
  const unauthorized = await request(`${DEMO_API}/admin/services`);
  const missingSlug = await adminRequest("/api/businesses/no-existe/admin/services");
  const created = await adminRequest(`${DEMO_API}/admin/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "masaje", name: "Masaje", durationMinutes: 40, price: 1000 }),
  });
  const updated = await adminRequest(`${DEMO_API}/admin/services/masaje`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Masaje Relax", durationMinutes: 45, price: 1200 }),
  });
  const demoServices = await adminRequest(`${DEMO_API}/admin/services`);
  const otherServices = await adminRequest("/api/businesses/otro/admin/services");
  const deleted = await adminRequest(`${DEMO_API}/admin/services/masaje`, { method: "DELETE" });

  assert.equal(unauthorized.status, 401);
  assert.equal(missingSlug.status, 404);
  assert.equal(created.status, 201);
  assert.equal(created.body.id, "masaje");
  assert.equal(updated.status, 200);
  assert.equal(updated.body.durationMinutes, 45);
  assert.ok(demoServices.body.some((service) => service.id === "masaje"));
  assert.equal(otherServices.status, 403);
  assert.equal(deleted.status, 204);
});

test("CRUD servicios admin permite configurar seña", async () => {
  const created = await adminRequest(`${DEMO_API}/admin/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "color-sena",
      name: "Color con seña",
      durationMinutes: 30,
      price: 5000,
      requiresDeposit: true,
      depositAmount: 1500,
      paymentInstructions: "Transferir al alias barberia.demo.mp",
    }),
  });
  const updated = await adminRequest(`${DEMO_API}/admin/services/color-sena`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Color con seña editado",
      durationMinutes: 45,
      price: 6000,
      requiresDeposit: true,
      depositAmount: 2000,
      paymentInstructions: "Enviar comprobante por WhatsApp.",
    }),
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.requiresDeposit, true);
  assert.equal(created.body.depositAmount, 1500);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.requiresDeposit, true);
  assert.equal(updated.body.depositAmount, 2000);
  assert.equal(updated.body.paymentInstructions, "Enviar comprobante por WhatsApp.");
});

test("no permite borrar servicio con reservas existentes", async () => {
  const created = await createReservation({ serviceId: "consulta" });
  const deleted = await adminRequest(`${DEMO_API}/admin/services/consulta`, { method: "DELETE" });

  assert.equal(created.status, 201);
  assert.equal(deleted.status, 409);
});

test("reserva de servicio con seña queda con seña pendiente y ocupa horario", async () => {
  await adminRequest(`${DEMO_API}/admin/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "sena-test",
      name: "Servicio seña test",
      durationMinutes: 30,
      requiresDeposit: true,
      depositAmount: 1000,
      paymentInstructions: "Transferir y enviar comprobante.",
    }),
  });
  const pending = await createReservation({
    serviceId: "sena-test",
    professionalId: 1,
    time: "09:00",
  });
  const overlap = await createReservation({
    serviceId: "consulta",
    professionalId: 1,
    time: "09:00",
  });

  assert.equal(pending.status, 201);
  assert.equal(pending.body.status, "reservado");
  assert.equal(pending.body.depositStatus, "pending");
  assert.equal(overlap.status, 409);
});

test("negocio con alias expone datos de pago para servicio con seña sin instrucciones", async () => {
  await adminRequest(`${DEMO_API}/admin/business`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ whatsapp: "3515555555", address: "Local demo", paymentAlias: "alias.demo.mp" }),
  });
  await adminRequest(`${DEMO_API}/admin/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "sena-alias",
      name: "Servicio con alias",
      durationMinutes: 30,
      requiresDeposit: true,
      depositAmount: 1000,
      paymentInstructions: "",
    }),
  });

  const business = await request(`${DEMO_API}`);
  const servicesResponse = await request(`${DEMO_API}/services`);
  const service = servicesResponse.body.find((item) => item.id === "sena-alias");

  assert.equal(business.body.paymentAlias, "alias.demo.mp");
  assert.equal(business.body.whatsapp, "3515555555");
  assert.equal(service.requiresDeposit, true);
  assert.equal(service.paymentInstructions, "");
});

test("reserva de servicio sin seña queda confirmado", async () => {
  const response = await createReservation({
    serviceId: "consulta",
    professionalId: 1,
    time: "09:00",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.status, "confirmado");
  assert.equal(response.body.depositStatus, "none");
});

test("CRUD profesionales admin funciona y no cruza negocios", async () => {
  await createOtherBusiness();
  const unauthorized = await request(`${DEMO_API}/admin/professionals`);
  const created = await adminRequest(`${DEMO_API}/admin/professionals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Dora Demo" }),
  });
  const updated = await adminRequest(`${DEMO_API}/admin/professionals/${created.body.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Dora Editada" }),
  });
  const demoProfessionals = await adminRequest(`${DEMO_API}/admin/professionals`);
  const otherProfessionals = await adminRequest("/api/businesses/otro/admin/professionals");
  const deleted = await adminRequest(`${DEMO_API}/admin/professionals/${created.body.id}`, { method: "DELETE" });

  assert.equal(unauthorized.status, 401);
  assert.equal(created.status, 201);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, "Dora Editada");
  assert.ok(demoProfessionals.body.some((professional) => professional.name === "Dora Editada"));
  assert.equal(otherProfessionals.status, 403);
  assert.equal(deleted.status, 204);
});

test("no permite borrar profesional con reservas existentes", async () => {
  const created = await createReservation({ professionalId: 1 });
  const deleted = await adminRequest(`${DEMO_API}/admin/professionals/1`, { method: "DELETE" });

  assert.equal(created.status, 201);
  assert.equal(deleted.status, 409);
});

test("CRUD horarios admin funciona y valida datos", async () => {
  const professional = await adminRequest(`${DEMO_API}/admin/professionals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Horario Test" }),
  });
  const invalid = await adminRequest(`${DEMO_API}/admin/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      professionalId: professional.body.id,
      weekday: 1,
      startTime: "12:00",
      endTime: "10:00",
      intervalMinutes: 30,
    }),
  });
  const created = await adminRequest(`${DEMO_API}/admin/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      professionalId: professional.body.id,
      weekday: 1,
      startTime: "09:00",
      endTime: "12:00",
      intervalMinutes: 30,
    }),
  });
  const updated = await adminRequest(`${DEMO_API}/admin/schedules/${created.body.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      professionalId: professional.body.id,
      weekday: 2,
      startTime: "10:00",
      endTime: "13:00",
      intervalMinutes: 60,
    }),
  });
  const list = await adminRequest(`${DEMO_API}/admin/schedules`);
  const deleted = await adminRequest(`${DEMO_API}/admin/schedules/${created.body.id}`, { method: "DELETE" });

  assert.equal(invalid.status, 400);
  assert.equal(created.status, 201);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.weekday, 2);
  assert.ok(list.body.some((schedule) => schedule.id === created.body.id));
  assert.equal(deleted.status, 204);
});

test("horario no permite profesional de otro negocio", async () => {
  const { professional } = await createOtherBusiness();
  const response = await adminRequest(`${DEMO_API}/admin/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      professionalId: professional.id,
      weekday: 1,
      startTime: "09:00",
      endTime: "12:00",
      intervalMinutes: 30,
    }),
  });

  assert.equal(response.status, 400);
});

test("reservas nuevas sin seña tienen status confirmado y seña none", async () => {
  const response = await createReservation();
  assert.equal(response.status, 201);
  assert.equal(response.body.status, "confirmado");
  assert.equal(response.body.depositStatus, "none");
});

test("GET agenda sin token devuelve 401", async () => {
  const response = await request(`${DEMO_API}/admin/agenda`);
  assert.equal(response.status, 401);
});

test("GET agenda con slug inexistente devuelve 404", async () => {
  const response = await adminRequest("/api/businesses/no-existe/admin/agenda");
  assert.equal(response.status, 404);
});

test("GET agenda con token valido devuelve reservas del negocio correcto", async () => {
  await createReservation({ customerName: "Demo Cliente" });
  await createOtherReservation();
  const response = await adminRequest(`${DEMO_API}/admin/agenda`);

  assert.equal(response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].customerName, "Demo Cliente");
});

test("GET agenda filtra por date", async () => {
  await createReservation({ date: "2026-06-01", time: "09:00" });
  await createReservation({ date: "2026-06-02", time: "11:00" });
  const response = await adminRequest(`${DEMO_API}/admin/agenda?date=2026-06-02`);

  assert.equal(response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].date, "2026-06-02");
});

test("GET agenda filtra por professional_id", async () => {
  await createReservation({ professionalId: 1, time: "09:00" });
  await createReservation({ professionalId: 2, time: "11:00" });
  const response = await adminRequest(`${DEMO_API}/admin/agenda?professional_id=2`);

  assert.equal(response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].professionalId, 2);
});

test("GET agenda filtra por service_id", async () => {
  await createReservation({ serviceId: "consulta", professionalId: 1, time: "09:00" });
  await createReservation({ serviceId: "asesoria", professionalId: 1, time: "10:00" });
  const response = await adminRequest(`${DEMO_API}/admin/agenda?service_id=asesoria`);

  assert.equal(response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].serviceId, "asesoria");
});

test("GET agenda filtra por status", async () => {
  const first = await createReservation({ time: "09:00" });
  await createReservation({ time: "10:00" });
  await adminRequest(`${DEMO_API}/admin/reservations/${first.body.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "asistio" }),
  });
  const response = await adminRequest(`${DEMO_API}/admin/agenda?status=asistio`);

  assert.equal(response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].status, "asistio");
});

test("PATCH status sin token devuelve 401", async () => {
  const created = await createReservation();
  const response = await request(`${DEMO_API}/admin/reservations/${created.body.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "confirmado" }),
  });

  assert.equal(response.status, 401);
});

test("PATCH status con status invalido devuelve 400", async () => {
  const created = await createReservation();
  const response = await adminRequest(`${DEMO_API}/admin/reservations/${created.body.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "raro" }),
  });

  assert.equal(response.status, 400);
});

test("PATCH status valido actualiza correctamente", async () => {
  const created = await createReservation();
  const response = await adminRequest(`${DEMO_API}/admin/reservations/${created.body.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "asistio" }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "asistio");
});

test("admin puede confirmar seña pendiente", async () => {
  await adminRequest(`${DEMO_API}/admin/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "sena-confirmar",
      name: "Seña confirmar",
      durationMinutes: 30,
      requiresDeposit: true,
      depositAmount: 1200,
      paymentInstructions: "Transferir.",
    }),
  });
  const created = await createReservation({ serviceId: "sena-confirmar", professionalId: 1, time: "09:00" });
  const response = await adminRequest(`${DEMO_API}/admin/bookings/${created.body.id}/confirm-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  assert.equal(created.body.status, "reservado");
  assert.equal(created.body.depositStatus, "pending");
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "confirmado");
  assert.equal(response.body.depositStatus, "paid");
});

test("PATCH status no permite modificar reserva de otro negocio", async () => {
  const other = await createOtherReservation();
  const response = await adminRequest(`${DEMO_API}/admin/reservations/${other.body.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "confirmado" }),
  });

  assert.equal(response.status, 404);
});

test("Export CSV sin token devuelve 401", async () => {
  const response = await request(`${DEMO_API}/admin/agenda/export.csv`);
  assert.equal(response.status, 401);
});

test("Export CSV con token valido devuelve text/csv", async () => {
  await createReservation({ customerName: "CSV Cliente" });
  const response = await fetch(`${baseUrl}${DEMO_API}/admin/agenda/export.csv`, {
    headers: adminHeaders(),
  });
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/csv/);
  assert.ok(text.includes("Fecha,Hora,Servicio,Profesional,Cliente,Telefono,Estado,Creado"));
  assert.ok(text.includes("CSV Cliente"));
});

test("Export CSV no incluye reservas de otro negocio", async () => {
  await createReservation({ customerName: "Demo CSV" });
  await createOtherReservation();
  const response = await fetch(`${baseUrl}${DEMO_API}/admin/agenda/export.csv`, {
    headers: adminHeaders(),
  });
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.ok(text.includes("Demo CSV"));
  assert.ok(!text.includes("Otro Cliente"));
});
