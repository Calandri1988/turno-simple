const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const {
  cancelPendingBookingNotifications,
  configureNotifications,
  enqueueNotification,
  renderTemplate,
  startWorker,
} = require("./modules/notifications");
const { getPublicBaseUrl } = require("./modules/notifications/getPublicBaseUrl");
const {
  buildBookingDateTime,
  formatDate,
  subtractHours,
} = require("./modules/notifications/date-utils");
const { sendWhatsApp } = require("./services/whatsapp");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "turnos.sqlite");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const reservationStatuses = new Set(["pendiente", "reservado", "confirmado", "cancelado", "asistio", "no_asistio"]);
const depositStatuses = new Set(["none", "pending", "paid"]);
const adminRoles = new Set(["owner", "staff"]);

const servicesSeed = [
  { id: "consulta", name: "Consulta", durationMinutes: 30, price: null },
  { id: "corte", name: "Corte", durationMinutes: 45, price: null },
  { id: "asesoria", name: "Asesoria", durationMinutes: 60, price: null },
];

const professionalsSeed = [
  {
    name: "Ana Torres",
    schedules: [
      { weekday: 1, startTime: "09:00", endTime: "12:00", intervalMinutes: 30 },
      { weekday: 2, startTime: "11:00", endTime: "16:00", intervalMinutes: 60 },
      { weekday: 4, startTime: "10:00", endTime: "15:00", intervalMinutes: 60 },
    ],
  },
  {
    name: "Bruno Ruiz",
    schedules: [
      { weekday: 1, startTime: "09:00", endTime: "17:00", intervalMinutes: 60 },
      { weekday: 3, startTime: "09:30", endTime: "17:30", intervalMinutes: 60 },
      { weekday: 2, startTime: "08:00", endTime: "13:00", intervalMinutes: 90 },
    ],
  },
  {
    name: "Clara Gomez",
    schedules: [
      { weekday: 1, startTime: "12:00", endTime: "20:00", intervalMinutes: 90 },
      { weekday: 5, startTime: "10:00", endTime: "19:00", intervalMinutes: 90 },
      { weekday: 6, startTime: "09:00", endTime: "12:00", intervalMinutes: 60 },
    ],
  },
];

const weekdayNames = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

let db;

async function initDb() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec("PRAGMA foreign_keys = OFF");
  await ensureBusinessesTable();
  const demoBusiness = await ensureDemoBusiness();
  await ensureServicesTable(demoBusiness.id);
  await ensureProfessionalsTable(demoBusiness.id);
  await ensureReservationsTable(demoBusiness.id);
  await ensureProfessionalSchedulesTable(demoBusiness.id);
  await ensureBusinessUsersTable();
  await ensureNotificationsTable();
  await seedServices(demoBusiness.id);
  await seedProfessionals(demoBusiness.id);
  await seedDemoBusinessUser(demoBusiness.id);
  await db.exec("PRAGMA foreign_keys = ON");
  configureNotifications(db);
}

async function ensureBusinessesTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      category TEXT,
      city TEXT,
      whatsapp TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      payment_alias TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const columns = await db.all("PRAGMA table_info(businesses)");
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("whatsapp")) {
    await db.exec("ALTER TABLE businesses ADD COLUMN whatsapp TEXT NOT NULL DEFAULT ''");
  }
  if (!columnNames.has("address")) {
    await db.exec("ALTER TABLE businesses ADD COLUMN address TEXT NOT NULL DEFAULT ''");
  }
  if (!columnNames.has("payment_alias")) {
    await db.exec("ALTER TABLE businesses ADD COLUMN payment_alias TEXT NOT NULL DEFAULT ''");
  }
}

async function ensureDemoBusiness() {
  await db.run(
    `
      INSERT INTO businesses (name, slug, category, city)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        city = excluded.city
    `,
    ["Barbería Central", "demo", "Barbería", "Cruz del Eje"],
  );

  return db.get("SELECT * FROM businesses WHERE slug = ?", "demo");
}

async function ensureBusinessUsersTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS business_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (business_id, email),
      FOREIGN KEY (business_id) REFERENCES businesses(id)
    )
  `);
}

async function ensureNotificationsTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      booking_id INTEGER,
      type TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      recipient TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      scheduled_for DATETIME NOT NULL,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notifications_status_scheduled
    ON notifications(status, scheduled_for)
  `);

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unique_booking_type
    ON notifications(booking_id, type)
    WHERE booking_id IS NOT NULL
  `);
}

async function seedDemoBusinessUser(businessId) {
  const email = "admin@demo.com";
  const existing = await db.get(
    "SELECT id FROM business_users WHERE business_id = ? AND lower(email) = lower(?)",
    [businessId, email],
  );

  if (existing) {
    return;
  }

  const passwordHash = await bcrypt.hash("admin123", 10);
  await db.run(
    `
      INSERT INTO business_users (business_id, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `,
    [businessId, email, passwordHash, "owner"],
  );
}

async function createServicesTable(tableName) {
  await db.exec(`
    CREATE TABLE ${tableName} (
      id TEXT NOT NULL,
      business_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      price REAL,
      requires_deposit INTEGER NOT NULL DEFAULT 0,
      deposit_amount INTEGER NOT NULL DEFAULT 0,
      payment_instructions TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (business_id, id),
      FOREIGN KEY (business_id) REFERENCES businesses(id)
    )
  `);
}

async function ensureServicesTable(demoBusinessId) {
  const columns = await db.all("PRAGMA table_info(services)");
  const hasBusinessId = columns.some((column) => column.name === "business_id");
  const hasRequiresDeposit = columns.some((column) => column.name === "requires_deposit");
  const hasDepositAmount = columns.some((column) => column.name === "deposit_amount");
  const hasPaymentInstructions = columns.some((column) => column.name === "payment_instructions");

  if (columns.length === 0) {
    await createServicesTable("services");
    return;
  }

  if (hasBusinessId) {
    if (!hasRequiresDeposit) {
      await db.exec("ALTER TABLE services ADD COLUMN requires_deposit INTEGER NOT NULL DEFAULT 0");
    }
    if (!hasDepositAmount) {
      await db.exec("ALTER TABLE services ADD COLUMN deposit_amount INTEGER NOT NULL DEFAULT 0");
    }
    if (!hasPaymentInstructions) {
      await db.exec("ALTER TABLE services ADD COLUMN payment_instructions TEXT NOT NULL DEFAULT ''");
    }
    return;
  }

  const rows = await db.all("SELECT * FROM services");
  await db.exec("DROP TABLE IF EXISTS services_new");
  await createServicesTable("services_new");

  for (const row of rows) {
    await db.run(
      `
        INSERT OR IGNORE INTO services_new (
          id,
          business_id,
          name,
          duration_minutes,
          price,
          requires_deposit,
          deposit_amount,
          payment_instructions
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [row.id, demoBusinessId, row.name, row.duration_minutes, row.price, 0, 0, ""],
    );
  }

  await db.exec("DROP TABLE services");
  await db.exec("ALTER TABLE services_new RENAME TO services");
}

async function createProfessionalsTable(tableName) {
  await db.exec(`
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      UNIQUE (business_id, name),
      FOREIGN KEY (business_id) REFERENCES businesses(id)
    )
  `);
}

