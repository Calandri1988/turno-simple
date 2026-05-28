const root = document.querySelector("#admin-root");
const logoutButton = document.querySelector("#logout-button");
const businessNameElement = document.querySelector("#business-name");
const businessMetaElement = document.querySelector("#business-meta");
const adminHomeLink = document.querySelector("#admin-home-link");
const adminNotificationsLink = document.querySelector("#admin-notifications-link");

const parts = window.location.pathname.split("/").filter(Boolean);
const BUSINESS_SLUG = parts[0] || "demo";
const BUSINESS_API_URL = `/api/businesses/${BUSINESS_SLUG}`;
const TOKEN_KEY = `turno-simple-admin-token-${BUSINESS_SLUG}`;
const isNotificationsPage = parts[1] === "admin" && parts[2] === "notifications";

const weekdayLabels = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
const statusOptions = ["pendiente", "reservado", "confirmado", "cancelado", "asistio", "no_asistio"];
const services = [];
const professionals = [];
const schedules = [];
const agenda = [];
const allReservations = [];
let token = localStorage.getItem(TOKEN_KEY) || "";
let businessName = "Turno Simple";
let businessDetails = {
  whatsapp: "",
  address: "",
  paymentAlias: "",
};
let filterDate = toIsoDate(new Date());
let filterProfessionalId = "";
let pollingId = null;
let lastUpdatedAt = null;
let knownReservationIds = new Set();

if (adminHomeLink) adminHomeLink.href = `/${BUSINESS_SLUG}/admin`;
if (adminNotificationsLink) adminNotificationsLink.href = `/${BUSINESS_SLUG}/admin/notifications`;

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
    depositStatus: String(item.depositStatus || "none"),
    cancelledBy: String(item.cancelledBy || ""),
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
    requiresDeposit: Boolean(item.requiresDeposit),
    depositAmount: Number(item.depositAmount) || 0,
    paymentInstructions: String(item.paymentInstructions || ""),
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

function normalizeBusiness(item) {
  return {
    name: String(item.name || ""),
    category: String(item.category || ""),
    city: String(item.city || ""),
    whatsapp: String(item.whatsapp || item.phone || ""),
    address: String(item.address || ""),
    paymentAlias: String(item.paymentAlias || item.payment_alias || ""),
  };
}

function headers(extra = {}) {
  return { ...extra, Authorization: `Bearer ${token}` };
}

