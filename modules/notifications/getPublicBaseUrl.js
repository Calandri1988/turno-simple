function getPublicBaseUrl(req) {
  const fromEnv =
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL;

  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    console.error("[notifications] ERROR: PUBLIC_BASE_URL missing in production");
  }

  if (req) {
    return `${req.protocol}://${req.get("host")}`;
  }

  if (process.env.NODE_ENV === "production") {
    return "";
  }

  console.warn(
    "[notifications] WARNING: PUBLIC_BASE_URL no configurada y no se recibió req. Usando localhost.",
  );

  return "http://localhost:8080";
}

module.exports = { getPublicBaseUrl };