async function ensureProfessionalsTable(demoBusinessId) {
  const columns = await db.all("PRAGMA table_info(professionals)");
  const hasBusinessId = columns.some((column) => column.name === "business_id");

  if (columns.length === 0) {
    await createProfessionalsTable("professionals");
    return;
  }

  if (hasBusinessId) {
    return;
  }

  const rows = await db.all("SELECT * FROM professionals");
  await db.exec("DROP TABLE IF EXISTS professionals_new");
  await createProfessionalsTable("professionals_new");

  for (const row of rows) {
    await db.run(
      `
        INSERT OR IGNORE INTO professionals_new (
          id,
          business_id,
          name
        )
        VALUES (?, ?, ?)
      `,
      [row.id, demoBusinessId, row.name],
    );
  }

  await db.exec("DROP TABLE professionals");
  await db.exec("ALTER TABLE professionals_new RENAME TO professionals");
}

async function createProfessionalSchedulesTable(tableName) {
  await db.exec(`
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      professional_id INTEGER NOT NULL,
      weekday INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      interval_minutes INTEGER NOT NULL,
      FOREIGN KEY (business_id) REFERENCES businesses(id),
      FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE,
      UNIQUE(business_id, professional_id, weekday, start_time, end_time, interval_minutes)
    )
  `);
}

async function ensureProfessionalSchedulesTable(demoBusinessId) {
  const columns = await db.all("PRAGMA table_info(professional_schedules)");
  const hasBusinessId = columns.some((column) => column.name === "business_id");
  const hasWeekday = columns.some((column) => column.name === "weekday");
  const hasDay = columns.some((column) => column.name === "day");

  if (columns.length === 0) {
    await createProfessionalSchedulesTable("professional_schedules");
    return;
  }

  if (hasBusinessId && hasWeekday && !hasDay) {
    return;
  }

  const rows = await db.all("SELECT * FROM professional_schedules");
  await db.exec("DROP TABLE IF EXISTS professional_schedules_new");
  await createProfessionalSchedulesTable("professional_schedules_new");

  for (const row of rows) {
    const weekday = Number.isInteger(row.weekday)
      ? row.weekday
      : parseWeekday(row.day);

    if (weekday < 0 || weekday > 6) {
      continue;
    }

    await db.run(
      `
        INSERT OR IGNORE INTO professional_schedules_new (
          id,
          business_id,
          professional_id,
          weekday,
          start_time,
          end_time,
          interval_minutes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        row.id,
        row.business_id || demoBusinessId,
        row.professional_id,
        weekday,
        row.start_time,
        row.end_time,
        row.interval_minutes,
      ],
    );
  }

  await db.exec("DROP TABLE professional_schedules");
  await db.exec("ALTER TABLE professional_schedules_new RENAME TO professional_schedules");
}

async function seedServices(businessId) {
  for (const service of servicesSeed) {
    await db.run(
      `
        INSERT INTO services (
          id,
          business_id,
          name,
          duration_minutes,
          price
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(business_id, id) DO UPDATE SET
          name = excluded.name,
          duration_minutes = excluded.duration_minutes,
          price = excluded.price
      `,
      [service.id, businessId, service.name, service.durationMinutes, service.price],
    );
  }
}

async function ensureReservationsTable(demoBusinessId) {
  const columns = await db.all("PRAGMA table_info(reservations)");
  const hasProfessionalId = columns.some((column) => column.name === "professional_id");
  const hasBusinessId = columns.some((column) => column.name === "business_id");
  const hasDate = columns.some((column) => column.name === "date");
  const hasStatus = columns.some((column) => column.name === "status");
  const hasDurationMinutes = columns.some((column) => column.name === "duration_minutes");
  const hasDepositStatus = columns.some((column) => column.name === "deposit_status");
  const hasCancelToken = columns.some((column) => column.name === "cancel_token");
  const hasCancelledBy = columns.some((column) => column.name === "cancelled_by");
  const durationColumn = columns.find((column) => column.name === "duration_minutes");
  const table = await db.get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reservations'",
  );
  const needsUniqueMigration = table?.sql?.includes("UNIQUE(service_id, professional_id, day, time)");
  const needsDurationMigration = hasDurationMinutes && durationColumn?.notnull !== 1;
  const needsMissingDurationMigration = columns.length > 0 && hasProfessionalId && !hasDurationMinutes;
  const needsDateMigration = columns.length > 0 && hasProfessionalId && !hasDate;
  const needsBusinessMigration = columns.length > 0 && hasProfessionalId && !hasBusinessId;
  const needsStatusMigration = columns.length > 0 && hasProfessionalId && !hasStatus;
  const needsCancellationMigration = columns.length > 0 && hasProfessionalId && (!hasDepositStatus || !hasCancelToken || !hasCancelledBy);

  if (columns.length > 0 && !hasProfessionalId) {
    await db.exec("DROP TABLE reservations");
  }

  if (
    columns.length > 0 &&
    hasProfessionalId &&
    (
      needsUniqueMigration ||
      needsDurationMigration ||
      needsMissingDurationMigration ||
      needsDateMigration ||
      needsBusinessMigration ||
      needsStatusMigration ||
      needsCancellationMigration
    )
  ) {
    await migrateReservationsTable(demoBusinessId);
    await ensureReservationsIndexes();
    return;
  }

  await createReservationsTable("reservations");
  await ensureReservationsIndexes();
}

async function createReservationsTable(tableName) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      professional_id INTEGER NOT NULL,
      professional_name TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'reservado',
      deposit_status TEXT NOT NULL DEFAULT 'none',
      cancel_token TEXT,
      cancelled_by TEXT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (business_id) REFERENCES businesses(id),
      FOREIGN KEY (professional_id) REFERENCES professionals(id),
      UNIQUE(business_id, professional_id, date, time)
    )
  `);
}

async function ensureReservationsIndexes() {
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_cancel_token
    ON reservations(cancel_token)
    WHERE cancel_token IS NOT NULL
  `);
}

function createCancelToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function migrateReservationsTable(demoBusinessId) {
  const columns = await db.all("PRAGMA table_info(reservations)");
  const columnNames = new Set(columns.map((column) => column.name));
  const rows = await db.all("SELECT * FROM reservations");

  await db.exec("DROP TABLE IF EXISTS reservations_new");
  await createReservationsTable("reservations_new");

  for (const row of rows) {
    const businessId = row.business_id || demoBusinessId;
    const service = await db.get(
      "SELECT duration_minutes FROM services WHERE business_id = ? AND id = ?",
      [businessId, row.service_id],
    );
    const date = columnNames.has("date") && isValidDate(row.date)
      ? row.date
      : legacyDayToDate(row.day, row.created_at);
    const durationMinutes = Number(row.duration_minutes) > 0
      ? Number(row.duration_minutes)
      : service?.duration_minutes || 30;

    await db.run(
      `
        INSERT OR IGNORE INTO reservations_new (
          id,
          business_id,
          service_id,
          service_name,
          professional_id,
          professional_name,
          date,
          time,
          duration_minutes,
          status,
          deposit_status,
          cancel_token,
          cancelled_by,
          customer_name,
          customer_phone,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        row.id,
        businessId,
        row.service_id,
        row.service_name,
        row.professional_id,
        row.professional_name,
        date,
        row.time,
        durationMinutes,
        reservationStatuses.has(row.status) ? row.status : "reservado",
        depositStatuses.has(row.deposit_status)
          ? row.deposit_status
          : row.status === "pendiente"
            ? "pending"
            : "none",
        row.cancel_token || createCancelToken(),
        row.cancelled_by || null,
        row.customer_name,
        row.customer_phone,
        row.created_at,
      ],
    );
  }

  await db.exec("DROP TABLE reservations");
  await db.exec("ALTER TABLE reservations_new RENAME TO reservations");
}