function clearSession() {
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  logoutButton.hidden = true;
  if (pollingId) {
    clearInterval(pollingId);
    pollingId = null;
  }
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

async function readErrorMessage(response) {
  try {
    const data = await response.json();
    return data.error || "No pudimos completar la accion.";
  } catch (error) {
    return "No pudimos completar la accion.";
  }
}

async function loadBusiness() {
  const response = await fetch(BUSINESS_API_URL);
  if (response.status === 404) {
    root.innerHTML = `<div class="admin-empty"><h2>Negocio no encontrado</h2><p>Revisa el enlace del panel.</p></div>`;
    return false;
  }
  const business = await response.json();
  const normalized = normalizeBusiness(business);
  businessName = normalized.name || "Turno Simple";
  businessDetails = normalized;
  businessNameElement.textContent = businessName;
  const meta = [normalized.category, normalized.city, normalized.address].filter(Boolean).join(" - ");
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
  const [reservations, servicesResponse, professionalsResponse, schedulesResponse] = await Promise.all([
    loadReservationData(),
    adminFetch(`${BUSINESS_API_URL}/admin/services`),
    adminFetch(`${BUSINESS_API_URL}/admin/professionals`),
    adminFetch(`${BUSINESS_API_URL}/admin/schedules`),
  ]);

  services.splice(0, services.length, ...(await servicesResponse.json()).map(normalizeService));
  professionals.splice(0, professionals.length, ...(await professionalsResponse.json()).map(normalizeProfessional));
  schedules.splice(0, schedules.length, ...(await schedulesResponse.json()).map(normalizeSchedule));
  return reservations;
}

function agendaQueryString() {
  const params = new URLSearchParams();
  if (filterDate) params.set("date", filterDate);
  if (filterProfessionalId) params.set("professional_id", filterProfessionalId);
  return params.toString() ? `?${params.toString()}` : "";
}

async function loadReservationData() {
  const [agendaResponse, reservationsResponse] = await Promise.all([
    adminFetch(`${BUSINESS_API_URL}/admin/agenda${agendaQueryString()}`),
    adminFetch(`${BUSINESS_API_URL}/reservations`),
  ]);
  agenda.splice(0, agenda.length, ...(await agendaResponse.json()).map(normalizeReservation));
  const reservations = (await reservationsResponse.json()).map(normalizeReservation);
  allReservations.splice(0, allReservations.length, ...reservations);
  lastUpdatedAt = new Date();
  return reservations;
}

function updateFreshnessText() {
  const element = root.querySelector("[data-last-updated]");
  if (!element || !lastUpdatedAt) return;
  const seconds = Math.max(0, Math.round((Date.now() - lastUpdatedAt.getTime()) / 1000));
  element.textContent = `Actualizado hace ${seconds} segundos`;
}

function renderAgendaSections() {
  const todayList = root.querySelector("[data-agenda-list='today']");
  const copyTools = root.querySelector("[data-copy-tools-slot]");
  const upcomingList = root.querySelector("[data-agenda-list='upcoming']");
  const upcoming = allReservations.filter((item) => item.date >= toIsoDate(new Date())).slice(0, 8);
  if (copyTools) copyTools.innerHTML = renderCopyTools(agenda);
  if (todayList) todayList.innerHTML = renderAgendaList(agenda, "No hay turnos para esta fecha.");
  if (upcomingList) upcomingList.innerHTML = renderAgendaList(upcoming, "No hay proximos turnos.");
  updateFreshnessText();
}

async function refreshReservationsOnly({ showNewNotice = false } = {}) {
  const before = new Set(knownReservationIds);
  await loadReservationData();
  const after = new Set(allReservations.map((item) => item.id));
  const hasNewReservations = [...after].some((id) => !before.has(id));
  knownReservationIds = after;
  renderAgendaSections();
  const notice = root.querySelector("[data-admin-notice]");
  if (notice && showNewNotice) {
    notice.textContent = hasNewReservations ? "Hay nuevos turnos" : "Turnos actualizados";
    notice.hidden = false;
  }
}

function startPolling() {
  if (pollingId) clearInterval(pollingId);
  pollingId = setInterval(() => {
    if (!token) return;
    refreshReservationsOnly({ showNewNotice: true }).catch(() => {});
  }, 30000);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      // Sigue con el fallback para navegadores que bloquean clipboard en ciertos contextos.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("No se pudo copiar.");
}

async function copyProfessionalDay(professionalId) {
  const id = Number(professionalId);
  const items = sortAgendaByTime(agenda.filter((item) => Number(item.professionalId) === id));
  const professional = professionals.find((item) => item.id === id);
  const professionalName = professional?.name || items[0]?.professionalName || "Profesional";
  const text = buildProfessionalDaySummary(professionalName, formatDateLabel(filterDate), items);
  await copyText(text);
  const feedback = root.querySelector("[data-copy-feedback]");
  if (feedback) {
    feedback.textContent = "Turnos copiados";
    feedback.hidden = false;
  }
}

function openWhatsapp(id) {
  const reservationId = Number(id);
  const reservation = agenda.find((item) => item.id === reservationId)
    || allReservations.find((item) => item.id === reservationId);
  const message = reservation
    ? `Hola ${reservation.customerName}. Tu turno en ${businessName} esta reservado para el ${formatDateLabel(reservation.date)} a las ${reservation.time}. Servicio: ${reservation.serviceName}. Profesional: ${reservation.professionalName}. Si necesitas modificarlo o cancelarlo, comunicate con nosotros.`
    : "";
  const link = buildWhatsappLink(reservation?.customerPhone, message, "3549");
  if (!reservation || !link) {
    window.alert("Ese turno no tiene un telefono valido.");
    return;
  }
  window.open(link, "_blank");
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

function statusBadge(status) {
  return `<span class="status-badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function renderAgendaList(items, emptyText) {
  if (items.length === 0) {
    return `<div class="admin-empty"><strong>${escapeHtml(emptyText)}</strong></div>`;
  }
  return items.map((reservation) => `
    <article class="agenda-row">
      <div>
        <strong>${escapeHtml(reservation.time)} - ${escapeHtml(reservation.customerName)} ${statusBadge(reservation.status)}</strong>
        <span>${escapeHtml(reservation.serviceName)} con ${escapeHtml(reservation.professionalName)}</span>
        <small>${escapeHtml(formatDateLabel(reservation.date))} - ${escapeHtml(reservation.customerPhone)}</small>
      </div>
      ${statusSelect(reservation)}
      ${reservation.depositStatus === "pending" ? `<button class="secondary-button" type="button" data-action="confirm-deposit" data-id="${reservation.id}">✓ Seña recibida / Confirmar turno</button>` : ""}
      <button class="secondary-button" type="button" data-action="whatsapp" data-id="${reservation.id}">WhatsApp</button>
      <button class="danger-button" type="button" data-action="cancel-status" data-id="${reservation.id}">Cancelar</button>
    </article>
  `).join("");
}

function renderCopyTools(items) {
  const groups = groupAgendaByProfessional(items);
  if (groups.length === 0) return "";
  return `
    <div class="copy-tools">
      <div>
        <strong>Copiar turnos del dia</strong>
        <span>Texto listo para pegar en WhatsApp.</span>
      </div>
      <div class="copy-actions">
        ${groups.map((group) => `
          <button class="secondary-button" type="button" data-action="copy-day" data-id="${group.id}">Copiar ${escapeHtml(group.name)}</button>
        `).join("")}
      </div>
      <small data-copy-feedback hidden></small>
    </div>
  `;
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
        <label class="check-field"><input name="requiresDeposit" type="checkbox" value="1" /> Requiere seña</label>
        <input name="depositAmount" type="number" min="0" step="1" placeholder="Seña" />
        <textarea name="paymentInstructions" placeholder="Instrucciones de pago"></textarea>
        <button class="primary-button" type="submit">Crear</button>
      </form>
      ${services.map((service) => `
        <form class="admin-inline-form" data-form="service-update" data-id="${escapeHtml(service.id)}">
          <strong>${escapeHtml(service.id)}</strong>
          <input name="name" value="${escapeHtml(service.name)}" />
          <input name="durationMinutes" type="number" min="1" value="${service.durationMinutes}" />
          <input name="price" type="number" min="0" step="0.01" value="${service.price === "" ? "" : escapeHtml(service.price)}" />
          <label class="check-field"><input name="requiresDeposit" type="checkbox" value="1" ${service.requiresDeposit ? "checked" : ""} /> Seña</label>
          <input name="depositAmount" type="number" min="0" step="1" value="${service.depositAmount}" />
          <textarea name="paymentInstructions">${escapeHtml(service.paymentInstructions)}</textarea>
          <button class="secondary-button" type="submit">Guardar</button>
          <button class="danger-button" type="button" data-action="delete-service" data-id="${escapeHtml(service.id)}">Eliminar</button>
        </form>
      `).join("")}
    </section>
  `;
}

function renderBusinessSettings() {
  const normalizedWhatsapp = normalizeArgentinaWhatsapp(businessDetails.whatsapp, "3549");
  return `
    <section class="admin-section">
      <h2>Datos del negocio</h2>
      <form class="admin-form business-form" data-form="business-update">
        <input name="whatsapp" placeholder="WhatsApp del negocio" value="${escapeHtml(businessDetails.whatsapp)}" />
        <input name="address" placeholder="Direccion" value="${escapeHtml(businessDetails.address)}" />
        <input name="paymentAlias" placeholder="Alias de pago" value="${escapeHtml(businessDetails.paymentAlias)}" />
        <small class="whatsapp-preview" data-whatsapp-preview>${normalizedWhatsapp ? `Se enviará como: ${escapeHtml(normalizedWhatsapp)}` : "No pudimos reconocer el WhatsApp. Escribilo con característica, por ejemplo: 3549504056."}</small>
        <button class="primary-button" type="submit">Guardar datos</button>
      </form>
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

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function notificationStatusBadge(status) {
  return `<span class="notification-badge notification-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function renderNotificationsTable(notifications) {
  if (notifications.length === 0) {
    return `<tr><td colspan="10">No hay notificaciones todavia.</td></tr>`;
  }

  return notifications.map((notification) => {
    const fullMessage = escapeHtml(notification.message || "");
    const preview = escapeHtml(notification.message_preview || notification.message || "");
    const lastError = escapeHtml(notification.last_error || "");
    return `
      <tr class="notification-row-${escapeHtml(notification.status)}">
        <td>${escapeHtml(notification.id)}</td>
        <td>${escapeHtml(notification.type)}</td>
        <td>${escapeHtml(notification.channel)}</td>
        <td>${escapeHtml(notification.recipient)}</td>
        <td>${notificationStatusBadge(notification.status)}</td>
        <td>${escapeHtml(notification.attempts)}</td>
        <td>${escapeHtml(formatDateTime(notification.scheduled_for))}</td>
        <td>${escapeHtml(formatDateTime(notification.sent_at))}</td>
        <td class="notification-error">${lastError ? `<span title="${lastError}">ver</span>` : "-"}</td>
        <td class="notification-message" title="${fullMessage}">${preview}</td>
      </tr>
    `;
  }).join("");
}

function renderNotificationsSummary(notifications) {
  const counts = {
    pending: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
  };
  notifications.forEach((notification) => {
    if (Object.hasOwn(counts, notification.status)) counts[notification.status] += 1;
  });
  return `
    <span class="notification-badge notification-pending">Pendientes: ${counts.pending}</span>
    <span class="notification-badge notification-sent">Enviadas: ${counts.sent}</span>
    <span class="notification-badge notification-failed">Fallidas: ${counts.failed}</span>
    <span class="notification-badge notification-cancelled">Canceladas: ${counts.cancelled}</span>
  `;
}

async function loadNotifications() {
  const response = await adminFetch(`${BUSINESS_API_URL}/admin/notifications`);
  if (!response.ok) throw new Error("No se pudieron cargar las notificaciones.");
  const data = await response.json();
  return Array.isArray(data.notifications) ? data.notifications : [];
}

async function refreshNotificationsPanel() {
  const notifications = await loadNotifications();
  const summary = root.querySelector("[data-notifications-summary]");
  const body = root.querySelector("[data-notifications-body]");
  const updated = root.querySelector("[data-notifications-updated]");
  if (summary) summary.innerHTML = renderNotificationsSummary(notifications);
  if (body) body.innerHTML = renderNotificationsTable(notifications);
  if (updated) updated.textContent = `Actualizado ${formatDateTime(new Date().toISOString())}`;
}

async function renderNotificationsPanel() {
  if (pollingId) {
    clearInterval(pollingId);
    pollingId = null;
  }
  logoutButton.hidden = false;
  root.innerHTML = `
    <section class="admin-section notifications-panel">
      <div class="admin-section-header">
        <div>
          <h2>Cola de notificaciones</h2>
          <p>Ultimos mensajes encolados por este negocio.</p>
        </div>
        <button id="btn-refresh-notifications" class="secondary-button" type="button" data-action="refresh-notifications">Actualizar</button>
      </div>
      <div class="notifications-summary" data-notifications-summary></div>
      <small class="admin-update-line" data-notifications-updated></small>
      <div class="notifications-table-wrap">
        <table class="notifications-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Tipo</th>
              <th>Canal</th>
              <th>Destinatario</th>
              <th>Estado</th>
              <th>Intentos</th>
              <th>Programado para</th>
              <th>Enviado en</th>
              <th>Error</th>
              <th>Mensaje</th>
            </tr>
          </thead>
          <tbody data-notifications-body>
            <tr><td colspan="10">Cargando notificaciones...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
  await refreshNotificationsPanel();
  pollingId = setInterval(() => {
    if (!token) return;
    refreshNotificationsPanel().catch(() => {});
  }, 30000);
}

async function renderAdmin() {
  const reservations = await loadAdminData();
  knownReservationIds = new Set(reservations.map((item) => item.id));
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
          <select name="professionalId">
            <option value="">Todos los profesionales</option>
            ${professionals.map((professional) => `<option value="${professional.id}" ${String(professional.id) === String(filterProfessionalId) ? "selected" : ""}>${escapeHtml(professional.name)}</option>`).join("")}
          </select>
          <button class="secondary-button" type="button" data-action="today-filter">Hoy</button>
          <button class="secondary-button" type="button" data-action="refresh-agenda">Actualizar turnos</button>
          <button class="secondary-button" type="submit">Buscar</button>
        </form>
      </div>
      <div class="admin-update-line">
        <span data-last-updated>${lastUpdatedAt ? `Actualizado hace 0 segundos` : ""}</span>
        <strong data-admin-notice hidden></strong>
      </div>
      <div data-copy-tools-slot>${renderCopyTools(agenda)}</div>
      <div class="agenda-list" data-agenda-list="today">${renderAgendaList(agenda, "No hay turnos para esta fecha.")}</div>
    </section>
    <section class="admin-section">
      <h2>Proximos turnos</h2>
      <div class="agenda-list" data-agenda-list="upcoming">${renderAgendaList(upcoming, "No hay proximos turnos.")}</div>
    </section>
    ${renderBusinessSettings()}
    ${renderServices()}
    ${renderProfessionals()}
    ${renderSchedules()}
  `;
}

async function renderCurrentAdminView() {
  if (isNotificationsPage) {
    await renderNotificationsPanel();
    return;
  }
  await renderAdmin();
}

async function refresh() {
  try {
    await renderCurrentAdminView();
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
      if (!isNotificationsPage) startPolling();
      return;
    }
    if (form.id === "filter-form") {
      filterDate = data.date || "";
      filterProfessionalId = data.professionalId || "";
      await refreshReservationsOnly();
      return;
    }
    if (form.dataset.form === "business-update") {
      const updated = await sendJson(`${BUSINESS_API_URL}/admin/business`, "PUT", data);
      businessDetails = normalizeBusiness(updated);
      businessNameElement.textContent = businessName;
      await loadBusiness();
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
  await refreshReservationsOnly();
});

root.addEventListener("input", (event) => {
  const whatsappInput = event.target.closest("input[name='whatsapp']");
  if (!whatsappInput) return;
  const form = whatsappInput.closest("form");
  const preview = form?.querySelector("[data-whatsapp-preview]");
  if (!preview) return;
  const normalized = normalizeArgentinaWhatsapp(whatsappInput.value, "3549");
  preview.textContent = normalized
    ? `Se enviará como: ${normalized}`
    : "No pudimos reconocer el WhatsApp. Escribilo con característica, por ejemplo: 3549504056.";
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
  if (action === "copy-day") {
    try {
      await copyProfessionalDay(id);
    } catch (error) {
      window.alert("No pudimos copiar los turnos.");
    }
    return;
  }
  if (action === "today-filter") {
    filterDate = toIsoDate(new Date());
    const dateInput = root.querySelector("#filter-form input[name='date']");
    if (dateInput) dateInput.value = filterDate;
    await refreshReservationsOnly();
    return;
  }
  if (action === "refresh-agenda") {
    try {
      await refreshReservationsOnly({ showNewNotice: true });
    } catch (error) {
      window.alert("No pudimos actualizar los turnos.");
    }
    return;
  }
  if (action === "refresh-notifications" || button.id === "btn-refresh-notifications") {
    try {
      await refreshNotificationsPanel();
    } catch (error) {
      window.alert("No pudimos actualizar las notificaciones.");
    }
    return;
  }
  if (action === "cancel-status") {
    await sendJson(`${BUSINESS_API_URL}/admin/reservations/${id}/status`, "PATCH", { status: "cancelado" });
    await refreshReservationsOnly();
    return;
  }
  if (action === "confirm-deposit") {
    await sendJson(`${BUSINESS_API_URL}/admin/bookings/${id}/confirm-payment`, "POST", {});
    window.alert("Seña confirmada. Turno confirmado.");
    await refreshReservationsOnly();
    return;
  }

  const deleteConfig = {
    "delete-service": {
      confirm: "¿Eliminar este servicio?",
      url: `${BUSINESS_API_URL}/admin/services/${id}`,
    },
    "delete-professional": {
      confirm: "¿Eliminar este profesional?",
      url: `${BUSINESS_API_URL}/admin/professionals/${id}`,
    },
    "delete-schedule": {
      confirm: "¿Eliminar este horario?",
      url: `${BUSINESS_API_URL}/admin/schedules/${id}`,
    },
  };
  const config = deleteConfig[action];
  if (!config) return;

  if (!window.confirm(config.confirm)) return;
  try {
    const response = await adminFetch(config.url, { method: "DELETE" });
    if (!response.ok) {
      const message = await readErrorMessage(response);
      const hasAssociatedReservations = response.status === 409 && /reservas|turnos/i.test(message);
      window.alert(hasAssociatedReservations
        ? "No se puede eliminar porque tiene turnos asociados. Podés ocultarlo o desactivarlo."
        : message);
      return;
    }
    await refresh();
    window.alert("Eliminado");
  } catch (error) {
    window.alert("No pudimos eliminar. Probá de nuevo.");
  }
});

logoutButton.addEventListener("click", () => {
  clearSession();
  renderLogin();
});

async function init() {
  const exists = await loadBusiness();
  if (!exists) return;
  if (!token) renderLogin();
  else {
    await refresh();
    if (!isNotificationsPage) startPolling();
  }
}

init();
