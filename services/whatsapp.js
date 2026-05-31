const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_GRAPH_VERSION = "v25.0";
const DEFAULT_TEMPLATE_LANGUAGE = "es_AR";
const { normalizePhone } = require("../whatsapp");

function getGraphVersion() {
  return process.env.WHATSAPP_API_VERSION || DEFAULT_GRAPH_VERSION;
}

function normalizeMetaPhone(phone) {
  const result = normalizePhone(phone);
  if (result.ok) {
    console.log(`[whatsapp] phone normalize original=${result.original} normalized=${result.normalized} meta=${result.meta}`);
    return result.meta;
  }

  console.warn(`[whatsapp] phone normalize failed original=${phone} error=${result.error}`);
  return "";
}

function maskPhone(phone) {
  const normalized = String(phone ?? "").replace(/[^0-9]/g, "");
  if (normalized.length <= 5) {
    return "***";
  }
  return `***${normalized.slice(-5)}`;
}

function buildWhatsAppTemplateBody({
  to,
  template,
  language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || DEFAULT_TEMPLATE_LANGUAGE,
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
  language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || DEFAULT_TEMPLATE_LANGUAGE,
  parameters = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
}) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId) {
    console.warn("[whatsapp] skipped: missing WHATSAPP_PHONE_NUMBER_ID");
    throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
  }
  if (!accessToken) {
    console.warn("[whatsapp] skipped: missing WHATSAPP_ACCESS_TOKEN");
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
  const url = `https://graph.facebook.com/${getGraphVersion()}/${phoneNumberId}/messages`;

  try {
    console.log(`[whatsapp] sending template ${template} to ${maskPhone(normalizedPhone)}`);
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

    console.log("[whatsapp] Meta response", {
      status: response.status,
      template,
      to: maskPhone(normalizedPhone),
      messageId: data.messages?.[0]?.id,
    });
    console.log(`[whatsapp] sent ok message_id=${data.messages?.[0]?.id || "unknown"}`);
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
  getGraphVersion,
  maskPhone,
  normalizeMetaPhone,
  sendWhatsApp,
};