async function seedProfessionals(businessId) {
  const schedulesCount = await db.get(
    "SELECT COUNT(*) AS count FROM professional_schedules WHERE business_id = ?",
    businessId,
  );

  for (const professional of professionalsSeed) {
    await db.run(
      "INSERT OR IGNORE INTO professionals (business_id, name) VALUES (?, ?)",
      [businessId, professional.name],
    );
    const row = await db.get(
      "SELECT id FROM professionals WHERE business_id = ? AND name = ?",
      [businessId, professional.name],
    );

    if (schedulesCount.count > 0) {
      continue;
    }

    for (const block of professional.schedules) {
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
        [
          businessId,
          row.id,
          block.weekday,
          block.startTime,
          block.endTime,
          block.intervalMinutes,
        ],
      );
    }
  }
}

function mapReservation(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    professionalId: row.professional_id,
    professionalName: row.professional_name,
    date: row.date,
    time: row.time,
    durationMinutes: row.duration_minutes,
    status: row.status || "reservado",
    depositStatus: row.deposit_status || "none",
    cancelToken: row.cancel_token || "",
    cancelledBy: row.cancelled_by || "",
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    createdAt: row.created_at,
  };
}

function mapService(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    price: row.price,
    requiresDeposit: Boolean(row.requires_deposit) || Number(row.deposit_amount) > 0,
    depositAmount: row.deposit_amount || 0,
    paymentInstructions: row.payment_instructions || "",
  };
}

function mapPublicBusiness(row) {
  return {
    name: row.name,
    slug: row.slug,
    category: row.category,
    city: row.city,
    whatsapp: row.whatsapp || "",
    address: row.address || "",
    paymentAlias: row.payment_alias || "",
  };
}

function mapProfessional(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
  };
}

function mapSchedule(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    professionalId: row.professional_id,
    professionalName: row.professional_name,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
    intervalMinutes: row.interval_minutes,
  };
}

async function enqueueBookingCreatedNotifications(business, booking) {
  if (booking.deposit_status === "pending") {
    await enqueuePaymentRequestNotification(business, booking);
    return;
  }

  await enqueueBookingConfirmedNotification(business, booking);
  await enqueueBookingReminderNotification(business, booking);
}

function buildBookingPublicUrl(business, req) {
  return `${getPublicBaseUrl(req)}/${business.slug}`;
}

function buildCancelUrl(business, booking, req) {
  return `${buildBookingPublicUrl(business, req)}/cancelar/${booking.cancel_token}`;
}

async function enqueueBookingConfirmedNotification(business, booking, req) {
  const confirmed = renderTemplate("booking_confirmed", {
    client_name: booking.customer_name,
    service: booking.service_name,
    date: formatDate(booking.date),
    time: booking.time,
    business_name: business.name,
    cancel_url: buildCancelUrl(business, booking, req),
  });

  await enqueueNotification({
    businessId: business.id,
    bookingId: booking.id,
    type: "booking_confirmed",
    channel: confirmed.channel,
    recipient: booking.customer_phone,
    message: confirmed.message,
    scheduledFor: new Date(),
  });
}

async function enqueuePaymentRequestNotification(business, booking, req) {
  const service = await db.get(
    "SELECT deposit_amount FROM services WHERE business_id = ? AND id = ?",
    [business.id, booking.service_id],
  );
  const paymentRequest = renderTemplate("booking_payment_request", {
    client_name: booking.customer_name,
    service: booking.service_name,
    date: formatDate(booking.date),
    time: booking.time,
    deposit_amount: service?.deposit_amount || booking.deposit_amount || 0,
    payment_alias: business.payment_alias || "Consultar con el negocio",
    cancel_url: buildCancelUrl(business, booking, req),
  });

  await enqueueNotification({
    businessId: business.id,
    bookingId: booking.id,
    type: "booking_payment_request",
    channel: paymentRequest.channel,
    recipient: booking.customer_phone,
    message: paymentRequest.message,
    scheduledFor: new Date(),
  });
}

async function enqueuePaymentConfirmedNotification(business, booking, req) {
  const paymentConfirmed = renderTemplate("booking_payment_confirmed", {
    client_name: booking.customer_name,
    service: booking.service_name,
    date: formatDate(booking.date),
    time: booking.time,
    business_name: business.name,
    cancel_url: buildCancelUrl(business, booking, req),
  });

  await enqueueNotification({
    businessId: business.id,
    bookingId: booking.id,
    type: "booking_payment_confirmed",
    channel: paymentConfirmed.channel,
    recipient: booking.customer_phone,
    message: paymentConfirmed.message,
    scheduledFor: new Date(),
  });
}

async function enqueueBookingReminderNotification(business, booking, req) {
  if (booking.deposit_status === "pending") {
    return;
  }
  const bookingDateTime = buildBookingDateTime(booking.date, booking.time);
  if (bookingDateTime.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
    console.log("[notifications] Skipped reminder: booking starts in less than 24h");
    return;
  }

  const reminderDate = subtractHours(bookingDateTime, 24);
  const reminder = renderTemplate("booking_reminder_24h", {
    client_name: booking.customer_name,
    service: booking.service_name,
    time: booking.time,
    business_name: business.name,
    cancel_url: buildCancelUrl(business, booking, req),
  });

  await enqueueNotification({
    businessId: business.id,
    bookingId: booking.id,
    type: "booking_reminder_24h",
    channel: reminder.channel,
    recipient: booking.customer_phone,
    message: reminder.message,
    scheduledFor: reminderDate,
  });
}

async function enqueueBookingCancelledNotification(business, booking, req) {
  await cancelPendingBookingNotifications(booking.id);
  const bookingUrl = buildBookingPublicUrl(business, req);

  console.log("[notifications] booking_cancelled baseUrl=", getPublicBaseUrl(req));
  console.log("[notifications] booking_cancelled bookingUrl=", bookingUrl);

  const cancelled = renderTemplate("booking_cancelled", {
    client_name: booking.customer_name,
    service: booking.service_name,
    date: formatDate(booking.date),
    time: booking.time,
    booking_url: bookingUrl,
  });

  await enqueueNotification({
    businessId: business.id,
    bookingId: booking.id,
    type: "booking_cancelled",
    channel: cancelled.channel,
    recipient: booking.customer_phone,
    message: cancelled.message,
    scheduledFor: new Date(),
  });
}

