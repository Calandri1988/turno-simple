const root = document.querySelector("#admin-root");
const logoutButton = document.querySelector("#logout-button");
const businessNameElement = document.querySelector("#business-name");
const businessMetaElement = document.querySelector("#business-meta");

const parts = window.location.pathname.split("/").filter(Boolean);
const BUSINESS_SLUG = parts[0] || "demo";
const BUSINESS_API_URL = `/api/businesses/${BUSINESS_SLUG}`;
const TOKEN_KEY = `turno-simple-admin-token-${BUSINESS_SLUG}`;

const weekdayLabels = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
const statusOptions = ["reservado", "confirmado", "cancelado", "asistio", "no_asistio"];
const services = [];
const professionals = [];
const schedules = [];
const agenda = [];
let token = localStorage.getItem(TOKEN_KEY) || "";
let businessName = "Turno Simple";
let filterDate = toIsoDate(new Date());

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLabel(value) {
  const date = parseIsoDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${weekdayLabels[date.getDay()]} ${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeReservation(item) {
  return {
    id: Number(item.id) || 0,
    serviceId: String(item.serviceId || ""),
    serviceName: String(item.serviceName || ""),
    professionalId: Number(item.professionalId) || 0,
    professionalName: String(item.professionalName || ""),
    date: String(item.date || ""),
    time: String(item.time || ""),
    status: String(item.status || "reservado"),
    customerName: String(item.customerName || ""),
    customerPhone: String(item.customerPhone || ""),
  };
}

function normalizeService(item) {
  return {
    id: String(item.id || ""),
    name: String(item.name || ""),
    durationMinutes: Number(item.durationMinutes) || 0,
    price: item.price === null || item.price === undefined ? "" : Number(item.price),
  };
}

function normalizeProfessional(item) {
  return {
    id: Number(item.id) || 0,
    name: String(item.name || ""),
  };
}

function normalizeSchedule(item) {
  return {
    id: Number(item.id) || 0,
    professionalId: Number(item.professionalId) || 0,
    professionalName: String(item.professionalName || ""),
    weekday: Number(item.weekday),
    startTime: String(item.startTime || ""),
    endTime: String(item.endTime || ""),
    intervalMinutes: Number(item.intervalMinutes) || 0,
  };
}

function headers(extra = {}) {
  return { ...extra, Authorization: `Bearer ${token}` };
}

function clearSession() {
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  logoutButton.hidden = true;
}

async function adminFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: headers(options.headers || {}),
  });
  if (response.status === 401 || response.status === 403) {
    clearSession();
    renderLogin();
    throw new Error("No autorizado.");
  }
  return response;
}

async function sendJson(url, method, body) {
  const response = await adminFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("No se pudo guardar.");
  return response.status === 204 ? null : response.json();
}

async function loadBusiness() {
  const response = await fetch(BUSINESS_API_URL);
  if (response.status === 404) {
    root.innerHTML = `<div class="admin-empty"><h2>Negocio no encontrado</h2><p>Revisa el enlace del panel.</p></div>`;
    return false;
  }
  const business = await response.json();
  businessName = business.name || "Turno Simple";
  businessNameElement.textContent = businessName;
  const meta = [business.category, business.city].filter(Boolean).join(" - ");
  businessMetaElement.textContent = meta;
  businessMetaElement.hidden = !meta;
  document.title = `${businessName} - Admin`;
  return true;
}

