const GRAPH_VERSION = "v25.0";
const DEFAULT_TIMEOUT_MS = 10000;

function normalizeMetaPhone(phone) {
  return String(phone ?? "").replace(/[^0-9]/g, "");
}

function buildWhatsAppTemplateBody({
  to,
  template,
  language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "es",
  parameters = [],
}) {
  const normalizedPhone = normalizeMetaPhone(to);

  if (!normalizedPhone) {
    throw new Error("WhatsApp destination phone is required");
  }
  if (!template) {
    throw new Error("WhatsApp template is required");
  }

  const body = {
    messaging_product: "whatsapp",
    to: normalizedPhone,
    type: "template",
    template: {
      name: template,
      language: {
        code: language,
      },
    },
  };

  if (parameters.length > 0) {
    body.template.components = [
      {
        type: "body",
        parameters: parameters.map((value) => ({
          type: "text",
          text: String(value ?? ""),
        })),
      },
    ];
  }

  return { body, normalizedPhone };
}

async function sendWhatsApp({
  to,
  template,
  language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "es",
  parameters = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
}) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
  }
  if (!accessToken) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available to send WhatsApp messages");
  }

  const { body, normalizedPhone } = buildWhatsAppTemplateBody({
    to,
    template,
    language,
    parameters,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const metaError = data.error || {};
      console.error("[whatsapp] Meta error", {
        status: response.status,
        code: metaError.code,
        message: metaError.message,
        template,
        to: normalizedPhone,
      });
      throw new Error(metaError.message || `WhatsApp API error ${response.status}`);
    }

    console.log(`[whatsapp] Template sent: template=${template} | to=${normalizedPhone}`);
    return {
      ok: true,
      data,
      to: normalizedPhone,
      template,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      console.error("[whatsapp] Request timed out", { template, to: normalizedPhone });
      throw new Error("WhatsApp API request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  buildWhatsAppTemplateBody,
  normalizeMetaPhone,
  sendWhatsApp,
};