async function getBusinessBySlug(slug) {
  return db.get("SELECT * FROM businesses WHERE slug = ?", cleanText(slug));
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function mapAdminUser(row) {
  return {
    id: row.id,
    business_id: row.business_id,
    email: row.email,
    role: row.role,
  };
}

function createAdminToken(user) {
  return jwt.sign(
    {
      user_id: user.id,
      business_id: user.business_id,
      role: user.role,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: "8h" },
  );
}

async function requireAdmin(req, res, next) {
  const [type, token] = String(req.headers.authorization || "").split(" ");

  if (type !== "Bearer" || !token) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.get(
      `
        SELECT id, business_id, email, role
        FROM business_users
        WHERE id = ? AND business_id = ?
      `,
      [payload.user_id, payload.business_id],
    );

    if (!user || !adminRoles.has(user.role)) {
      res.status(401).json({ error: "No autorizado." });
      return;
    }

    req.adminUser = mapAdminUser(user);
    next();
  } catch (error) {
    res.status(401).json({ error: "No autorizado." });
  }
}

async function getBusinessOr404(req, res) {
  const business = await getBusinessBySlug(req.params.slug);
  if (!business) {
    res.status(404).json({ error: "Negocio no encontrado." });
    return null;
  }

  if (req.adminUser && business.id !== req.adminUser.business_id) {
    res.status(403).json({ error: "No autorizado para este negocio." });
    return null;
  }

  return business;
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseRequiredPositiveInteger(value) {
  const parsed = parseOptionalPositiveInteger(value);
  return parsed.value && parsed.valid ? parsed.value : null;
}

function parseOptionalPrice(value) {
  if (value === undefined || value === null || value === "") {
    return { value: null, valid: true };
  }

  const number = Number(value);
  return {
    value: number,
    valid: Number.isFinite(number) && number >= 0,
  };
}

function parseNonNegativeInteger(value) {
  if (value === undefined || value === null || value === "") {
    return { value: 0, valid: true };
  }

  const number = Number(value);
  return {
    value: number,
    valid: Number.isInteger(number) && number >= 0,
  };
}

function parseBooleanFlag(value) {
  return value === true || value === "true" || value === "1" || value === 1 || value === "on" ? 1 : 0;
}

function parseWeekdayNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 6) {
    return null;
  }

  return number;
}

function parseStatus(value) {
  const status = cleanText(value);
  return reservationStatuses.has(status) ? status : null;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function buildAgendaQuery(business, query) {
  const where = ["business_id = ?"];
  const params = [business.id];

  if (query.date) {
    const date = cleanText(query.date);
    if (!isValidDate(date)) {
      return { error: { status: 400, message: "Fecha invalida." } };
    }
    where.push("date = ?");
    params.push(date);
  }

  if (query.professional_id) {
    const professionalId = parseRequiredPositiveInteger(query.professional_id);
    if (!professionalId) {
      return { error: { status: 400, message: "Profesional invalido." } };
    }
    const professional = await db.get(
      "SELECT id FROM professionals WHERE business_id = ? AND id = ?",
      [business.id, professionalId],
    );
    if (!professional) {
      return { error: { status: 400, message: "Profesional invalido." } };
    }
    where.push("professional_id = ?");
    params.push(professionalId);
  }

  if (query.service_id) {
    const serviceId = cleanText(query.service_id);
    const service = await db.get(
      "SELECT id FROM services WHERE business_id = ? AND id = ?",
      [business.id, serviceId],
    );
    if (!service) {
      return { error: { status: 400, message: "Servicio invalido." } };
    }
    where.push("service_id = ?");
    params.push(serviceId);
  }

  if (query.status) {
    const status = parseStatus(query.status);
    if (!status) {
      return { error: { status: 400, message: "Estado invalido." } };
    }
    where.push("status = ?");
    params.push(status);
  }

  return {
    params,
    sql: `
      SELECT *
      FROM reservations
      WHERE ${where.join(" AND ")}
      ORDER BY date ASC, time ASC, professional_name ASC
    `,
  };
}

async function getAgendaRows(req, res) {
  const business = await getBusinessOr404(req, res);
  if (!business) return null;

  const agendaQuery = await buildAgendaQuery(business, req.query);
  if (agendaQuery.error) {
    res.status(agendaQuery.error.status).json({ error: agendaQuery.error.message });
    return null;
  }

  const rows = await db.all(agendaQuery.sql, agendaQuery.params);
  return { business, rows };
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function getWeekdayFromDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

function parseWeekday(value) {
  const text = cleanText(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const firstWord = text.split(/\s+/)[0];
  return weekdayNames[firstWord] ?? -1;
}

function legacyDayToDate(day, createdAt) {
  if (isValidDate(day)) {
    return day;
  }

  const base = createdAt ? new Date(createdAt) : new Date();
  const baseDate = Number.isNaN(base.getTime()) ? new Date() : base;
  const dayNumber = cleanText(day).match(/\d{1,2}/)?.[0];

  if (dayNumber) {
    const candidate = new Date(baseDate.getFullYear(), baseDate.getMonth(), Number(dayNumber));
    if (candidate < new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate())) {
      candidate.setMonth(candidate.getMonth() + 1);
    }
    return toIsoDate(candidate);
  }

  const weekday = parseWeekday(day);
  if (weekday >= 0) {
    const candidate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    const distance = (weekday - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + distance);
    return toIsoDate(candidate);
  }

  return toIsoDate(baseDate);
}

function parseOptionalPositiveInteger(value) {
  if (value === undefined || value === null || value === "") {
    return { value: null, valid: true };
  }

  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    return { value: null, valid: false };
  }

  const number = Number(text);
  return {
    value: number,
    valid: Number.isSafeInteger(number),
  };
}

function isValidTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function rangesOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

async function professionalHasSchedule(businessId, professionalId, date, time, durationMinutes) {
  const startMinutes = timeToMinutes(time);
  const endTime = minutesToTime(timeToMinutes(time) + durationMinutes);
  const weekday = getWeekdayFromDate(date);
  const row = await db.get(
    `
      SELECT start_time, interval_minutes
      FROM professional_schedules
      WHERE business_id = ?
        AND professional_id = ?
        AND weekday = ?
        AND ? >= start_time
        AND ? <= end_time
    `,
    [businessId, professionalId, weekday, time, endTime],
  );

  if (!row) {
    return false;
  }

  return (startMinutes - timeToMinutes(row.start_time)) % row.interval_minutes === 0;
}

async function hasReservationOverlap(businessId, professionalId, date, time, durationMinutes) {
  const newStart = timeToMinutes(time);
  const newEnd = newStart + durationMinutes;
  const rows = await db.all(
    `
      SELECT r.time, r.duration_minutes
      FROM reservations r
      WHERE r.business_id = ?
        AND r.professional_id = ?
        AND r.date = ?
    `,
    [businessId, professionalId, date],
  );

  return rows.some((reservation) => {
    const reservedStart = timeToMinutes(reservation.time);
    const reservedEnd = reservedStart + reservation.duration_minutes;
    return rangesOverlap(newStart, newEnd, reservedStart, reservedEnd);
  });
}

async function findAvailableProfessional(businessId, date, time, durationMinutes, preferredProfessionalId) {
  const startMinutes = timeToMinutes(time);
  const endTime = minutesToTime(timeToMinutes(time) + durationMinutes);
  const weekday = getWeekdayFromDate(date);
  const params = [businessId, weekday, time, endTime];
  let professionalFilter = "";

  if (preferredProfessionalId) {
    professionalFilter = "AND p.id = ?";
    params.push(preferredProfessionalId);
  }

  const candidates = await db.all(
    `
      SELECT p.id, p.name, ps.start_time, ps.interval_minutes
      FROM professionals p
      JOIN professional_schedules ps ON ps.professional_id = p.id
      WHERE p.business_id = ?
        AND ps.business_id = p.business_id
        AND ps.weekday = ?
        AND ? >= ps.start_time
        AND ? <= ps.end_time
        ${professionalFilter}
      ORDER BY p.name ASC
    `,
    params,
  );

  for (const professional of candidates) {
    const isAligned =
      (startMinutes - timeToMinutes(professional.start_time)) % professional.interval_minutes === 0;
    if (!isAligned) {
      continue;
    }

    if (!(await hasReservationOverlap(businessId, professional.id, date, time, durationMinutes))) {
      return professional;
    }
  }

  return null;
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname, { index: false }));

