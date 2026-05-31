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

  function removeMobilePrefixAfterAreaCode(national) {
    for (const areaLength of [4, 3, 2]) {
      const area = national.slice(0, areaLength);
      const rest = national.slice(areaLength);
      if (/^\d+$/.test(area) && rest.startsWith("15") && rest.length >= 8) {
        return `${area}${rest.slice(2)}`;
      }
    }
    return national;
  }

  function toMetaPhone(normalized, options = {}) {
    const useArgentinaTestFormat = options.useArgentinaTestFormat ?? root?.process?.env?.WHATSAPP_USE_ARGENTINA_TEST_FORMAT === "true";
    if (useArgentinaTestFormat && normalized.startsWith("549")) {
      return `54${normalized.slice(3)}`;
    }
    return normalized;
  }

  function normalizePhone(phone, options = {}) {
    const original = String(phone ?? "");
    let digits = stripInternationalNoise(onlyDigits(original));
    const fail = (error) => ({
      ok: false,
      original,
      normalized: null,
      meta: null,
      error,
    });

    if (!digits) return fail("empty");

    let national;
    if (digits.startsWith("549")) {
      national = digits.slice(3);
    } else if (digits.startsWith("54")) {
      national = digits.slice(2);
      if (national.startsWith("9")) national = national.slice(1);
    } else {
      national = digits.replace(/^0+/, "");
    }

    national = national.replace(/^0+/, "");
    if (national.startsWith("15")) {
      console.warn(`[phone] rejected ambiguous local mobile number: original=${original} reason=missing_area_code`);
      return fail("missing_area_code");
    }

    national = removeMobilePrefixAfterAreaCode(national);
    const normalized = `549${national}`;

    if (!/^549\d{8,12}$/.test(normalized)) return fail("invalid_phone");
    return {
      ok: true,
      original,
      normalized,
      meta: toMetaPhone(normalized, options),
      error: null,
    };
  }

  function normalizeArgentinaWhatsapp(phone) {
    const result = normalizePhone(phone);
    return result.ok ? result.normalized : "";
  }

  function buildWhatsappLink(phone, message = "") {
    const normalized = normalizeArgentinaWhatsapp(phone);
    if (!normalized) return "";
    const text = message ? `?text=${encodeURIComponent(message)}` : "";
    return `https://wa.me/${normalized}${text}`;
  }

  root.normalizePhone = normalizePhone;
  root.normalizeArgentinaWhatsapp = normalizeArgentinaWhatsapp;
  root.buildWhatsappLink = buildWhatsappLink;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalizePhone, normalizeArgentinaWhatsapp, buildWhatsappLink };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
