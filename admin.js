const root = document.querySelector("#admin-root");
const logoutButton = document.querySelector("#logout-button");
const businessNameElement = document.querySelector("#business-name");
const businessMetaElement = document.querySelector("#business-meta");
const adminHomeLink = document.querySelector("#admin-home-link");
const adminNotificationsLink = document.querySelector("#admin-notifications-link");
const adminCurrentDateElement = document.querySelector("#admin-current-date");
const publicPageLink = document.querySelector("#public-page-link");
const copyPublicLinkButton = document.querySelector("#copy-public-link-button");

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
let businessName = "Momentia";
let businessDetails = {
  whatsapp: "",
  address: "",
  paymentAlias: "",
};
let filterDate = toIsoDate(new Date());
let filterProfessionalId = "";
let filterStatus = "";
let filterCustomer = "";
let filterPhone = "";
let agendaViewMode = "agenda";
let pollingId = null;
let lastUpdatedAt = null;
let knownReservationIds = new Set();

if (adminHomeLink) adminHomeLink.href = `/${BUSINESS_SLUG}/admin`;
if (adminNotificationsLink) adminNotificationsLink.href = `/${BUSINESS_SLUG}/admin/notifications`;
if (publicPageLink) publicPageLink.href = `/${BUSINESS_SLUG}`;
if (adminCurrentDateElement) adminCurrentDateElement.textContent = new Date().toLocaleDateString("es-AR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});

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

async function createManualBooking(form, data) {
  const errorElement = form.querySelector(".form-error");
  if (errorElement) {
    errorElement.hidden = true;
    errorElement.textContent = "";
  }

  const response = await fetch(`${BUSINESS_API_URL}/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serviceId: data.serviceId,
      professionalId: data.professionalId,
      date: data.date,
      time: data.time,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "No pudimos crear el turno.");
  }

  form.reset();
  await loadReservationData();
  await refresh();
  const notice = root.querySelector("[data-admin-notice]");
  if (notice) {
    notice.textContent = payload.notificationWarning
      ? "Turno creado correctamente. No fue posible enviar la notificacion por WhatsApp."
      : "Turno creado correctamente.";
    notice.hidden = false;
  }
}

async function readErrorMessage(response) {
  try {
    const data = await response.json();
    return data.error || "No pudimos completar la accion.";
  } catch (error) {
    return "No pudimos completar la accion.";
  }
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "-";
  return `$${number.toLocaleString("es-AR")}`;
}

function findServiceForReservation(reservation) {
  return services.find((service) => service.id === reservation.serviceId)
    || services.find((service) => service.name === reservation.serviceName)
    || null;
}

function getReservationPrice(reservation) {
  return findServiceForReservation(reservation)?.price ?? "";
}

function getReservationDepositAmount(reservation) {
  const service = findServiceForReservation(reservation);
  if (!service) return 0;
  return Number(service.depositAmount) || 0;
}

function adminTimeToMinutes(time) {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  return hours * 60 + minutes;
}

function adminMinutesToTime(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function getWeekdayFromIsoDate(value) {
  return parseIsoDate(value).getDay();
}

function reservationRangesOverlap(start, end, reservation) {
  const reservedStart = adminTimeToMinutes(reservation.time);
  const service = findServiceForReservation(reservation);
  const reservedDuration = service?.durationMinutes || 30;
  const reservedEnd = reservedStart + reservedDuration;
  return start < reservedEnd && reservedStart < end;
}

function getManualBookingTimes(serviceId, professionalId, date) {
  const service = services.find((item) => item.id === serviceId);
  const professional = professionals.find((item) => String(item.id) === String(professionalId));
  if (!service || !professional || !date) return [];

  const duration = service.durationMinutes || 0;
  const weekday = getWeekdayFromIsoDate(date);
  const blocked = allReservations.filter((reservation) => (
    reservation.date === date
    && Number(reservation.professionalId) === Number(professional.id)
  ));

  const times = schedules
    .filter((schedule) => Number(schedule.professionalId) === Number(professional.id) && schedule.weekday === weekday)
    .flatMap((schedule) => {
      const start = adminTimeToMinutes(schedule.startTime);
      const end = adminTimeToMinutes(schedule.endTime);
      const generated = [];
      for (let current = start; current + duration <= end; current += schedule.intervalMinutes) {
        const time = adminMinutesToTime(current);
        const overlaps = blocked.some((reservation) => reservationRangesOverlap(current, current + duration, reservation));
        if (!overlaps) generated.push(time);
      }
      return generated;
    });

  const today = toIsoDate(new Date());
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  return [...new Set(times)]
    .filter((time) => date !== today || adminTimeToMinutes(time) > nowMinutes)
    .sort();
}

function updateManualBookingTimes() {
  const form = root.querySelector("[data-form='manual-booking']");
  if (!form) return;
  const timeSelect = form.querySelector("select[name='time']");
  const depositHint = form.querySelector("[data-manual-deposit-hint]");
  const service = services.find((item) => item.id === form.serviceId.value);
  const times = getManualBookingTimes(form.serviceId.value, form.professionalId.value, form.date.value);
  timeSelect.innerHTML = times.length
    ? times.map((time) => `<option value="${time}">${time}</option>`).join("")
    : `<option value="">No hay horarios disponibles</option>`;
  timeSelect.disabled = times.length === 0;
  if (depositHint) {
    depositHint.textContent = service?.requiresDeposit
      ? `Este servicio quedara pendiente de sena (${formatPrice(service.depositAmount)}).`
      : "Este turno se creara como confirmado.";
  }
}

function getFilteredAgendaItems() {
  const customer = filterCustomer.trim().toLowerCase();
  const phone = filterPhone.replace(/\D/g, "");
  return agenda.filter((item) => {
    if (filterStatus && item.status !== filterStatus) return false;
    if (customer && !item.customerName.toLowerCase().includes(customer)) return false;
    if (phone && !item.customerPhone.replace(/\D/g, "").includes(phone)) return false;
    return true;
  });
}

function getNextReservation(items = allReservations) {
  const today = toIsoDate(new Date());
  const now = new Date();
  return sortAgendaByTime(items.filter((item) => {
    if (item.status === "cancelado") return false;
    if (item.date < today) return false;
    const date = parseIsoDate(item.date);
    const [hours, minutes] = item.time.split(":").map(Number);
    date.setHours(hours || 0, minutes || 0, 0, 0);
    return date >= now;
  })).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0] || null;
}

function getMostLoadedProfessional(items) {
  const counts = new Map();
  for (const item of items) {
    const key = item.professionalName || "Sin profesional";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
}

async function loadBusiness() {
  const response = await fetch(BUSINESS_API_URL);
  if (response.status === 404) {
    root.innerHTML = `<div class="admin-empty"><h2>Negocio no encontrado</h2><p>Revisa el enlace del panel.</p></div>`;
    return false;
  }
  const business = await response.json();
  const normalized = normalizeBusiness(business);
  businessName = normalized.name || "Momentia";
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
  const dashboard = root.querySelector("[data-admin-dashboard]");
  const viewSlot = root.querySelector("[data-agenda-view-slot]");
  const upcomingList = root.querySelector("[data-agenda-list='upcoming']");
  const upcoming = allReservations.filter((item) => item.date >= toIsoDate(new Date())).slice(0, 8);
  const visibleAgenda = getFilteredAgendaItems();
  if (dashboard) dashboard.innerHTML = renderDashboard(agenda);
  if (copyTools) copyTools.innerHTML = renderCopyTools(visibleAgenda);
  if (viewSlot) viewSlot.innerHTML = agendaViewMode === "professional"
    ? renderProfessionalAgenda(visibleAgenda)
    : renderAgendaList(visibleAgenda, "No hay turnos con estos filtros.");
  if (todayList) todayList.innerHTML = renderAgendaList(visibleAgenda, "No hay turnos con estos filtros.");
  if (upcomingList) upcomingList.innerHTML = renderAgendaList(upcoming, "No hay proximos turnos.");
  updateFreshnessText();
}

function setReservationState(id, status, depositStatus = null) {
  const reservationId = Number(id);
  for (const collection of [agenda, allReservations]) {
    const reservation = collection.find((item) => item.id === reservationId);
    if (reservation) {
      reservation.status = status;
      if (depositStatus) reservation.depositStatus = depositStatus;
    }
  }
}

function updateReservationCard(id, status, depositStatus = null) {
  const cards = root.querySelectorAll(`[data-booking-id="${id}"]`);
  if (cards.length === 0) return;

  for (const card of cards) {
    const badge = card.querySelector(".booking-status-badge");
    if (badge) {
      badge.textContent = getStatusLabel(status);
      badge.className = `status-badge booking-status-badge ${getStatusClass(status)} status-${status}`;
    }

    const select = card.querySelector(".status-select");
    if (select) select.value = status;

    if (depositStatus === "paid") {
      const confirmBtn = card.querySelector(".btn-confirm-payment");
      if (confirmBtn) confirmBtn.hidden = true;
    }
  }
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
  const items = sortAgendaByTime(getFilteredAgendaItems().filter((item) => Number(item.professionalId) === id));
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

function buildFullAgendaSummary(items) {
  const lines = [`Agenda de hoy - ${businessName}`, formatDateLabel(filterDate), ""];
  for (const group of groupAgendaByProfessional(items)) {
    lines.push(group.name);
    lines.push("");
    for (const item of sortAgendaByTime(group.items)) {
      lines.push(`${item.time} - ${item.customerName} - ${item.serviceName}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function copyFullAgenda() {
  await copyText(buildFullAgendaSummary(getFilteredAgendaItems()));
  const feedback = root.querySelector("[data-copy-feedback]");
  if (feedback) {
    feedback.textContent = "Agenda copiada";
    feedback.hidden = false;
  }
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadAgendaCsv() {
  const headers = ["Fecha", "Hora", "Cliente", "Telefono", "Servicio", "Profesional", "Estado", "Precio", "Sena"];
  const rows = getFilteredAgendaItems().map((item) => [
    item.date,
    item.time,
    item.customerName,
    item.customerPhone,
    item.serviceName,
    item.professionalName,
    getStatusLabel(item.status),
    formatPrice(getReservationPrice(item)),
    formatPrice(getReservationDepositAmount(item)),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `agenda-${BUSINESS_SLUG}-${filterDate || "turnos"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function getStatusLabel(status) {
  const labels = {
    pendiente_pago: "Pendiente de seña",
    pendiente: "Pendiente de seña",
    confirmado: "Confirmado",
    cancelado: "Cancelado",
    asistio: "Asistió",
    no_asistio: "No asistió",
    reservado: "Reservado",
  };
  return labels[status] || status;
}

function getStatusClass(status) {
  const classes = {
    pendiente_pago: "badge-warning",
    pendiente: "badge-warning",
    confirmado: "badge-success",
    cancelado: "badge-danger",
    reservado: "badge-info",
  };
  return classes[status] || "badge-secondary";
}

function statusSelect(reservation) {
  return `
    <select class="status-select" data-action="status" data-id="${reservation.id}">
      ${statusOptions.map((status) => `<option value="${status}" ${status === reservation.status ? "selected" : ""}>${escapeHtml(getStatusLabel(status))}</option>`).join("")}
    </select>
  `;
}

function statusBadge(status) {
  return `<span class="status-badge booking-status-badge ${escapeHtml(getStatusClass(status))} status-${escapeHtml(status)}">${escapeHtml(getStatusLabel(status))}</span>`;
}

function renderDashboard(items) {
  const next = getNextReservation();
  const mostLoaded = getMostLoadedProfessional(items);
  const counts = {
    today: items.length,
    pending: items.filter((item) => item.depositStatus === "pending" || item.status === "pendiente").length,
    confirmed: items.filter((item) => item.status === "confirmado").length,
    cancelled: items.filter((item) => item.status === "cancelado").length,
  };
  return `
    <div class="admin-kpi-card">
      <span>Turnos hoy</span>
      <strong>${counts.today}</strong>
      <small>${escapeHtml(formatDateLabel(filterDate))}</small>
    </div>
    <div class="admin-kpi-card warning">
      <span>Pendientes de sena</span>
      <strong>${counts.pending}</strong>
      <small>Revisar pagos</small>
    </div>
    <div class="admin-kpi-card success">
      <span>Confirmados</span>
      <strong>${counts.confirmed}</strong>
      <small>Listos para atender</small>
    </div>
    <div class="admin-kpi-card muted">
      <span>Cancelados</span>
      <strong>${counts.cancelled}</strong>
      <small>Del dia filtrado</small>
    </div>
    <div class="admin-kpi-card next">
      <span>Proximo turno</span>
      <strong>${next ? escapeHtml(next.time) : "-"}</strong>
      <small>${next ? `${escapeHtml(next.customerName)} - ${escapeHtml(next.serviceName)}` : "Sin proximos turnos"}</small>
    </div>
    <div class="admin-kpi-card">
      <span>Mas carga</span>
      <strong>${mostLoaded ? escapeHtml(mostLoaded[1]) : "0"}</strong>
      <small>${mostLoaded ? escapeHtml(mostLoaded[0]) : "Sin turnos"}</small>
    </div>
  `;
}

function renderAgendaList(items, emptyText) {
  if (items.length === 0) {
    return `<div class="admin-empty"><strong>${escapeHtml(emptyText)}</strong></div>`;
  }
  return items.map((reservation) => `
    <article class="agenda-row admin-booking-card" data-booking-id="${reservation.id}">
      <div class="booking-time-block">
        <strong>${escapeHtml(reservation.time)}</strong>
        <small>${escapeHtml(formatDateLabel(reservation.date))}</small>
      </div>
      <div class="booking-main-block">
        <strong>${escapeHtml(reservation.customerName)} ${statusBadge(reservation.status)}</strong>
        <span>${escapeHtml(reservation.serviceName)} con ${escapeHtml(reservation.professionalName)}</span>
        <small>${escapeHtml(reservation.customerPhone)}</small>
      </div>
      <div class="booking-money-block">
        <span>Precio ${escapeHtml(formatPrice(getReservationPrice(reservation)))}</span>
        <small>Sena ${escapeHtml(formatPrice(getReservationDepositAmount(reservation)))}</small>
      </div>
      ${statusSelect(reservation)}
      <div class="booking-actions">
        ${reservation.depositStatus === "pending" ? `<button class="secondary-button btn-confirm-payment" type="button" data-action="confirm-deposit" data-id="${reservation.id}">Confirmar sena</button>` : ""}
        <button class="secondary-button" type="button" data-action="whatsapp" data-id="${reservation.id}">WhatsApp</button>
        <button class="secondary-button" type="button" data-action="quick-status" data-status="asistio" data-id="${reservation.id}">Asistio</button>
        <button class="secondary-button" type="button" data-action="quick-status" data-status="no_asistio" data-id="${reservation.id}">No asistio</button>
        <button class="danger-button" type="button" data-action="cancel-status" data-id="${reservation.id}">Cancelar</button>
      </div>
    </article>
  `).join("");
}

function renderProfessionalAgenda(items) {
  const groups = groupAgendaByProfessional(items);
  if (groups.length === 0) return `<div class="admin-empty"><strong>No hay turnos con estos filtros.</strong></div>`;
  return groups.map((group) => `
    <section class="professional-agenda-card">
      <div class="professional-agenda-header">
        <div>
          <h3>${escapeHtml(group.name)}</h3>
          <p>${group.items.length} turno${group.items.length === 1 ? "" : "s"}</p>
        </div>
        <button class="secondary-button" type="button" data-action="copy-day" data-id="${group.id}">Copiar agenda</button>
      </div>
      <div class="professional-agenda-list">
        ${sortAgendaByTime(group.items).map((item) => `
          <div class="professional-agenda-item" data-booking-id="${item.id}">
            <strong>${escapeHtml(item.time)} - ${escapeHtml(item.customerName)}</strong>
            <span>${escapeHtml(item.serviceName)} ${statusBadge(item.status)}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function renderCopyTools(items) {
  const groups = groupAgendaByProfessional(items);
  return `
    <div class="copy-tools">
      <div>
        <strong>Compartir agenda</strong>
        <span>Texto listo para pegar en WhatsApp o CSV para descargar.</span>
      </div>
      <div class="copy-actions">
        <button class="secondary-button" type="button" data-action="copy-full-agenda" ${items.length ? "" : "disabled"}>Copiar agenda del dia</button>
        <button class="secondary-button" type="button" data-action="download-csv" ${items.length ? "" : "disabled"}>Descargar CSV</button>
        ${groups.map((group) => `
          <button class="secondary-button" type="button" data-action="copy-day" data-id="${group.id}">Copiar ${escapeHtml(group.name)}</button>
        `).join("")}
      </div>
      <small data-copy-feedback hidden></small>
    </div>
  `;
}

function renderManualBooking() {
  const today = toIsoDate(new Date());
  const selectedService = services[0] || null;
  const selectedProfessional = professionals[0] || null;
  const times = selectedService && selectedProfessional
    ? getManualBookingTimes(selectedService.id, selectedProfessional.id, today)
    : [];
  return `
    <section class="admin-section manual-booking-section" id="nuevo-turno">
      <div class="admin-section-header compact">
        <div>
          <p class="eyebrow">Carga manual</p>
          <h2>+ Nuevo turno</h2>
          <p>Para turnos pedidos por WhatsApp, telefono o en persona. Usa la misma disponibilidad del link publico.</p>
        </div>
        <small class="manual-booking-note">El envio de WhatsApp usa el flujo actual del sistema. Desactivarlo requiere un contrato backend nuevo.</small>
      </div>
      <form class="admin-form manual-booking-form" data-form="manual-booking">
        <label><span>Cliente *</span><input name="customerName" autocomplete="name" required /></label>
        <label><span>WhatsApp *</span><input name="customerPhone" type="tel" placeholder="Ej: 3549432877" required /></label>
        <label>
          <span>Servicio *</span>
          <select name="serviceId" required>
            ${services.map((service) => `<option value="${escapeHtml(service.id)}">${escapeHtml(service.name)}${service.requiresDeposit ? " - requiere sena" : ""}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Profesional *</span>
          <select name="professionalId" required>
            ${professionals.map((professional) => `<option value="${professional.id}">${escapeHtml(professional.name)}</option>`).join("")}
          </select>
        </label>
        <label><span>Fecha *</span><input name="date" type="date" min="${today}" value="${today}" required /></label>
        <label>
          <span>Hora *</span>
          <select name="time" required ${times.length ? "" : "disabled"}>
            ${times.length ? times.map((time) => `<option value="${time}">${time}</option>`).join("") : `<option value="">No hay horarios disponibles</option>`}
          </select>
        </label>
        <label class="check-field manual-whatsapp-field">
          <input type="checkbox" checked disabled />
          Enviar WhatsApp al cliente
        </label>
        <small data-manual-deposit-hint>${selectedService?.requiresDeposit ? `Este servicio quedara pendiente de sena (${formatPrice(selectedService.depositAmount)}).` : "Este turno se creara como confirmado."}</small>
        <p class="form-error" hidden></p>
        <button class="primary-button" type="submit" ${services.length && professionals.length ? "" : "disabled"}>Crear turno</button>
      </form>
    </section>
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
  const visibleAgenda = getFilteredAgendaItems();
  root.innerHTML = `
    <section class="admin-dashboard" data-admin-dashboard>
      ${renderDashboard(agenda)}
    </section>
    <section class="admin-section">
      <div class="admin-section-header">
        <div>
          <h2>Agenda del dia</h2>
          <p>Turnos, pagos y acciones rapidas del negocio.</p>
        </div>
        <form id="filter-form" class="admin-filter">
          <input name="date" type="date" value="${escapeHtml(filterDate)}" />
          <select name="professionalId">
            <option value="">Todos los profesionales</option>
            ${professionals.map((professional) => `<option value="${professional.id}" ${String(professional.id) === String(filterProfessionalId) ? "selected" : ""}>${escapeHtml(professional.name)}</option>`).join("")}
          </select>
          <select name="status">
            <option value="">Todos los estados</option>
            ${statusOptions.map((status) => `<option value="${status}" ${status === filterStatus ? "selected" : ""}>${escapeHtml(getStatusLabel(status))}</option>`).join("")}
          </select>
          <input name="customer" type="search" placeholder="Buscar cliente" value="${escapeHtml(filterCustomer)}" />
          <input name="phone" type="search" placeholder="Buscar telefono" value="${escapeHtml(filterPhone)}" />
          <button class="secondary-button" type="button" data-action="today-filter">Hoy</button>
          <button class="primary-button" type="button" data-action="focus-manual-booking">+ Nuevo turno</button>
          <button class="secondary-button" type="button" data-action="refresh-agenda">Actualizar turnos</button>
          <button class="secondary-button" type="submit">Buscar</button>
        </form>
      </div>
      ${renderManualBooking()}
      <div class="admin-view-toggle" role="group" aria-label="Vista de agenda">
        <button class="${agendaViewMode === "agenda" ? "active" : ""}" type="button" data-action="view-agenda">Agenda</button>
        <button class="${agendaViewMode === "professional" ? "active" : ""}" type="button" data-action="view-professional">Por profesional</button>
      </div>
      <div class="admin-update-line">
        <span data-last-updated>${lastUpdatedAt ? `Actualizado hace 0 segundos` : ""}</span>
        <strong data-admin-notice hidden></strong>
      </div>
      <div data-copy-tools-slot>${renderCopyTools(visibleAgenda)}</div>
      <div class="agenda-list" data-agenda-view-slot>${agendaViewMode === "professional" ? renderProfessionalAgenda(visibleAgenda) : renderAgendaList(visibleAgenda, "No hay turnos con estos filtros.")}</div>
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
      filterStatus = data.status || "";
      filterCustomer = data.customer || "";
      filterPhone = data.phone || "";
      await refreshReservationsOnly();
      return;
    }
    if (form.dataset.form === "manual-booking") {
      await createManualBooking(form, data);
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
    if (errorElement) {
      errorElement.textContent = error.message || "No pudimos guardar el cambio.";
      errorElement.hidden = false;
    }
    else window.alert("No pudimos guardar el cambio.");
  }
});

root.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-action='status']");
  const manualField = event.target.closest("[data-form='manual-booking'] select, [data-form='manual-booking'] input[type='date']");
  if (manualField) {
    updateManualBookingTimes();
    return;
  }
  if (!select) return;
  const updated = await sendJson(`${BUSINESS_API_URL}/admin/reservations/${select.dataset.id}/status`, "PATCH", { status: select.value });
  const status = updated?.status || select.value;
  setReservationState(select.dataset.id, status, updated?.depositStatus);
  updateReservationCard(select.dataset.id, status, updated?.depositStatus);
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
  if (action === "focus-manual-booking") {
    const target = root.querySelector("#nuevo-turno");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
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
  if (action === "copy-full-agenda") {
    try {
      await copyFullAgenda();
    } catch (error) {
      window.alert("No pudimos copiar la agenda.");
    }
    return;
  }
  if (action === "download-csv") {
    downloadAgendaCsv();
    return;
  }
  if (action === "view-agenda" || action === "view-professional") {
    agendaViewMode = action === "view-professional" ? "professional" : "agenda";
    await refreshReservationsOnly();
    const buttons = root.querySelectorAll(".admin-view-toggle button");
    buttons.forEach((item) => item.classList.toggle("active", item.dataset.action === action));
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
    const response = await adminFetch(`${BUSINESS_API_URL}/admin/reservations/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelado" }),
    });
    if (!response.ok) {
      window.alert(await readErrorMessage(response));
      return;
    }
    await refreshReservationsOnly();
    return;
  }
  if (action === "quick-status") {
    const nextStatus = button.dataset.status;
    const updated = await sendJson(`${BUSINESS_API_URL}/admin/reservations/${id}/status`, "PATCH", { status: nextStatus });
    const status = updated?.status || nextStatus;
    setReservationState(id, status, updated?.depositStatus);
    updateReservationCard(id, status, updated?.depositStatus);
    const notice = root.querySelector("[data-admin-notice]");
    if (notice) {
      notice.textContent = "Turno actualizado correctamente";
      notice.hidden = false;
    }
    return;
  }
  if (action === "confirm-deposit") {
    const updated = await sendJson(`${BUSINESS_API_URL}/admin/bookings/${id}/confirm-payment`, "POST", {});
    setReservationState(id, updated?.status || "confirmado", updated?.depositStatus || "paid");
    updateReservationCard(id, updated?.status || "confirmado", updated?.depositStatus || "paid");
    const notice = root.querySelector("[data-admin-notice]");
    if (notice) {
      notice.textContent = "Seña confirmada. Turno confirmado.";
      notice.hidden = false;
    }
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

if (copyPublicLinkButton) {
  copyPublicLinkButton.addEventListener("click", async () => {
    try {
      await copyText(`${window.location.origin}/${BUSINESS_SLUG}`);
      copyPublicLinkButton.textContent = "Link copiado";
      setTimeout(() => {
        copyPublicLinkButton.textContent = "Copiar link de reservas";
      }, 1800);
    } catch (error) {
      window.alert("No pudimos copiar el link.");
    }
  });
}

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