app.get("/api/businesses/:slug", async (req, res) => {
  const business = await getBusinessBySlug(req.params.slug);
  if (!business) {
    res.status(404).json({ error: "Negocio no encontrado." });
    return;
  }

  res.json(mapPublicBusiness(business));
});

app.post("/api/businesses/:slug/admin/login", async (req, res) => {
  const business = await getBusinessBySlug(req.params.slug);
  if (!business) {
    res.status(404).json({ error: "Negocio no encontrado." });
    return;
  }

  const email = normalizeEmail(req.body.email);
  const password = cleanText(req.body.password);
  if (!email || !password) {
    res.status(401).json({ error: "Credenciales invalidas." });
    return;
  }

  const user = await db.get(
    `
      SELECT id, business_id, email, password_hash, role
      FROM business_users
      WHERE business_id = ? AND lower(email) = lower(?)
    `,
    [business.id, email],
  );

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: "Credenciales invalidas." });
    return;
  }

  const publicUser = mapAdminUser(user);
  res.json({
    token: createAdminToken(publicUser),
    user: publicUser,
    business: {
      id: business.id,
      slug: business.slug,
      name: business.name,
    },
  });
});

app.put("/api/businesses/:slug/admin/business", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const whatsapp = cleanText(req.body.whatsapp);
  const address = cleanText(req.body.address);
  const paymentAlias = cleanText(req.body.paymentAlias ?? req.body.payment_alias);

  await db.run(
    `
      UPDATE businesses
      SET whatsapp = ?,
          address = ?,
          payment_alias = ?
      WHERE id = ?
    `,
    [whatsapp, address, paymentAlias, business.id],
  );

  const updated = await db.get("SELECT * FROM businesses WHERE id = ?", business.id);
  res.json(mapPublicBusiness(updated));
});

app.get("/api/businesses/:slug/services", async (req, res) => {
  const business = await getBusinessBySlug(req.params.slug);
  if (!business) {
    res.status(404).json({ error: "Negocio no encontrado." });
    return;
  }

  const rows = await db.all(`
    SELECT *
    FROM services
    WHERE business_id = ?
    ORDER BY name ASC
  `, business.id);

  res.json(rows.map(mapService));
});

app.get("/api/businesses/:slug/professionals", async (req, res) => {
  const business = await getBusinessBySlug(req.params.slug);
  if (!business) {
    res.status(404).json({ error: "Negocio no encontrado." });
    return;
  }

  const rows = await db.all(`
    SELECT
      p.id,
      p.name,
      ps.weekday,
      ps.start_time,
      ps.end_time,
      ps.interval_minutes
    FROM professionals p
    LEFT JOIN professional_schedules ps ON ps.professional_id = p.id
      AND ps.business_id = p.business_id
    WHERE p.business_id = ?
    ORDER BY p.name ASC, ps.weekday ASC, ps.start_time ASC
  `, business.id);

  const professionals = new Map();
  rows.forEach((row) => {
    if (!professionals.has(row.id)) {
      professionals.set(row.id, {
        id: row.id,
        name: row.name,
        schedules: [],
      });
    }

    if (row.weekday === null || row.weekday === undefined) {
      return;
    }

    const professional = professionals.get(row.id);
    professional.schedules.push({
      weekday: row.weekday,
      startTime: row.start_time,
      endTime: row.end_time,
      intervalMinutes: row.interval_minutes,
    });
  });

  res.json([...professionals.values()]);
});

app.get("/api/businesses/:slug/admin/services", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const rows = await db.all(
    `
      SELECT *
      FROM services
      WHERE business_id = ?
      ORDER BY name ASC
    `,
    business.id,
  );

  res.json(rows.map(mapService));
});

