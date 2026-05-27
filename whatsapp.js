(function initWhatsappHelper(root) {
  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function stripInternationalNoise(digits) {
    let value = digits;
    while (value.startsWith("00")) value = value.slice(2);
    while (value.startsWith("549549")) value = `549${value.slice(6)}`;
    while (value.startsWith("54549")) value = `549${value.slice(5)}`;
    while (value.startsWith("54954")) value = `549${value.slice(5)}`;
    return value;
  }

  function cleanNationalNumber(value, defaultAreaCode) {
    let national = value.replace(/^0+/, "");
    if (national.startsWith(`${defaultAreaCode}15`)) {
      national = `${defaultAreaCode}${national.slice(defaultAreaCode.length + 2)}`;
    }
    if (national.startsWith("15")) {
      national = national.slice(2);
    }
    if (national.length <= 8 && defaultAreaCode) {
      national = `${defaultAreaCode}${national}`;
    }
    return national;
  }

  function normalizeArgentinaWhatsapp(phone, defaultAreaCode = "3549") {
    let digits = stripInternationalNoise(onlyDigits(phone));
    const areaCode = onlyDigits(defaultAreaCode);

    if (!digits) return "";

    let national = "";
    if (digits.startsWith("549")) {
      national = digits.slice(3);
    } else if (digits.startsWith("54")) {
      national = digits.slice(2);
      if (national.startsWith("9")) national = national.slice(1);
    } else {
      national = digits;
    }

    national = cleanNationalNumber(national, areaCode);
    const normalized = `549${national}`;

    if (!/^549\d{8,12}$/.test(normalized)) return "";
    return normalized;
  }

  function buildWhatsappLink(phone, message = "", defaultAreaCode = "3549") {
    const normalized = normalizeArgentinaWhatsapp(phone, defaultAreaCode);
    if (!normalized) return "";
    const text = message ? `?text=${encodeURIComponent(message)}` : "";
    return `https://wa.me/${normalized}${text}`;
  }

  root.normalizeArgentinaWhatsapp = normalizeArgentinaWhatsapp;
  root.buildWhatsappLink = buildWhatsappLink;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalizeArgentinaWhatsapp, buildWhatsappLink };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
