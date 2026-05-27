const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildProfessionalDaySummary,
  filterAgendaItems,
  sortAgendaByTime,
} = require("../agenda-utils");

const agenda = [
  {
    professionalId: 2,
    professionalName: "Clara Gomez",
    date: "2026-05-27",
    time: "10:00",
    customerName: "Laura Molina",
    serviceName: "Coloracion",
  },
  {
    professionalId: 2,
    professionalName: "Clara Gomez",
    date: "2026-05-27",
    time: "09:00",
    customerName: "Martin Lopez",
    serviceName: "Corte clasico",
  },
  {
    professionalId: 1,
    professionalName: "Ana Torres",
    date: "2026-05-28",
    time: "11:30",
    customerName: "Diego Fernandez",
    serviceName: "Corte + barba",
  },
];

test("resumen de agenda por profesional queda listo para WhatsApp", () => {
  const items = filterAgendaItems(agenda, { date: "2026-05-27", professionalId: 2 });
  const summary = buildProfessionalDaySummary("Clara Gomez", "Martes 27/05", items);

  assert.equal(summary, [
    "Turnos de Clara Gomez",
    "Martes 27/05",
    "",
    "09:00 - Martin Lopez",
    "Corte clasico",
    "",
    "10:00 - Laura Molina",
    "Coloracion",
    "",
    "-------------",
  ].join("\n"));
});

test("agenda se ordena por hora", () => {
  const sorted = sortAgendaByTime(agenda);

  assert.deepEqual(sorted.map((item) => item.time), ["09:00", "10:00", "11:30"]);
});

test("agenda filtra por fecha y profesional", () => {
  const filtered = filterAgendaItems(agenda, { date: "2026-05-27", professionalId: 2 });

  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((item) => item.date === "2026-05-27"));
  assert.ok(filtered.every((item) => item.professionalId === 2));
});
