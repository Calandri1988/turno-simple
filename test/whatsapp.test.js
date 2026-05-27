const assert = require("node:assert/strict");
const test = require("node:test");
const { buildWhatsappLink, normalizeArgentinaWhatsapp } = require("../whatsapp");

const cases = [
  ["3549504056", "5493549504056"],
  ["03549504056", "5493549504056"],
  ["0354915504056", "5493549504056"],
  ["354915504056", "5493549504056"],
  ["+54 9 3549 504056", "5493549504056"],
  ["5493549504056", "5493549504056"],
];

for (const [input, expected] of cases) {
  test(`${input} normaliza a ${expected}`, () => {
    assert.equal(normalizeArgentinaWhatsapp(input, "3549"), expected);
  });
}

test("genera link wa.me con numero normalizado", () => {
  assert.equal(buildWhatsappLink("0354915504056", "", "3549"), "https://wa.me/5493549504056");
});