async function login(email, password) {
  const response = await fetch(`${BUSINESS_API_URL}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error("Login invalido.");
  const data = await response.json();
  token = data.token || "";
  localStorage.setItem(TOKEN_KEY, token);
}

async function loadAdminData() {
  const query = filterDate ? `?date=${encodeURIComponent(filterDate)}` : "";
  const [agendaResponse, reservationsResponse, servicesResponse, professionalsResponse, schedulesResponse] = await Promise.all([
    adminFetch(`${BUSINESS_API_URL}/admin/agenda${query}`),
    adminFetch(`${BUSINESS_API_URL}/reservations`),
    adminFetch(`${BUSINESS_API_URL}/admin/services`),
    adminFetch(`${BUSINESS_API_URL}/admin/professionals`),
    adminFetch(`${BUSINESS_API_URL}/admin/schedules`),
  ]);

  agenda.splice(0, agenda.length, ...(await agendaResponse.json()).map(normalizeReservation));
  services.splice(0, services.length, ...(await servicesResponse.json()).map(normalizeService));
  professionals.splice(0, professionals.length, ...(await professionalsResponse.json()).map(normalizeProfessional));
  schedules.splice(0, schedules.length, ...(await schedulesResponse.json()).map(normalizeSchedule));
  const reservations = (await reservationsResponse.json()).map(normalizeReservation);
  return reservations;
}

function normalizePhoneForWhatsapp(phone) {
  let digits = String(phone || "").replace(/[\s\-()+]/g, "");
  if (!/^\d+$/.test(digits)) return "";
  if (!digits.startsWith("54")) {
    if (digits.startsWith("0")) digits = digits.slice(1);
    if (digits.startsWith("15")) digits = digits.slice(2);
    digits = `54${digits}`;
  }
  return /^\d{8,15}$/.test(digits) ? digits : "";
}

function openWhatsapp(id) {
  const reservation = agenda.find((item) => item.id === Number(id));
  const phone = normalizePhoneForWhatsapp(reservation?.customerPhone);
  if (!reservation || !phone) {
    window.alert("Ese turno no tiene un telefono valido.");
    return;
  }
  const message = `Hola ${reservation.customerName}. Tu turno en ${businessName} esta reservado para el ${formatDateLabel(reservation.date)} a las ${reservation.time}. Servicio: ${reservation.serviceName}. Profesional: ${reservation.professionalName}. Si necesitas modificarlo o cancelarlo, comunicate con nosotros.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
}

function renderLogin() {
  logoutButton.hidden = true;
  root.innerHTML = `
    <section class="admin-login-card">
      <h2>Ingresar al admin</h2>
      <p>Gestiona turnos, servicios, profesionales y horarios.</p>
      <form id="login-form" class="wizard-form">
        <label><span>Email</span><input name="email" type="email" autocomplete="username" placeholder="admin@demo.com" required /></label>
        <label><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" placeholder="admin123" required /></label>
        <p class="form-error" id="login-error" hidden>Email o contraseña incorrectos.</p>
        <button class="primary-button" type="submit">Ingresar</button>
      </form>
    </section>
  `;
}

function statusSelect(reservation) {
  return `
    <select data-action="status" data-id="${reservation.id}">
      ${statusOptions.map((status) => `<option value="${status}" ${status === reservation.status ? "selected" : ""}>${status}</option>`).join("")}
    </select>
  `;
}

function renderAgendaList(items, emptyText) {
  if (items.length === 0) {
    return `<div class="admin-empty"><strong>${escapeHtml(emptyText)}</strong></div>`;
  }
  return items.map((reservation) => `
    <article class="agenda-row">
      <div>
        <strong>${escapeHtml(reservation.time)} - ${escapeHtml(reservation.customerName)}</strong>
        <span>${escapeHtml(reservation.serviceName)} con ${escapeHtml(reservation.professionalName)}</span>
        <small>${escapeHtml(formatDateLabel(reservation.date))} - ${escapeHtml(reservation.customerPhone)}</small>
      </div>
      ${statusSelect(reservation)}
      <button class="secondary-button" type="button" data-action="whatsapp" data-id="${reservation.id}">WhatsApp</button>
      <button class="danger-button" type="button" data-action="cancel-status" data-id="${reservation.id}">Cancelar</button>
    </article>
  `).join("");
}

function optionList(items, selected = "") {
  return items.map((item) => `<option value="${item.id}" ${Number(selected) === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
}

function renderServices() {
  return `
    <section class="admin-section">
      <h2>Servicios</h2>
      <form class="admin-form" data-form="service-create">
        <input name="id" placeholder="id-servicio" />
        <input name="name" placeholder="Nombre" required />
        <input name="durationMinutes" type="number" min="1" placeholder="Minutos" required />
        <input name="price" type="number" min="0" step="0.01" placeholder="Precio" />
        <button class="primary-button" type="submit">Crear</button>
      </form>
      ${services.map((service) => `
        <form class="admin-inline-form" data-form="service-update" data-id="${escapeHtml(service.id)}">
          <strong>${escapeHtml(service.id)}</strong>
          <input name="name" value="${escapeHtml(service.name)}" />
          <input name="durationMinutes" type="number" min="1" value="${service.durationMinutes}" />
          <input name="price" type="number" min="0" step="0.01" value="${service.price === "" ? "" : escapeHtml(service.price)}" />
          <button class="secondary-button" type="submit">Guardar</button>
          <button class="danger-button" type="button" data-action="delete-service" data-id="${escapeHtml(service.id)}">Eliminar</button>
        </form>
      `).join("")}
    </section>
  `;
}

function renderProfessionals() {
  return `
    <section class="admin-section">
      <h2>Profesionales</h2>
      <form class="admin-form" data-form="professional-create">
        <input name="name" placeholder="Nombre" required />
        <button class="primary-button" type="submit">Crear</button>
      </form>
      ${professionals.map((professional) => `
        <form class="admin-inline-form" data-form="professional-update" data-id="${professional.id}">
          <input name="name" value="${escapeHtml(professional.name)}" />
          <button class="secondary-button" type="submit">Guardar</button>
          <button class="danger-button" type="button" data-action="delete-professional" data-id="${professional.id}">Eliminar</button>
        </form>
      `).join("")}
    </section>
  `;
}

function renderSchedules() {
  return `
    <section class="admin-section">
      <h2>Horarios semanales</h2>
      <form class="admin-form" data-form="schedule-create">
        <select name="professionalId">${optionList(professionals)}</select>
        <select name="weekday">${weekdayLabels.map((label, index) => `<option value="${index}">${label}</option>`).join("")}</select>
        <input name="startTime" placeholder="09:00" required />
        <input name="endTime" placeholder="17:00" required />
        <input name="intervalMinutes" type="number" min="1" placeholder="Intervalo" required />
        <button class="primary-button" type="submit">Crear</button>
      </form>
      ${schedules.map((schedule) => `
        <form class="admin-inline-form" data-form="schedule-update" data-id="${schedule.id}">
          <select name="professionalId">${optionList(professionals, schedule.professionalId)}</select>
          <select name="weekday">${weekdayLabels.map((label, index) => `<option value="${index}" ${index === schedule.weekday ? "selected" : ""}>${label}</option>`).join("")}</select>
          <input name="startTime" value="${escapeHtml(schedule.startTime)}" />
          <input name="endTime" value="${escapeHtml(schedule.endTime)}" />
          <input name="intervalMinutes" type="number" min="1" value="${schedule.intervalMinutes}" />
          <button class="secondary-button" type="submit">Guardar</button>
          <button class="danger-button" type="button" data-action="delete-schedule" data-id="${schedule.id}">Eliminar</button>
        </form>
      `).join("")}
    </section>
  `;
}

async function renderAdmin() {
  const reservations = await loadAdminData();
  logoutButton.hidden = false;
  const upcoming = reservations.filter((item) => item.date >= toIsoDate(new Date())).slice(0, 8);
  root.innerHTML = `
    <section class="admin-section">
      <div class="admin-section-header">
        <div>
          <h2>Turnos de hoy</h2>
          <p>Agenda operativa del dia.</p>
        </div>
        <form id="filter-form" class="admin-filter">
          <input name="date" type="date" value="${escapeHtml(filterDate)}" />
          <button class="secondary-button" type="submit">Buscar</button>
        </form>
      </div>
      <div class="agenda-list">${renderAgendaList(agenda, "No hay turnos para esta fecha.")}</div>
    </section>
    <section class="admin-section">
      <h2>Proximos turnos</h2>
      <div class="agenda-list">${renderAgendaList(upcoming, "No hay proximos turnos.")}</div>
    </section>
    ${renderServices()}
    ${renderProfessionals()}
    ${renderSchedules()}
  `;
}

async function refresh() {
  try {
    await renderAdmin();
  } catch (error) {
    if (token) root.innerHTML = `<div class="admin-empty"><strong>No pudimos cargar el panel.</strong></div>`;
  }
}

root.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    if (form.id === "login-form") {
      await login(data.email, data.password);
      await refresh();
      return;
    }
    if (form.id === "filter-form") {
      filterDate = data.date || "";
      await refresh();
      return;
    }
    if (form.dataset.form === "service-create") await sendJson(`${BUSINESS_API_URL}/admin/services`, "POST", data);
    if (form.dataset.form === "service-update") await sendJson(`${BUSINESS_API_URL}/admin/services/${form.dataset.id}`, "PUT", data);
    if (form.dataset.form === "professional-create") await sendJson(`${BUSINESS_API_URL}/admin/professionals`, "POST", data);
    if (form.dataset.form === "professional-update") await sendJson(`${BUSINESS_API_URL}/admin/professionals/${form.dataset.id}`, "PUT", data);
    if (form.dataset.form === "schedule-create") await sendJson(`${BUSINESS_API_URL}/admin/schedules`, "POST", data);
    if (form.dataset.form === "schedule-update") await sendJson(`${BUSINESS_API_URL}/admin/schedules/${form.dataset.id}`, "PUT", data);
    await refresh();
  } catch (error) {
    const errorElement = form.querySelector(".form-error");
    if (errorElement) errorElement.hidden = false;
    else window.alert("No pudimos guardar el cambio.");
  }
});

root.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-action='status']");
  if (!select) return;
  await sendJson(`${BUSINESS_API_URL}/admin/reservations/${select.dataset.id}/status`, "PATCH", { status: select.value });
  await refresh();
});

root.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === "whatsapp") {
    openWhatsapp(id);
    return;
  }
  if (action === "cancel-status") {
    await sendJson(`${BUSINESS_API_URL}/admin/reservations/${id}/status`, "PATCH", { status: "cancelado" });
    await refresh();
    return;
  }

  const destructiveActions = new Set(["delete-service", "delete-professional", "delete-schedule"]);
  if (!destructiveActions.has(action)) {
    return;
  }

  if (!window.confirm("Confirmas eliminar este elemento?")) return;
  if (action === "delete-service") await adminFetch(`${BUSINESS_API_URL}/admin/services/${id}`, { method: "DELETE" });
  if (action === "delete-professional") await adminFetch(`${BUSINESS_API_URL}/admin/professionals/${id}`, { method: "DELETE" });
  if (action === "delete-schedule") await adminFetch(`${BUSINESS_API_URL}/admin/schedules/${id}`, { method: "DELETE" });
  await refresh();
});

logoutButton.addEventListener("click", () => {
  clearSession();
  renderLogin();
});

async function init() {
  const exists = await loadBusiness();
  if (!exists) return;
  if (!token) renderLogin();
  else await refresh();
}

init();
