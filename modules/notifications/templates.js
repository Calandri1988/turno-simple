const fs = require("fs");
const path = require("path");

const TEMPLATES_DIR = path.join(__dirname, "templates");

function loadTemplate(type) {
  const filePath = path.join(TEMPLATES_DIR, `${type}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Template not found: ${type}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function renderTemplate(type, variables = {}) {
  const template = loadTemplate(type);
  let message = template.message;

  for (const [key, value] of Object.entries(variables)) {
    message = message.replaceAll(`{{${key}}}`, value ?? "");
  }

  return {
    channel: template.channel,
    message,
  };
}

module.exports = {
  renderTemplate,
};
