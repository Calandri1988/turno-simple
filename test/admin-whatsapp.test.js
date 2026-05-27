const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { buildWhatsappLink, normalizeArgentinaWhatsapp } = require("../whatsapp");

function jsonResponse(data) {
  return {
    status: 200,
    ok: true,
    json: async () => data,
  };
}

test("admin genera link WhatsApp para cliente nacional aunque no este en agenda filtrada", async () => {
  const openedLinks = [];
  const alerts = [];
  const root = { addEventListener() {}, innerHTML: "" };
  const element = { addEventListener() {}, textContent: "", hidden: false };

  const context = {
    console,
    buildWhatsappLink,
    normalizeArgentinaWhatsapp,
    document: {
      querySelector(selector) {
        return selector === "#admin-root" ? root : element;
      },
    },
    window: {
      location: { pathname: "/demo/admin" },
      alert(message) {
        alerts.push(message);
      },
      confirm() {
        return true;
      },
      open(link) {
        openedLinks.push(link);
      },
    },
    localStorage: {
      getItem() {
        return "";
      },
      setItem() {},
      removeItem() {},
    },
    fetch: async (url) => {
      if (url === "/api/businesses/demo") {
        return jsonResponse({ name: "Barberia Central", slug: "demo" });
      }
      if (url.includes("/admin/agenda")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/reservations")) {
        return jsonResponse([
          {
            id: 99,
            serviceName: "Corte",
            professionalName: "Ana Torres",
            date: "2026-05-28",
            time: "10:00",
            customerName: "Cliente Test",
            customerPhone: "3549504056",
          },
        ]);
      }
      return jsonResponse([]);
    },
  };
  context.globalThis = context;
  vm.createContext(context);

  const adminCode = fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8");
  vm.runInContext(adminCode, context);

  await context.loadAdminData();
  context.openWhatsapp(99);

  assert.equal(alerts.length, 0);
  assert.equal(openedLinks.length, 1);
  assert.match(openedLinks[0], /^https:\/\/wa\.me\/5493549504056\?text=/);
});