app.post("/api/businesses/:slug/admin/services", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const name = cleanText(req.body.name);
  const id = slugify(req.body.id || name);
  const durationMinutes = parseRequiredPositiveInteger(req.body.durationMinutes ?? req.body.duration_minutes);
  const price = parseOptionalPrice(req.body.price);
  const requiresDeposit = parseBooleanFlag(req.body.requiresDeposit ?? req.body.requires_deposit);
  const depositAmount = parseNonNegativeInteger(req.body.depositAmount ?? req.body.deposit_amount);
  const paymentInstructions = cleanText(req.body.paymentInstructions ?? req.body.payment_instructions);

  if (!id || !name || !durationMinutes || !price.valid || !depositAmount.valid) {
    res.status(400).json({ error: "Datos de servicio invalidos." });
    return;
  }

  try {
    await db.run(
      `
        INSERT INTO services (
          business_id,
          id,
          name,
          duration_minutes,
          price,
          requires_deposit,
          deposit_amount,
          payment_instructions
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [business.id, id, name, durationMinutes, price.value, requiresDeposit, depositAmount.value, paymentInstructions],
    );
  } catch (error) {
    if (error && error.code === "SQLITE_CONSTRAINT") {
      res.status(409).json({ error: "Ya existe un servicio con ese id." });
      return;
    }
    throw error;
  }

  const row = await db.get(
    "SELECT * FROM services WHERE business_id = ? AND id = ?",
    [business.id, id],
  );
  res.status(201).json(mapService(row));
});

app.put("/api/businesses/:slug/admin/services/:id", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const id = cleanText(req.params.id);
  const name = cleanText(req.body.name);
  const durationMinutes = parseRequiredPositiveInteger(req.body.durationMinutes ?? req.body.duration_minutes);
  const price = parseOptionalPrice(req.body.price);
  const requiresDeposit = parseBooleanFlag(req.body.requiresDeposit ?? req.body.requires_deposit);
  const depositAmount = parseNonNegativeInteger(req.body.depositAmount ?? req.body.deposit_amount);
  const paymentInstructions = cleanText(req.body.paymentInstructions ?? req.body.payment_instructions);

  if (!id || !name || !durationMinutes || !price.valid || !depositAmount.valid) {
    res.status(400).json({ error: "Datos de servicio invalidos." });
    return;
  }

  const result = await db.run(
    `
      UPDATE services
      SET name = ?,
          duration_minutes = ?,
          price = ?,
          requires_deposit = ?,
          deposit_amount = ?,
          payment_instructions = ?
      WHERE business_id = ? AND id = ?
    `,
    [name, durationMinutes, price.value, requiresDeposit, depositAmount.value, paymentInstructions, business.id, id],
  );

  if (result.changes === 0) {
    res.status(404).json({ error: "Servicio no encontrado." });
    return;
  }

  const row = await db.get(
    "SELECT * FROM services WHERE business_id = ? AND id = ?",
    [business.id, id],
  );
  res.json(mapService(row));
});

app.delete("/api/businesses/:slug/admin/services/:id", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const id = cleanText(req.params.id);
  const reservationsCount = await db.get(
    "SELECT COUNT(*) AS count FROM reservations WHERE business_id = ? AND service_id = ?",
    [business.id, id],
  );

  if (reservationsCount.count > 0) {
    res.status(409).json({ error: "No se puede borrar un servicio con reservas." });
    return;
  }

  const result = await db.run(
    "DELETE FROM services WHERE business_id = ? AND id = ?",
    [business.id, id],
  );

  if (result.changes === 0) {
    res.status(404).json({ error: "Servicio no encontrado." });
    return;
  }

  res.status(204).end();
});

app.get("/api/businesses/:slug/admin/professionals", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const rows = await db.all(
    `
      SELECT *
      FROM professionals
      WHERE business_id = ?
      ORDER BY name ASC
    `,
    business.id,
  );

  res.json(rows.map(mapProfessional));
});

app.post("/api/businesses/:slug/admin/professionals", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const name = cleanText(req.body.name);
  if (!name) {
    res.status(400).json({ error: "Nombre de profesional obligatorio." });
    return;
  }

  try {
    const result = await db.run(
      "INSERT INTO professionals (business_id, name) VALUES (?, ?)",
      [business.id, name],
    );
    const row = await db.get("SELECT * FROM professionals WHERE id = ?", result.lastID);
    res.status(201).json(mapProfessional(row));
  } catch (error) {
    if (error && error.code === "SQLITE_CONSTRAINT") {
      res.status(409).json({ error: "Ya existe un profesional con ese nombre." });
      return;
    }
    throw error;
  }
});

app.put("/api/businesses/:slug/admin/professionals/:id", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const id = parseRequiredPositiveInteger(req.params.id);
  const name = cleanText(req.body.name);
  if (!id || !name) {
    res.status(400).json({ error: "Datos de profesional invalidos." });
    return;
  }

  try {
    const result = await db.run(
      "UPDATE professionals SET name = ? WHERE business_id = ? AND id = ?",
      [name, business.id, id],
    );
    if (result.changes === 0) {
      res.status(404).json({ error: "Profesional no encontrado." });
      return;
    }
    const row = await db.get("SELECT * FROM professionals WHERE business_id = ? AND id = ?", [business.id, id]);
    res.json(mapProfessional(row));
  } catch (error) {
    if (error && error.code === "SQLITE_CONSTRAINT") {
      res.status(409).json({ error: "Ya existe un profesional con ese nombre." });
      return;
    }
    throw error;
  }
});

app.delete("/api/businesses/:slug/admin/professionals/:id", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const id = parseRequiredPositiveInteger(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Id invalido." });
    return;
  }

  const reservationsCount = await db.get(
    "SELECT COUNT(*) AS count FROM reservations WHERE business_id = ? AND professional_id = ?",
    [business.id, id],
  );

  if (reservationsCount.count > 0) {
    res.status(409).json({ error: "No se puede borrar un profesional con reservas." });
    return;
  }

  await db.run(
    "DELETE FROM professional_schedules WHERE business_id = ? AND professional_id = ?",
    [business.id, id],
  );
  const result = await db.run(
    "DELETE FROM professionals WHERE business_id = ? AND id = ?",
    [business.id, id],
  );

  if (result.changes === 0) {
    res.status(404).json({ error: "Profesional no encontrado." });
    return;
  }

  res.status(204).end();
});

app.get("/api/businesses/:slug/admin/schedules", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const rows = await db.all(
    `
      SELECT
        ps.*,
        p.name AS professional_name
      FROM professional_schedules ps
      JOIN professionals p ON p.id = ps.professional_id
        AND p.business_id = ps.business_id
      WHERE ps.business_id = ?
      ORDER BY ps.weekday ASC, ps.start_time ASC, p.name ASC
    `,
    business.id,
  );

  res.json(rows.map(mapSchedule));
});

app.post("/api/businesses/:slug/admin/schedules", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const professionalId = parseRequiredPositiveInteger(req.body.professionalId ?? req.body.professional_id);
  const weekday = parseWeekdayNumber(req.body.weekday);
  const startTime = cleanText(req.body.startTime ?? req.body.start_time);
  const endTime = cleanText(req.body.endTime ?? req.body.end_time);
  const intervalMinutes = parseRequiredPositiveInteger(req.body.intervalMinutes ?? req.body.interval_minutes);

  if (
    !professionalId ||
    weekday === null ||
    !isValidTime(startTime) ||
    !isValidTime(endTime) ||
    timeToMinutes(startTime) >= timeToMinutes(endTime) ||
    !intervalMinutes
  ) {
    res.status(400).json({ error: "Datos de horario invalidos." });
    return;
  }

  const professional = await db.get(
    "SELECT * FROM professionals WHERE business_id = ? AND id = ?",
    [business.id, professionalId],
  );
  if (!professional) {
    res.status(400).json({ error: "Profesional invalido." });
    return;
  }

  try {
    const result = await db.run(
      `
        INSERT INTO professional_schedules (
          business_id,
          professional_id,
          weekday,
          start_time,
          end_time,
          interval_minutes
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [business.id, professionalId, weekday, startTime, endTime, intervalMinutes],
    );
    const row = await db.get(
      `
        SELECT ps.*, p.name AS professional_name
        FROM professional_schedules ps
        JOIN professionals p ON p.id = ps.professional_id
          AND p.business_id = ps.business_id
        WHERE ps.id = ?
      `,
      result.lastID,
    );
    res.status(201).json(mapSchedule(row));
  } catch (error) {
    if (error && error.code === "SQLITE_CONSTRAINT") {
      res.status(409).json({ error: "Ya existe ese bloque horario." });
      return;
    }
    throw error;
  }
});

