const assert = require("node:assert/strict");
const test = require("node:test");
const { buildWhatsappLink, normalizeArgentinaWhatsapp, normalizePhone } = require("../whatsapp");

const cases = [
  ["3549432877", "5493549432877"],
  ["3549-432877", "5493549432877"],
  ["+54 9 3549 432877", "5493549432877"],
  ["5493549432877", "5493549432877"],
  ["543549432877", "5493549432877"],
  ["0354915504056", "5493549504056"],
  ["354915504056", "5493549504056"],
];

for (const [input, expected] of cases) {
  test(`${input} normaliza a ${expected}`, () => {
    assert.equal(normalizeArgentinaWhatsapp(input, "3549"), expected);
  });
}

test("genera link wa.me con numero normalizado", () => {
  assert.equal(buildWhatsappLink("0354915504056", "", "3549"), "https://wa.me/5493549504056");
});

test("rechaza numero local ambiguo con 15 sin codigo de area", () => {
  const result = normalizePhone("15-432877");

  assert.equal(result.ok, false);
  assert.equal(result.normalized, null);
  assert.equal(result.meta, null);
  assert.equal(result.error, "missing_area_code");
});

test("meta usa formato sin 9 cuando WHATSAPP_USE_ARGENTINA_TEST_FORMAT=true", () => {
  process.env.WHATSAPP_USE_ARGENTINA_TEST_FORMAT = "true";

  const result = normalizePhone("3549432877");

  assert.equal(result.ok, true);
  assert.equal(result.normalized, "5493549432877");
  assert.equal(result.meta, "543549432877");
  delete process.env.WHATSAPP_USE_ARGENTINA_TEST_FORMAT;
});

test("meta puede forzar formato de prueba argentino por llamada", () => {
  process.env.WHATSAPP_USE_ARGENTINA_TEST_FORMAT = "false";

  const result = normalizePhone("54354915558019", { useArgentinaTestFormat: true });

  assert.equal(result.ok, true);
  assert.equal(result.normalized, "5493549558019");
  assert.equal(result.meta, "543549558019");
  delete process.env.WHATSAPP_USE_ARGENTINA_TEST_FORMAT;
});

test("meta usa formato interno cuando WHATSAPP_USE_ARGENTINA_TEST_FORMAT=false", () => {
  process.env.WHATSAPP_USE_ARGENTINA_TEST_FORMAT = "false";

  const result = normalizePhone("3549432877");

  assert.equal(result.ok, true);
  assert.equal(result.normalized, "5493549432877");
  assert.equal(result.meta, "5493549432877");
  delete process.env.WHATSAPP_USE_ARGENTINA_TEST_FORMAT;
});
