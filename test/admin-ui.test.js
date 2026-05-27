const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  buildProfessionalDaySummary,
  groupAgendaByProfessional,
  sortAgendaByTime,
} = require("../agenda-utils");
const { buildWhatsappLink, normalizeArgentinaWhatsapp } = require("../whatsapp");

function response(data, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => data,
  };
}

function createAdminContext(fetchImpl) {
  const listeners = {};
  const root = {
    innerHTML: "",
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    querySelector() {
      return { innerHTML: "", textContent: "", hidden: false, value: "" };
    },
  };
  const element = { addEventListener() {}, textContent: "", hidden: false };
  const alerts = [];
  const confirms = [];

  const context = {
    console,
    URLSearchParams,
    buildProfessionalDaySummary,
    buildWhatsappLink,
    groupAgendaByProfessional,
    normalizeArgentinaWhatsapp,
    sortAgendaByTime,
    document: {
      querySelector(selector) {
        return selector === "#admin-root" ? root : element;
      },
      createElement() {
        return {
          style: {},
          setAttribute() {},
          select() {},
          remove() {},
        };
      },
      body: {
        appendChild() {},
      },
      execCommand() {
        return true;
      },
    },
    window: {
      location: { pathname: "/demo/admin" },
      alert(message) {
        alerts.push(message);
      },
      confirm(message) {
        confirms.push(message);
        return true;
      },
      open() {},
    },
    navigator: {
      clipboard: {
        writeText: async () => {},
      },
    },
    localStorage: {
      getItem() {
        return "";
      },
      setItem() {},
      removeItem() {},
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    fetch: fetchImpl,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8"), context);
  return { alerts, confirms, context, listeners };
}

function defaultAdminResponse(url) {
  if (url === "/api/businesses/demo") return response({ name: "Demo", slug: "demo" });
  if (url.includes("/admin/agenda")) return response([]);
  if (url.endsWith("/reservations")) return response([]);
  if (url.includes("/admin/services")) return response([]);
  if (url.includes("/admin/professionals")) return response([]);
  if (url.includes("/admin/schedules")) return response([]);
  return response({});
}

test("refresh manual de reservas mantiene filtros actuales", async () => {
  const urls = [];
  const { context } = createAdminContext(async (url) => {
    urls.push(String(url));
    return defaultAdminResponse(String(url));
  });

  await vm.runInContext(`
    filterDate = "2026-06-01";
    filterProfessionalId = "2";
    refreshReservationsOnly({ showNewNotice: true });
  `, context);

  assert.ok(urls.some((url) => url.includes("/admin/agenda?date=2026-06-01&professional_id=2")));
});

test("polling conserva filtros al pedir agenda", async () => {
  const urls = [];
  const { context } = createAdminContext(async (url) => {
    urls.push(String(url));
    return defaultAdminResponse(String(url));
  });

  await vm.runInContext(`
    filterDate = "2026-06-02";
    filterProfessionalId = "1";
    loadReservationData();
  `, context);

  assert.ok(urls.some((url) => url.includes("/admin/agenda?date=2026-06-02&professional_id=1")));
});

test("admin elimina servicio, profesional y horario desde sus botones", async () => {
  const deleted = [];
  const { alerts, confirms, listeners } = createAdminContext(async (url, options = {}) => {
    if (options.method === "DELETE") {
      deleted.push(String(url));
      return response(null, 204);
    }
    return defaultAdminResponse(String(url));
  });

  for (const [action, id] of [["delete-service", "corte"], ["delete-professional", "7"], ["delete-schedule", "11"]]) {
    await listeners.click({
      target: {
        closest() {
          return { dataset: { action, id } };
        },
      },
    });
  }

  assert.deepEqual(confirms, ["¿Eliminar este servicio?", "¿Eliminar este profesional?", "¿Eliminar este horario?"]);
  assert.ok(deleted.includes("/api/businesses/demo/admin/services/corte"));
  assert.ok(deleted.includes("/api/businesses/demo/admin/professionals/7"));
  assert.ok(deleted.includes("/api/businesses/demo/admin/schedules/11"));
  assert.equal(alerts.filter((message) => message === "Eliminado").length, 3);
});

test("admin muestra error claro si un servicio tiene turnos asociados", async () => {
  const { alerts, listeners } = createAdminContext(async (url, options = {}) => {
    if (options.method === "DELETE") {
      return response({ error: "No se puede borrar un servicio con reservas." }, 409);
    }
    return defaultAdminResponse(String(url));
  });

  await listeners.click({
    target: {
      closest() {
        return { dataset: { action: "delete-service", id: "corte" } };
      },
    },
  });

  assert.ok(alerts.includes("No se puede eliminar porque tiene turnos asociados. Podés ocultarlo o desactivarlo."));
});