app.put("/api/businesses/:slug/admin/schedules/:id", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const id = parseRequiredPositiveInteger(req.params.id);
  const professionalId = parseRequiredPositiveInteger(req.body.professionalId ?? req.body.professional_id);
  const weekday = parseWeekdayNumber(req.body.weekday);
  const startTime = cleanText(req.body.startTime ?? req.body.start_time);
  const endTime = cleanText(req.body.endTime ?? req.body.end_time);
  const intervalMinutes = parseRequiredPositiveInteger(req.body.intervalMinutes ?? req.body.interval_minutes);

  if (
    !id ||
    !professionalId ||
    weekday === null ||
    !isValidTime(startTime) ||
    !isValidTime(endTime) ||
    timeToMinutes(startTime) >= timeToMinutes(endTime) ||
    !intervalMinutes
  ) {
    res.status(400).json({ error: "Datos de horario invalidos." });
    return;
  }

  const professional = await db.get(
    "SELECT * FROM professionals WHERE business_id = ? AND id = ?",
    [business.id, professionalId],
  );
  if (!professional) {
    res.status(400).json({ error: "Profesional invalido." });
    return;
  }

  try {
    const result = await db.run(
      `
        UPDATE professional_schedules
        SET professional_id = ?, weekday = ?, start_time = ?, end_time = ?, interval_minutes = ?
        WHERE business_id = ? AND id = ?
      `,
      [professionalId, weekday, startTime, endTime, intervalMinutes, business.id, id],
    );
    if (result.changes === 0) {
      res.status(404).json({ error: "Horario no encontrado." });
      return;
    }
    const row = await db.get(
      `
        SELECT ps.*, p.name AS professional_name
        FROM professional_schedules ps
        JOIN professionals p ON p.id = ps.professional_id
          AND p.business_id = ps.business_id
        WHERE ps.business_id = ? AND ps.id = ?
      `,
      [business.id, id],
    );
    res.json(mapSchedule(row));
  } catch (error) {
    if (error && error.code === "SQLITE_CONSTRAINT") {
      res.status(409).json({ error: "Ya existe ese bloque horario." });
      return;
    }
    throw error;
  }
});

app.delete("/api/businesses/:slug/admin/schedules/:id", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const id = parseRequiredPositiveInteger(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Id invalido." });
    return;
  }

  const result = await db.run(
    "DELETE FROM professional_schedules WHERE business_id = ? AND id = ?",
    [business.id, id],
  );

  if (result.changes === 0) {
    res.status(404).json({ error: "Horario no encontrado." });
    return;
  }

  res.status(204).end();
});

app.get("/api/businesses/:slug/admin/notifications", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const rows = await db.all(
    `
      SELECT
        id,
        type,
        channel,
        recipient,
        status,
        attempts,
        scheduled_for,
        sent_at,
        last_error,
        created_at,
        substr(message, 1, 80) AS message_preview,
        message
      FROM notifications
      WHERE business_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `,
    [business.id],
  );

  res.json({ notifications: rows });
});

console.log("[routes] GET /admin/test-whatsapp registered");
app.get("/admin/test-whatsapp", async (req, res) => {
  try {
    console.log("[admin/test-whatsapp] to=54354915558019");
    await sendWhatsApp({
      to: "54354915558019",
      template: "hello_world",
      language: "en_US",
      parameters: [],
    });
    res.json({ ok: true, message: "WhatsApp test sent" });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "No se pudo enviar WhatsApp de prueba.",
    });
  }
});

app.get("/api/businesses/:slug/admin/agenda", requireAdmin, async (req, res) => {
  const agenda = await getAgendaRows(req, res);
  if (!agenda) return;

  res.json(agenda.rows.map(mapReservation));
});

app.get("/api/businesses/:slug/admin/agenda/export.csv", requireAdmin, async (req, res) => {
  const agenda = await getAgendaRows(req, res);
  if (!agenda) return;

  const headers = ["Fecha", "Hora", "Servicio", "Profesional", "Cliente", "Telefono", "Estado", "Creado"];
  const lines = [
    headers.join(","),
    ...agenda.rows.map((row) => [
      row.date,
      row.time,
      row.service_name,
      row.professional_name,
      row.customer_name,
      row.customer_phone,
      row.status || "reservado",
      row.created_at,
    ].map(csvEscape).join(",")),
  ];

  res.type("text/csv").send(lines.join("\n"));
});

app.post("/api/businesses/:slug/admin/bookings/:id/confirm-payment", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const id = parseRequiredPositiveInteger(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Id invalido." });
    return;
  }

  const booking = await db.get(
    "SELECT * FROM reservations WHERE business_id = ? AND id = ?",
    [business.id, id],
  );
  if (!booking) {
    res.status(404).json({ error: "Reserva no encontrada." });
    return;
  }
  if (booking.deposit_status !== "pending") {
    res.status(400).json({ error: "Esta reserva no tiene seña pendiente." });
    return;
  }

  await db.run(
    "UPDATE reservations SET deposit_status = 'paid', status = 'confirmado' WHERE business_id = ? AND id = ?",
    [business.id, id],
  );
  const row = await db.get(
    "SELECT * FROM reservations WHERE business_id = ? AND id = ?",
    [business.id, id],
  );

  await enqueuePaymentConfirmedNotification(business, row, req);
  await enqueueBookingReminderNotification(business, row, req);
  res.json(mapReservation(row));
});

app.patch("/api/businesses/:slug/admin/reservations/:id/status", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const id = parseRequiredPositiveInteger(req.params.id);
  const status = parseStatus(req.body.status);
  if (!id || !status) {
    res.status(400).json({ error: "Estado invalido." });
    return;
  }

  const result = status === "cancelado"
    ? await db.run(
        "UPDATE reservations SET status = ?, cancelled_by = COALESCE(cancelled_by, 'admin') WHERE business_id = ? AND id = ?",
        [status, business.id, id],
      )
    : await db.run(
        "UPDATE reservations SET status = ? WHERE business_id = ? AND id = ?",
        [status, business.id, id],
      );

  if (result.changes === 0) {
    res.status(404).json({ error: "Reserva no encontrada." });
    return;
  }

  const row = await db.get(
    "SELECT * FROM reservations WHERE business_id = ? AND id = ?",
    [business.id, id],
  );
  if (status === "cancelado") {
    await enqueueBookingCancelledNotification(business, row, req);
  }
  res.json(mapReservation(row));
});

app.get("/api/businesses/:slug/reservations", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const rows = await db.all(`
    SELECT *
    FROM reservations
    WHERE business_id = ?
    ORDER BY date ASC, time ASC, professional_name ASC
  `, business.id);

  res.json(rows.map(mapReservation));
});

app.post("/api/businesses/:slug/reservations", async (req, res) => {
  const business = await getBusinessBySlug(req.params.slug);
  if (!business) {
    res.status(404).json({ error: "Negocio no encontrado." });
    return;
  }

  const serviceId = cleanText(req.body.serviceId);
  const service = serviceId
    ? await db.get(
        "SELECT * FROM services WHERE business_id = ? AND id = ?",
        [business.id, serviceId],
      )
    : null;
  const professionalId = parseOptionalPositiveInteger(req.body.professionalId);
  const reservation = {
    serviceId,
    serviceName: service?.name || "",
    professionalId: professionalId.value,
    date: cleanText(req.body.date || req.body.day),
    time: cleanText(req.body.time),
    customerName: cleanText(req.body.customerName),
    customerPhone: cleanText(req.body.customerPhone),
  };

  if (
    !reservation.serviceId ||
    !service ||
    !reservation.date ||
    !reservation.time ||
    !reservation.customerName ||
    !reservation.customerPhone
  ) {
    res.status(400).json({ error: "Faltan datos para crear la reserva." });
    return;
  }

  if (!professionalId.valid) {
    res.status(400).json({ error: "Profesional invalido." });
    return;
  }

  if (!isValidDate(reservation.date)) {
    res.status(400).json({ error: "Fecha invalida. Usa YYYY-MM-DD con una fecha real." });
    return;
  }

  if (!isValidTime(reservation.time)) {
    res.status(400).json({ error: "Horario invalido. Usa HH:MM entre 00:00 y 23:59." });
    return;
  }

  let transactionStarted = false;

  try {
    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    transactionStarted = true;

    if (
      reservation.professionalId &&
      !(await professionalHasSchedule(
        business.id,
        reservation.professionalId,
        reservation.date,
        reservation.time,
        service.duration_minutes,
      ))
    ) {
      await db.exec("ROLLBACK");
      transactionStarted = false;
      res.status(400).json({ error: "El profesional no atiende ese horario." });
      return;
    }

    const professional = await findAvailableProfessional(
      business.id,
      reservation.date,
      reservation.time,
      service.duration_minutes,
      reservation.professionalId,
    );

    if (!professional) {
      await db.exec("ROLLBACK");
      transactionStarted = false;
      res.status(409).json({ error: "Ese horario ya esta reservado." });
      return;
    }

    const requiresDeposit = Number(service.deposit_amount) > 0;
    const initialStatus = requiresDeposit ? "reservado" : "confirmado";
    const depositStatus = requiresDeposit ? "pending" : "none";
    const cancelToken = createCancelToken();
    const result = await db.run(
      `
        INSERT INTO reservations (
          business_id,
          service_id,
          service_name,
          professional_id,
          professional_name,
          date,
          time,
          duration_minutes,
          status,
          deposit_status,
          cancel_token,
          customer_name,
          customer_phone
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        business.id,
        reservation.serviceId,
        reservation.serviceName,
        professional.id,
        professional.name,
        reservation.date,
        reservation.time,
        service.duration_minutes,
        initialStatus,
        depositStatus,
        cancelToken,
        reservation.customerName,
        reservation.customerPhone,
      ],
    );

    const row = await db.get("SELECT * FROM reservations WHERE id = ?", result.lastID);
    await db.exec("COMMIT");
    transactionStarted = false;
    await enqueueBookingCreatedNotifications(business, row);
    res.status(201).json(mapReservation(row));
  } catch (error) {
    if (transactionStarted) {
      await db.exec("ROLLBACK");
    }

    if (error && error.code === "SQLITE_CONSTRAINT") {
      res.status(409).json({ error: "Ese horario ya esta reservado." });
      return;
    }

    res.status(500).json({ error: "No se pudo crear la reserva." });
  }
});

app.delete("/api/businesses/:slug/reservations/:id", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Id invalido." });
    return;
  }

  const booking = await db.get(
    "SELECT * FROM reservations WHERE business_id = ? AND id = ?",
    [business.id, id],
  );
  if (!booking) {
    res.status(404).json({ error: "Reserva no encontrada." });
    return;
  }

  const result = await db.run(
    "DELETE FROM reservations WHERE business_id = ? AND id = ?",
    [business.id, id],
  );
  if (result.changes === 0) {
    res.status(404).json({ error: "Reserva no encontrada." });
    return;
  }

  await enqueueBookingCancelledNotification(business, booking, req);
  res.status(204).end();
});

app.delete("/api/businesses/:slug/reservations", requireAdmin, async (req, res) => {
  const business = await getBusinessOr404(req, res);
  if (!business) return;

  await db.run("DELETE FROM reservations WHERE business_id = ?", business.id);
  res.status(204).end();
});

async function getBookingByCancelToken(slug, token) {
  const business = await getBusinessBySlug(slug);
  if (!business) return { business: null, booking: null };
  const booking = await db.get(
    "SELECT * FROM reservations WHERE business_id = ? AND cancel_token = ?",
    [business.id, cleanText(token)],
  );
  return { business, booking };
}

function renderCancelPage({ business, booking, type }) {
  const title = type === "success"
    ? "Turno cancelado"
    : type === "already"
      ? "Este turno ya estaba cancelado"
      : type === "invalid"
        ? "No encontramos este turno"
        : "Cancelar turno";
  const description = type === "success"
    ? "Listo, cancelamos tu turno correctamente."
    : type === "already"
      ? "No hace falta hacer nada mas."
      : type === "invalid"
        ? "El enlace puede estar vencido o mal copiado. Si tenes dudas, comunicate con el negocio."
        : "Revisa los datos antes de confirmar la cancelacion.";
  const details = booking
    ? `
        <div class="summary-box">
          <strong>${escapeHtml(booking.customer_name)}</strong>
          <span>${escapeHtml(booking.service_name)}</span>
          <span>${escapeHtml(formatDate(booking.date))} a las ${escapeHtml(booking.time)}</span>
        </div>
      `
    : "";
  const action = type === "confirm"
    ? `
        <form method="post">
          <button class="danger-button cancel-page-action" type="submit">Cancelar turno</button>
        </form>
      `
    : business
      ? `<a class="primary-button link-button cancel-page-action" href="/${escapeHtml(business.slug)}">Reservar otro turno</a>`
      : "";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)} - ${escapeHtml(business?.name || "Momentia")}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="app-shell cancel-page">
      <section class="success-screen">
        <p>${escapeHtml(business?.name || "Momentia")}</p>
        <h1>${escapeHtml(title)}</h1>
        <span>${escapeHtml(description)}</span>
        ${details}
        ${action}
      </section>
    </main>
  </body>
</html>`;
}

app.get("/:slug/cancelar/:token", async (req, res) => {
  const { business, booking } = await getBookingByCancelToken(req.params.slug, req.params.token);
  if (!business || !booking) {
    res.status(404).send(renderCancelPage({ business, booking, type: "invalid" }));
    return;
  }
  if (booking.status === "cancelado") {
    res.send(renderCancelPage({ business, booking, type: "already" }));
    return;
  }
  res.send(renderCancelPage({ business, booking, type: "confirm" }));
});

app.post("/:slug/cancelar/:token", async (req, res) => {
  const { business, booking } = await getBookingByCancelToken(req.params.slug, req.params.token);
  if (!business || !booking) {
    res.status(404).send(renderCancelPage({ business, booking, type: "invalid" }));
    return;
  }
  if (booking.status === "cancelado") {
    res.send(renderCancelPage({ business, booking, type: "already" }));
    return;
  }

  await db.run(
    "UPDATE reservations SET status = 'cancelado', cancelled_by = 'client' WHERE business_id = ? AND id = ?",
    [business.id, booking.id],
  );
  const cancelled = await db.get(
    "SELECT * FROM reservations WHERE business_id = ? AND id = ?",
    [business.id, booking.id],
  );
  await enqueueBookingCancelledNotification(business, cancelled, req);
  res.send(renderCancelPage({ business, booking: cancelled, type: "success" }));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/privacidad", (req, res) => {
  res.sendFile(path.join(__dirname, "privacidad.html"));
});

app.get("/terminos", (req, res) => {
  res.sendFile(path.join(__dirname, "terminos.html"));
});

app.get("/:slug/admin/notifications", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/:slug/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "public.html"));
});

initDb()
  .then(() => {
    startWorker();
    app.listen(PORT, () => {
      console.log(`Momentia listo en http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo iniciar la base de datos.", error);
    process.exit(1);
  });
