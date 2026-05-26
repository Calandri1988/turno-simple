const chat = document.querySelector("#chat");
const options = document.querySelector("#options");
const restartButton = document.querySelector("#restart");
const adminList = document.querySelector("#admin-list");
const adminCount = document.querySelector("#admin-count");
const clearReservationsButton = document.querySelector("#clear-reservations");
const businessNameElement = document.querySelector("#business-name");
const businessMetaElement = document.querySelector("#business-meta");

const businessSlug = resolveBusinessSlug();
const BUSINESS_API_URL = `/api/businesses/${businessSlug}`;
const API_URL = `${BUSINESS_API_URL}/reservations`;
const SERVICES_URL = `${BUSINESS_API_URL}/services`;
const PROFESSIONALS_URL = `${BUSINESS_API_URL}/professionals`;
const ADMIN_SERVICES_URL = `${BUSINESS_API_URL}/admin/services`;
const ADMIN_PROFESSIONALS_URL = `${BUSINESS_API_URL}/admin/professionals`;
const ADMIN_SCHEDULES_URL = `${BUSINESS_API_URL}/admin/schedules`;
const ADMIN_AGENDA_URL = `${BUSINESS_API_URL}/admin/agenda`;
const ADMIN_LOGIN_URL = `${BUSINESS_API_URL}/admin/login`;
const ADMIN_TOKEN_KEY = `turno-simple-admin-token-${businessSlug}`;
const services = [];
const reservations = [];
const professionals = [];
const adminServices = [];
const adminProfessionals = [];
const adminSchedules = [];
const agendaReservations = [];
let adminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || "";
let business = null;
let businessAvailable = true;

const weekdayLabels = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
const statusOptions = ["reservado", "confirmado", "cancelado", "asistio", "no_asistio"];
let businessName = "Turno Simple";
const agendaFilters = {
  date: toIsoDate(new Date()),
  professionalId: "",
  serviceId: "",
  status: "",
};

const state = {
  service: null,
  professionalMode: null,
  professional: null,
  assignedProfessional: null,
  date: null,
  time: null,
  customer: {
    name: "",
    phone: "",
  },
};

function resolveBusinessSlug() {
  const slug = window.location.pathname.split("/").filter(Boolean)[0];
  return slug || "demo";
}

function setBusiness(data) {
  business = data;
  businessName = data.name || "Turno Simple";
  document.title = `${businessName} - Turno Simple`;
  businessNameElement.textContent = businessName;
  const details = [data.category, data.city].filter(Boolean).join(" - ");
  businessMetaElement.textContent = details;
  businessMetaElement.hidden = !details;
}

function renderBusinessNotFound() {
  businessAvailable = false;
  businessNameElement.textContent = "Negocio no encontrado";
  businessMetaElement.textContent = "";
  businessMetaElement.hidden = true;
  chat.replaceChildren();
  clearOptions();
  restartButton.hidden = true;
  addMessage("Negocio no encontrado");
  renderAdminPanel();
}

function addMessage(text, sender = "bot") {
  const row = document.createElement("div");
  row.className = `message-row ${sender}`;

  const bubble = document.createElement("div");
  bubble.className = `message ${sender}`;
  bubble.textContent = text;

  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function addSummary() {
  const row = document.createElement("div");
  row.className = "message-row";
  const reservationItems = [...reservations]
    .sort(compareReservations)
    .map(
      (reservation) => `
        <li>
          <strong>${escapeHtml(reservation.serviceName)}</strong>
          <span>${escapeHtml(formatDateLabel(reservation.date))} - ${escapeHtml(reservation.time)}</span>
          <small>${escapeHtml(reservation.professionalName)} - ${escapeHtml(reservation.customerName)}</small>
        </li>
      `,
    )
    .join("");

  const bubble = document.createElement("div");
  bubble.className = "message bot final-card";
  bubble.innerHTML = `
    <strong class="final-title">Tu turno quedo reservado</strong>
    <p class="final-copy">Te esperamos. Si necesitas otro horario, podes hacer una nueva reserva en un momento.</p>
    <div class="summary">
      <div class="summary-item"><strong>Nombre</strong><span>${escapeHtml(state.customer.name)}</span></div>
      <div class="summary-item"><strong>Telefono</strong><span>${escapeHtml(state.customer.phone)}</span></div>
      <div class="summary-item"><strong>Servicio</strong><span>${escapeHtml(state.service.name)}</span></div>
      <div class="summary-item"><strong>Profesional</strong><span>${escapeHtml(state.assignedProfessional.name)}</span></div>
      <div class="summary-item"><strong>Fecha</strong><span>${escapeHtml(state.date.label)}</span></div>
      <div class="summary-item"><strong>Horario</strong><span>${escapeHtml(state.time)}</span></div>
    </div>
    <div class="reserved-block">
      <strong>Turnos reservados</strong>
      <ul class="reserved-list">${reservationItems}</ul>
    </div>
  `;

  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function clearOptions() {
  options.replaceChildren();
}

function escapeHtml(value) {
  return String(value)
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

function parseIsoDate(dateValue) {
  const [year, month, day] = String(dateValue).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLabel(dateValue) {
  const date = parseIsoDate(dateValue);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  const weekday = weekdayLabels[date.getDay()];
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${weekday} ${day}/${month}`;
}

function getNextDates(days = 14) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + index);

    const isoDate = toIsoDate(date);
    return {
      date: isoDate,
      label: formatDateLabel(isoDate),
      weekday: date.getDay(),
    };
  });
}

function renderOptions(items, onSelect) {
  clearOptions();

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-button";
    button.textContent = item.label || item.name || item;
    button.addEventListener("click", () => onSelect(item));
    options.appendChild(button);
  });
}

function normalizeReservation(rawReservation) {
  return {
    id: Number(rawReservation.id) || 0,
    serviceId: String(rawReservation.serviceId || ""),
    serviceName: String(rawReservation.serviceName || ""),
    professionalId: Number(rawReservation.professionalId) || 0,
    professionalName: String(rawReservation.professionalName || ""),
    date: String(rawReservation.date || rawReservation.day || ""),
    time: String(rawReservation.time || ""),
    durationMinutes: Number(rawReservation.durationMinutes) || 0,
    status: String(rawReservation.status || "reservado"),
    customerName: String(rawReservation.customerName || ""),
    customerPhone: String(rawReservation.customerPhone || ""),
  };
}

function normalizeService(rawService) {
  return {
    id: String(rawService.id || ""),
    name: String(rawService.name || ""),
    durationMinutes: Number(rawService.durationMinutes) || 0,
    price: rawService.price === null || rawService.price === undefined ? null : Number(rawService.price),
  };
}

function normalizeProfessional(rawProfessional) {
  return {
    id: Number(rawProfessional.id) || 0,
    name: String(rawProfessional.name || ""),
    schedules: Array.isArray(rawProfessional.schedules)
      ? rawProfessional.schedules.map((schedule) => ({
          weekday: Number(schedule.weekday),
          startTime: String(schedule.startTime || ""),
          endTime: String(schedule.endTime || ""),
          intervalMinutes: Number(schedule.intervalMinutes) || 0,
        }))
      : [],
  };
}

function normalizeAdminProfessional(rawProfessional) {
  return {
    id: Number(rawProfessional.id) || 0,
    name: String(rawProfessional.name || ""),
  };
}

function normalizeSchedule(rawSchedule) {
  return {
    id: Number(rawSchedule.id) || 0,
    professionalId: Number(rawSchedule.professionalId) || 0,
    professionalName: String(rawSchedule.professionalName || ""),
    weekday: Number(rawSchedule.weekday),
    startTime: String(rawSchedule.startTime || ""),
    endTime: String(rawSchedule.endTime || ""),
    intervalMinutes: Number(rawSchedule.intervalMinutes) || 0,
  };
}

function setReservations(nextReservations) {
  reservations.splice(0, reservations.length, ...nextReservations.map(normalizeReservation));
}

function setServices(nextServices) {
  services.splice(0, services.length, ...nextServices.map(normalizeService));
}

function setProfessionals(nextProfessionals) {
  professionals.splice(0, professionals.length, ...nextProfessionals.map(normalizeProfessional));
}

function setAdminServices(nextServices) {
  adminServices.splice(0, adminServices.length, ...nextServices.map(normalizeService));
}

function setAdminProfessionals(nextProfessionals) {
  adminProfessionals.splice(0, adminProfessionals.length, ...nextProfessionals.map(normalizeAdminProfessional));
}

function setAdminSchedules(nextSchedules) {
  adminSchedules.splice(0, adminSchedules.length, ...nextSchedules.map(normalizeSchedule));
}

function setAgendaReservations(nextReservations) {
  agendaReservations.splice(0, agendaReservations.length, ...nextReservations.map(normalizeReservation));
}

function getAdminHeaders(extraHeaders = {}) {
  return {
    ...extraHeaders,
    Authorization: `Bearer ${adminToken}`,
  };
}

function clearAdminSession() {
  adminToken = "";
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  setReservations([]);
}

async function adminLogin(email, password) {
  const response = await fetch(ADMIN_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error("No se pudo iniciar sesion.");
  }

  const data = await response.json();
  adminToken = String(data.token || "");
  localStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
}

async function loadBusiness() {
  const response = await fetch(BUSINESS_API_URL);
  if (response.status === 404) {
    renderBusinessNotFound();
    return false;
  }

  if (!response.ok) {
    throw new Error("No se pudo cargar el negocio.");
  }

  setBusiness(await response.json());
  return true;
}

async function loadServices() {
  const response = await fetch(SERVICES_URL);
  if (!response.ok) {
    throw new Error("No se pudieron listar los servicios.");
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    setServices(data);
  }
}

async function loadProfessionals() {
  const response = await fetch(PROFESSIONALS_URL);
  if (!response.ok) {
    throw new Error("No se pudieron listar los profesionales.");
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    setProfessionals(data);
  }
}

async function loadReservations() {
  const response = await fetch(API_URL, {
    headers: getAdminHeaders(),
  });
  if (response.status === 401) {
    clearAdminSession();
    renderAdminPanel();
    return;
  }

  if (!response.ok) {
    throw new Error("No se pudieron listar las reservas.");
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    setReservations(data);
  }
}

async function fetchAdminJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: getAdminHeaders(options.headers || {}),
  });

  if (response.status === 401) {
    clearAdminSession();
    renderAdminPanel();
    throw new Error("No autorizado.");
  }

  return response;
}

async function loadAdminResources() {
  const [servicesResponse, professionalsResponse, schedulesResponse] = await Promise.all([
    fetchAdminJson(ADMIN_SERVICES_URL),
    fetchAdminJson(ADMIN_PROFESSIONALS_URL),
    fetchAdminJson(ADMIN_SCHEDULES_URL),
  ]);

  if (!servicesResponse.ok || !professionalsResponse.ok || !schedulesResponse.ok) {
    throw new Error("No se pudieron cargar datos admin.");
  }

  setAdminServices(await servicesResponse.json());
  setAdminProfessionals(await professionalsResponse.json());
  setAdminSchedules(await schedulesResponse.json());
}

function buildAgendaParams() {
  const params = new URLSearchParams();
  if (agendaFilters.date) params.set("date", agendaFilters.date);
  if (agendaFilters.professionalId) params.set("professional_id", agendaFilters.professionalId);
  if (agendaFilters.serviceId) params.set("service_id", agendaFilters.serviceId);
  if (agendaFilters.status) params.set("status", agendaFilters.status);
  return params.toString();
}

async function loadAgenda() {
  const query = buildAgendaParams();
  const response = await fetchAdminJson(`${ADMIN_AGENDA_URL}${query ? `?${query}` : ""}`);
  if (!response.ok) {
    throw new Error("No se pudo cargar la agenda.");
  }
  setAgendaReservations(await response.json());
}

async function refreshAdminData() {
  await Promise.all([loadReservations(), loadAdminResources(), loadAgenda(), loadServices(), loadProfessionals()]);
  renderAdminPanel();
}

async function sendAdminJson(url, method, body) {
  const response = await fetchAdminJson(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error("No se pudo guardar.");
  }

  return response.status === 204 ? null : response.json();
}

async function createReservation(reservation) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reservation),
  });

  if (response.status === 409) {
    throw new Error("reserved");
  }

  if (!response.ok) {
    throw new Error("No se pudo crear la reserva.");
  }

  return normalizeReservation(await response.json());
}

async function deleteReservation(id) {
  const response = await fetch(`${API_URL}/${id}`, {
    method: "DELETE",
    headers: getAdminHeaders(),
  });

  if (response.status === 401) {
    clearAdminSession();
    renderAdminPanel();
    throw new Error("No autorizado.");
  }

  if (!response.ok && response.status !== 404) {
    throw new Error("No se pudo cancelar la reserva.");
  }
}

async function deleteAllReservations() {
  const response = await fetch(API_URL, {
    method: "DELETE",
    headers: getAdminHeaders(),
  });

  if (response.status === 401) {
    clearAdminSession();
    renderAdminPanel();
    throw new Error("No autorizado.");
  }

  if (!response.ok) {
    throw new Error("No se pudieron borrar las reservas.");
  }
}

function compareReservations(first, second) {
  const dateComparison = first.date.localeCompare(second.date);
  if (dateComparison !== 0) {
    return dateComparison;
  }

  const timeComparison = first.time.localeCompare(second.time);
  if (timeComparison !== 0) {
    return timeComparison;
  }

  return first.professionalName.localeCompare(second.professionalName);
}

function groupReservationsByDate() {
  return [...reservations].sort(compareReservations).reduce((groups, reservation) => {
    if (!groups.has(reservation.date)) {
      groups.set(reservation.date, []);
    }

    groups.get(reservation.date).push(reservation);
    return groups;
  }, new Map());
}

function getSchedule(professional, date) {
  return professional.schedules.filter((schedule) => schedule.weekday === date.weekday);
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function generateTimesFromBlocks(blocks) {
  const durationMinutes = state.service?.durationMinutes || 0;
  const times = blocks.flatMap((block) => {
    if (!block.startTime || !block.endTime || block.intervalMinutes <= 0) {
      return [];
    }

    const start = timeToMinutes(block.startTime);
    const end = timeToMinutes(block.endTime);
    const generated = [];

    for (let current = start; current < end; current += block.intervalMinutes) {
      if (current + durationMinutes <= end) {
        generated.push(minutesToTime(current));
      }
    }

    return generated;
  });

  return [...new Set(times)].sort();
}

function getServiceDuration(serviceId) {
  return services.find((service) => service.id === serviceId)?.durationMinutes || 0;
}

function rangesOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function hasReservationOverlap(date, time, professionalId) {
  const newStart = timeToMinutes(time);
  const newEnd = newStart + (state.service?.durationMinutes || 0);

  return reservations.some(
    (reservation) => {
      if (reservation.date !== date || reservation.professionalId !== professionalId) {
        return false;
      }

      const reservedStart = timeToMinutes(reservation.time);
      const reservedDuration =
        reservation.durationMinutes || getServiceDuration(reservation.serviceId);
      const reservedEnd = reservedStart + reservedDuration;
      return rangesOverlap(newStart, newEnd, reservedStart, reservedEnd);
    },
  );
}

function getAvailableTimesForProfessional(professional, date) {
  const schedules = getSchedule(professional, date);
  if (schedules.length === 0) {
    return [];
  }

  return generateTimesFromBlocks(schedules).filter(
    (time) => !hasReservationOverlap(date.date, time, professional.id),
  );
}

function getAvailableProfessionalsForSlot(date, time) {
  return professionals.filter((professional) =>
    getAvailableTimesForProfessional(professional, date).includes(time),
  );
}

function getProfessionalsForService(service) {
  return professionals.filter((professional) => professional.schedules.length > 0);
}

function getAvailableProfessionalsForService(service) {
  const previousService = state.service;
  state.service = service;
  const availableProfessionals = getProfessionalsForService(service).filter(
    (professional) => getAvailableDatesForProfessional(professional).length > 0,
  );
  state.service = previousService;
  return availableProfessionals;
}

function getAvailableDatesForProfessional(professional) {
  return getNextDates()
    .filter((date) => getAvailableTimesForProfessional(professional, date).length > 0);
}

function getAvailableDatesForAnyProfessional() {
  return getNextDates()
    .filter((date) => getAvailableTimesForAnyProfessional(date).length > 0);
}

function getAvailableTimesForAnyProfessional(date) {
  const times = professionals.flatMap((professional) =>
    getAvailableTimesForProfessional(professional, date),
  );

  return [...new Set(times)].sort();
}

function getAvailableDates() {
  if (state.professionalMode === "any") {
    return getAvailableDatesForAnyProfessional();
  }

  return getAvailableDatesForProfessional(state.professional);
}

function getAvailableTimes(date) {
  if (state.professionalMode === "any") {
    return getAvailableTimesForAnyProfessional(date);
  }

  return getAvailableTimesForProfessional(state.professional, date);
}

async function saveReservation() {
  const createdReservation = await createReservation({
    serviceId: state.service.id,
    serviceName: state.service.name,
    professionalId: state.professionalMode === "specific" ? state.professional.id : null,
    date: state.date.date,
    time: state.time,
    customerName: state.customer.name,
    customerPhone: state.customer.phone,
  });

  state.assignedProfessional = {
    id: createdReservation.professionalId,
    name: createdReservation.professionalName,
  };
  if (adminToken) {
    reservations.push(createdReservation);
    renderAdminPanel();
  }
}

async function cancelReservation(id) {
  const index = reservations.findIndex((reservation) => reservation.id === id);
  if (index === -1) {
    return;
  }

  const [removed] = reservations.splice(index, 1);

  try {
    await deleteReservation(id);
    renderAdminPanel();
    addMessage(
      `Admin: se cancelo el turno de ${removed.customerName} con ${removed.professionalName}, ${formatDateLabel(removed.date)} a las ${removed.time}.`,
    );
  } catch (error) {
    reservations.splice(index, 0, removed);
    renderAdminPanel();
    addMessage("No pude cancelar ese turno. Probemos de nuevo en unos segundos.");
  }
}

async function clearReservations() {
  if (reservations.length === 0) {
    return;
  }

  const previousReservations = [...reservations];
  reservations.splice(0, reservations.length);

  try {
    await deleteAllReservations();
    renderAdminPanel();
    addMessage("Admin: se borraron todos los turnos de prueba. Los horarios vuelven a estar disponibles.");
  } catch (error) {
    setReservations(previousReservations);
    renderAdminPanel();
    addMessage("No pude borrar los turnos. Probemos de nuevo en unos segundos.");
  }
}

function renderAdminPanel() {
  if (!businessAvailable) {
    adminCount.textContent = "0";
    clearReservationsButton.disabled = true;
    clearReservationsButton.hidden = true;
    adminList.innerHTML = `
      <div class="empty-admin">
        <strong>Negocio no encontrado</strong>
        <span>Revisa el enlace del negocio.</span>
      </div>
    `;
    return;
  }

  if (!adminToken) {
    adminCount.textContent = "0";
    clearReservationsButton.disabled = true;
    clearReservationsButton.hidden = true;
    adminList.innerHTML = `
      <form class="admin-login" id="admin-login-form">
        <label class="field">
          <span>Email admin</span>
          <input id="admin-email" name="email" type="email" autocomplete="username" placeholder="admin@demo.com" />
        </label>
        <label class="field">
          <span>Contraseña admin</span>
          <input id="admin-password" name="password" type="password" autocomplete="current-password" placeholder="admin123" />
        </label>
        <p class="form-error" id="admin-login-error" role="alert" hidden>Email o contraseña incorrectos.</p>
        <button class="option-button confirm-button" type="submit">Ingresar</button>
      </form>
    `;

    const form = adminList.querySelector("#admin-login-form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const email = String(data.get("email") || "").trim();
      const password = String(data.get("password") || "").trim();
      const error = form.querySelector("#admin-login-error");

      try {
        await adminLogin(email, password);
        await Promise.all([loadReservations(), loadAdminResources(), loadAgenda()]);
        renderAdminPanel();
      } catch (loginError) {
        error.hidden = false;
      }
    });
    return;
  }

  adminCount.textContent = String(reservations.length);
  clearReservationsButton.disabled = reservations.length === 0;
  clearReservationsButton.hidden = false;

  if (reservations.length === 0) {
    adminList.replaceChildren(
      renderAdminManagement(),
      createElementFromHtml(`
        <div class="empty-admin">
          <strong>Sin turnos todavia</strong>
          <span>Cuando alguien confirme una reserva, va a aparecer aca.</span>
        </div>
      `),
    );
    return;
  }

  const dateGroups = groupReservationsByDate();
  adminList.replaceChildren(
    renderAdminManagement(),
    ...[...dateGroups.entries()].map(([date, dateReservations]) => {
      const group = document.createElement("section");
      group.className = "admin-day-group";
      group.innerHTML = `
        <header class="admin-day-header">
          <strong>${escapeHtml(formatDateLabel(date))}</strong>
          <span>${dateReservations.length} turno${dateReservations.length === 1 ? "" : "s"}</span>
        </header>
      `;

      const cards = document.createElement("div");
      cards.className = "admin-day-cards";

      dateReservations.forEach((reservation) => {
        const item = document.createElement("article");
        item.className = "admin-item";
        item.innerHTML = `
          <div class="admin-item-main">
            <div class="admin-time">
              <strong>${escapeHtml(reservation.time)}</strong>
              <span>Confirmado</span>
            </div>
            <div class="admin-details">
              <strong>${escapeHtml(reservation.customerName)}</strong>
              <span>${escapeHtml(reservation.customerPhone)}</span>
              <small>${escapeHtml(reservation.serviceName)} - ${escapeHtml(reservation.professionalName)}</small>
            </div>
          </div>
          <button class="cancel-button" type="button">Cancelar</button>
        `;

        item
          .querySelector(".cancel-button")
          .addEventListener("click", () => cancelReservation(reservation.id));

        cards.appendChild(item);
      });

      group.appendChild(cards);
      return group;
    }),
  );
}

function createElementFromHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function renderAdminManagement() {
  const wrapper = document.createElement("section");
  wrapper.className = "admin-management";
  wrapper.append(
    renderAgendaAdmin(),
    renderServicesAdmin(),
    renderProfessionalsAdmin(),
    renderSchedulesAdmin(),
  );
  return wrapper;
}

function renderAgendaAdmin() {
  const section = createElementFromHtml(`
    <section class="admin-crud-section">
      <h3>Agenda</h3>
      <form class="admin-crud-form" data-action="filter-agenda">
        <input name="date" type="date" value="${escapeHtml(agendaFilters.date)}" />
        <select name="professionalId"></select>
        <select name="serviceId"></select>
        <select name="status"></select>
        <button class="option-button confirm-button" type="submit">Buscar</button>
        <button class="secondary-button" type="button" data-action="export-agenda">Exportar CSV</button>
      </form>
      <div class="agenda-list"></div>
    </section>
  `);
  fillProfessionalSelect(section.querySelector("select[name='professionalId']"), agendaFilters.professionalId, "Todos los profesionales");
  fillServiceSelect(section.querySelector("select[name='serviceId']"), agendaFilters.serviceId);
  fillStatusSelect(section.querySelector("select[name='status']"), agendaFilters.status, "Todos los estados");
  const list = section.querySelector(".agenda-list");

  if (agendaReservations.length === 0) {
    list.innerHTML = `<div class="empty-admin"><strong>Sin turnos para estos filtros</strong></div>`;
  } else {
    agendaReservations.forEach((reservation) => {
      const item = createElementFromHtml(`
        <article class="agenda-item">
          <div>
            <strong>${escapeHtml(formatDateLabel(reservation.date))} ${escapeHtml(reservation.time)}</strong>
            <span>${escapeHtml(reservation.serviceName)} - ${escapeHtml(reservation.professionalName)}</span>
            <small>${escapeHtml(reservation.customerName)} - ${escapeHtml(reservation.customerPhone)}</small>
          </div>
          <select data-action="change-status" data-id="${reservation.id}"></select>
          <button class="secondary-button" type="button" data-action="whatsapp" data-id="${reservation.id}">WhatsApp</button>
          <button class="danger-button" type="button" data-action="cancel-status" data-id="${reservation.id}">Cancelar</button>
        </article>
      `);
      fillStatusSelect(item.querySelector("select"), reservation.status);
      list.appendChild(item);
    });
  }

  section.addEventListener("submit", handleAdminSubmit);
  section.addEventListener("click", handleAdminClick);
  section.addEventListener("change", handleAgendaChange);
  return section;
}

function renderServicesAdmin() {
  const section = createElementFromHtml(`
    <section class="admin-crud-section">
      <h3>Servicios</h3>
      <form class="admin-crud-form" data-action="create-service">
        <input name="id" placeholder="id-servicio" />
        <input name="name" placeholder="Nombre" required />
        <input name="durationMinutes" type="number" min="1" placeholder="Min" required />
        <input name="price" type="number" min="0" step="0.01" placeholder="Precio" />
        <button class="option-button confirm-button" type="submit">Crear</button>
      </form>
      <div class="admin-crud-list"></div>
    </section>
  `);
  const list = section.querySelector(".admin-crud-list");

  adminServices.forEach((service) => {
    const form = createElementFromHtml(`
      <form class="admin-inline-form" data-action="update-service" data-id="${escapeHtml(service.id)}">
        <strong>${escapeHtml(service.id)}</strong>
        <input name="name" value="${escapeHtml(service.name)}" />
        <input name="durationMinutes" type="number" min="1" value="${escapeHtml(service.durationMinutes)}" />
        <input name="price" type="number" min="0" step="0.01" value="${service.price === null ? "" : escapeHtml(service.price)}" />
        <button class="secondary-button" type="submit">Guardar</button>
        <button class="danger-button" type="button" data-action="delete-service" data-id="${escapeHtml(service.id)}">Eliminar</button>
      </form>
    `);
    list.appendChild(form);
  });

  section.addEventListener("submit", handleAdminSubmit);
  section.addEventListener("click", handleAdminClick);
  return section;
}

function renderProfessionalsAdmin() {
  const section = createElementFromHtml(`
    <section class="admin-crud-section">
      <h3>Profesionales</h3>
      <form class="admin-crud-form" data-action="create-professional">
        <input name="name" placeholder="Nombre" required />
        <button class="option-button confirm-button" type="submit">Crear</button>
      </form>
      <div class="admin-crud-list"></div>
    </section>
  `);
  const list = section.querySelector(".admin-crud-list");

  adminProfessionals.forEach((professional) => {
    const form = createElementFromHtml(`
      <form class="admin-inline-form" data-action="update-professional" data-id="${professional.id}">
        <input name="name" value="${escapeHtml(professional.name)}" />
        <button class="secondary-button" type="submit">Guardar</button>
        <button class="danger-button" type="button" data-action="delete-professional" data-id="${professional.id}">Eliminar</button>
      </form>
    `);
    list.appendChild(form);
  });

  section.addEventListener("submit", handleAdminSubmit);
  section.addEventListener("click", handleAdminClick);
  return section;
}

function renderSchedulesAdmin() {
  const section = createElementFromHtml(`
    <section class="admin-crud-section">
      <h3>Horarios</h3>
      <form class="admin-crud-form" data-action="create-schedule">
        <select name="professionalId" required></select>
        <select name="weekday" required></select>
        <input name="startTime" placeholder="09:00" required />
        <input name="endTime" placeholder="17:00" required />
        <input name="intervalMinutes" type="number" min="1" placeholder="Intervalo" required />
        <button class="option-button confirm-button" type="submit">Crear</button>
      </form>
      <div class="admin-crud-list"></div>
    </section>
  `);
  fillProfessionalSelect(section.querySelector("select[name='professionalId']"));
  fillWeekdaySelect(section.querySelector("select[name='weekday']"));
  const list = section.querySelector(".admin-crud-list");

  adminSchedules.forEach((schedule) => {
    const form = createElementFromHtml(`
      <form class="admin-inline-form" data-action="update-schedule" data-id="${schedule.id}">
        <select name="professionalId"></select>
        <select name="weekday"></select>
        <input name="startTime" value="${escapeHtml(schedule.startTime)}" />
        <input name="endTime" value="${escapeHtml(schedule.endTime)}" />
        <input name="intervalMinutes" type="number" min="1" value="${escapeHtml(schedule.intervalMinutes)}" />
        <button class="secondary-button" type="submit">Guardar</button>
        <button class="danger-button" type="button" data-action="delete-schedule" data-id="${schedule.id}">Eliminar</button>
      </form>
    `);
    fillProfessionalSelect(form.querySelector("select[name='professionalId']"), schedule.professionalId);
    fillWeekdaySelect(form.querySelector("select[name='weekday']"), schedule.weekday);
    list.appendChild(form);
  });

  section.addEventListener("submit", handleAdminSubmit);
  section.addEventListener("click", handleAdminClick);
  return section;
}

function fillProfessionalSelect(select, selectedId = "", emptyLabel = "") {
  const emptyOption = emptyLabel ? `<option value="">${escapeHtml(emptyLabel)}</option>` : "";
  select.innerHTML = emptyOption + adminProfessionals
    .map((professional) => `
      <option value="${professional.id}" ${professional.id === Number(selectedId) ? "selected" : ""}>${escapeHtml(professional.name)}</option>
    `)
    .join("");
}

function fillServiceSelect(select, selectedId = "") {
  select.innerHTML = `<option value="">Todos los servicios</option>` + adminServices
    .map((service) => `
      <option value="${escapeHtml(service.id)}" ${service.id === selectedId ? "selected" : ""}>${escapeHtml(service.name)}</option>
    `)
    .join("");
}

function fillWeekdaySelect(select, selectedWeekday = "") {
  select.innerHTML = weekdayLabels
    .map((label, index) => `
      <option value="${index}" ${index === Number(selectedWeekday) ? "selected" : ""}>${escapeHtml(label)}</option>
    `)
    .join("");
}

function fillStatusSelect(select, selectedStatus = "", emptyLabel = "") {
  const emptyOption = emptyLabel ? `<option value="">${escapeHtml(emptyLabel)}</option>` : "";
  select.innerHTML = emptyOption + statusOptions
    .map((status) => `
      <option value="${status}" ${status === selectedStatus ? "selected" : ""}>${escapeHtml(status)}</option>
    `)
    .join("");
}

async function handleAdminSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const action = form.dataset.action;
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    if (action === "filter-agenda") {
      agendaFilters.date = data.date || "";
      agendaFilters.professionalId = data.professionalId || "";
      agendaFilters.serviceId = data.serviceId || "";
      agendaFilters.status = data.status || "";
      await loadAgenda();
      renderAdminPanel();
      return;
    }
    if (action === "create-service") {
      await sendAdminJson(ADMIN_SERVICES_URL, "POST", data);
    }
    if (action === "update-service") {
      await sendAdminJson(`${ADMIN_SERVICES_URL}/${form.dataset.id}`, "PUT", data);
    }
    if (action === "create-professional") {
      await sendAdminJson(ADMIN_PROFESSIONALS_URL, "POST", data);
    }
    if (action === "update-professional") {
      await sendAdminJson(`${ADMIN_PROFESSIONALS_URL}/${form.dataset.id}`, "PUT", data);
    }
    if (action === "create-schedule") {
      await sendAdminJson(ADMIN_SCHEDULES_URL, "POST", data);
    }
    if (action === "update-schedule") {
      await sendAdminJson(`${ADMIN_SCHEDULES_URL}/${form.dataset.id}`, "PUT", data);
    }
    await refreshAdminData();
  } catch (error) {
    addMessage("No pude guardar el cambio admin. Revisemos los datos e intentemos de nuevo.");
  }
}

async function handleAdminClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === "export-agenda") {
    await exportAgendaCsv();
    return;
  }
  if (action === "whatsapp") {
    openReservationWhatsapp(id);
    return;
  }
  if (action === "cancel-status") {
    await updateReservationStatus(id, "cancelado");
    return;
  }

  if (!window.confirm("Confirmas eliminar este elemento?")) {
    return;
  }

  try {
    if (action === "delete-service") {
      await fetchAdminJson(`${ADMIN_SERVICES_URL}/${id}`, { method: "DELETE" });
    }
    if (action === "delete-professional") {
      await fetchAdminJson(`${ADMIN_PROFESSIONALS_URL}/${id}`, { method: "DELETE" });
    }
    if (action === "delete-schedule") {
      await fetchAdminJson(`${ADMIN_SCHEDULES_URL}/${id}`, { method: "DELETE" });
    }
    await refreshAdminData();
  } catch (error) {
    addMessage("No pude eliminar ese elemento. Puede tener reservas asociadas.");
  }
}

async function handleAgendaChange(event) {
  const select = event.target.closest("select[data-action='change-status']");
  if (!select) {
    return;
  }

  await updateReservationStatus(select.dataset.id, select.value);
}

async function updateReservationStatus(id, status) {
  try {
    await sendAdminJson(`${BUSINESS_API_URL}/admin/reservations/${id}/status`, "PATCH", { status });
    await refreshAdminData();
  } catch (error) {
    addMessage("No pude actualizar el estado del turno.");
  }
}

function normalizePhoneForWhatsapp(phone) {
  let digits = String(phone || "").replace(/[\s\-()+]/g, "");
  if (!/^\d+$/.test(digits)) {
    return "";
  }

  if (!digits.startsWith("54")) {
    if (digits.startsWith("0")) {
      digits = digits.slice(1);
    }
    if (digits.startsWith("15")) {
      digits = digits.slice(2);
    }
    digits = `54${digits}`;
  }

  return /^\d{8,15}$/.test(digits) ? digits : "";
}

function openReservationWhatsapp(id) {
  const reservation = agendaReservations.find((item) => item.id === Number(id));
  if (!reservation) {
    addMessage("No encontre ese turno en la agenda.");
    return;
  }

  const phone = normalizePhoneForWhatsapp(reservation.customerPhone);
  if (!phone) {
    addMessage("Ese turno no tiene un telefono valido para WhatsApp.");
    return;
  }

  const message = `Hola ${reservation.customerName}. Tu turno en ${businessName} esta reservado para el ${formatDateLabel(reservation.date)} a las ${reservation.time}. Servicio: ${reservation.serviceName}. Profesional: ${reservation.professionalName}. Si necesitas modificarlo o cancelarlo, comunicate con nosotros.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
}

async function exportAgendaCsv() {
  const query = buildAgendaParams();
  const response = await fetchAdminJson(`${ADMIN_AGENDA_URL}/export.csv${query ? `?${query}` : ""}`);
  if (!response.ok) {
    addMessage("No pude exportar la agenda.");
    return;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `agenda-${agendaFilters.date || "turnos"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderCustomerForm() {
  clearOptions();

  const form = document.createElement("form");
  form.className = "customer-form";
  form.noValidate = true;
  form.innerHTML = `
    <label class="field">
      <span>Nombre</span>
      <input id="customer-name" name="name" type="text" autocomplete="name" placeholder="Ej: Ana Perez" />
    </label>
    <label class="field">
      <span>Telefono</span>
      <input id="customer-phone" name="phone" type="tel" autocomplete="tel" placeholder="Ej: 11 5555 5555" />
    </label>
    <p class="form-error" id="form-error" role="alert" hidden>Completa nombre y telefono para confirmar.</p>
    <button class="option-button confirm-button" type="submit">Confirmar turno</button>
  `;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const error = form.querySelector("#form-error");

    if (!name || !phone) {
      error.hidden = false;
      return;
    }

    state.customer.name = name;
    state.customer.phone = phone;
    addMessage(`${name} - ${phone}`, "user");
    await confirmBooking();
  });

  options.appendChild(form);
  form.querySelector("#customer-name").focus();
}

function startBooking() {
  if (!businessAvailable) {
    renderBusinessNotFound();
    return;
  }

  state.service = null;
  state.professionalMode = null;
  state.professional = null;
  state.assignedProfessional = null;
  state.date = null;
  state.time = null;
  state.customer.name = "";
  state.customer.phone = "";
  chat.replaceChildren();
  restartButton.hidden = true;

  addMessage("Hola, que bueno tenerte por aca. Te ayudo a reservar tu turno en menos de un minuto.");
  addMessage(`Estas reservando en ${businessName}.`);
  addMessage("Para empezar, elegi el servicio que queres reservar.");
  renderOptions(services, selectService);
}

function selectService(service) {
  state.service = service;
  addMessage(service.name, "user");

  const availableProfessionals = getAvailableProfessionalsForService(service);
  if (availableProfessionals.length === 0) {
    addMessage("Por ahora no quedan profesionales con horarios disponibles para ese servicio. Elegi otro y te muestro alternativas.");
    renderOptions(services.filter((item) => item.id !== service.id), selectService);
    return;
  }

  addMessage("Excelente. Ahora elegi un profesional o deja que asignemos cualquiera disponible.");
  renderOptions(
    [
      { label: "Cualquiera disponible", mode: "any" },
      ...availableProfessionals.map((professional) => ({
        ...professional,
        mode: "specific",
      })),
    ],
    selectProfessional,
  );
}

function selectProfessional(selection) {
  state.professionalMode = selection.mode;
  state.professional = selection.mode === "specific" ? selection : null;
  addMessage(selection.label || selection.name, "user");

  const availableDates = getAvailableDates();
  if (availableDates.length === 0) {
    addMessage("No quedan fechas disponibles para esa opcion. Probemos con otro profesional.");
    selectService(state.service);
    return;
  }

  if (state.professionalMode === "any") {
    addMessage("Perfecto, voy a buscar el primer profesional libre para el horario que elijas.");
  } else {
    addMessage(`Perfecto, te muestro solo los horarios disponibles de ${state.professional.name}.`);
  }
  addMessage("Ahora elegi la fecha que mejor te quede.");
  renderOptions(availableDates, selectDate);
}

function selectDate(date) {
  state.date = date;
  addMessage(date.label, "user");
  const availableTimes = getAvailableTimes(date);

  if (availableTimes.length === 0) {
    addMessage("Esa fecha acaba de quedarse sin horarios disponibles. Probemos con otra fecha.");
    renderOptions(getAvailableDates(), selectDate);
    return;
  }

  addMessage(`Perfecto, tengo disponibilidad para el ${date.label}.`);
  addMessage("Estos son los horarios disponibles. Toca el que prefieras.");
  renderOptions(availableTimes, selectTime);
}

function selectTime(time) {
  state.time = time;
  addMessage(time, "user");
  clearOptions();
  addMessage("Buenisimo. Antes de confirmarlo, dejame tus datos de contacto.");
  addMessage("Necesito tu nombre y telefono para identificar la reserva.");
  renderCustomerForm();
}

async function confirmBooking() {
  clearOptions();
  const availableForSlot =
    state.professionalMode === "any"
      ? getAvailableProfessionalsForSlot(state.date, state.time)
      : getAvailableTimesForProfessional(state.professional, state.date).includes(state.time)
        ? [state.professional]
        : [];

  if (availableForSlot.length === 0) {
    addMessage("Ese horario ya fue tomado. Te muestro las opciones que quedan disponibles.");
    const availableTimes = getAvailableTimes(state.date);
    if (availableTimes.length > 0) {
      renderOptions(availableTimes, selectTime);
    } else {
      renderOptions(getAvailableDates(), selectDate);
    }
    return;
  }

  try {
    await saveReservation();
  } catch (error) {
    if (error.message === "reserved") {
      addMessage("Ese horario acaba de ser reservado. Te muestro las opciones que quedan disponibles.");
      await loadReservations();
      renderAdminPanel();
      const availableTimes = getAvailableTimes(state.date);
      if (availableTimes.length > 0) {
        renderOptions(availableTimes, selectTime);
      } else {
        renderOptions(getAvailableDates(), selectDate);
      }
      return;
    }

    addMessage("No pude confirmar el turno en este momento. Probemos de nuevo en unos segundos.");
    renderCustomerForm();
    return;
  }

  addMessage(`Perfecto, el turno quedo asignado con ${state.assignedProfessional.name}.`);
  addMessage("Te dejo el resumen para que lo tengas claro.");
  addSummary();
  restartButton.hidden = false;
}

restartButton.addEventListener("click", startBooking);
clearReservationsButton.addEventListener("click", clearReservations);

async function initApp() {
  try {
    const loadedBusiness = await loadBusiness();
    if (!loadedBusiness) {
      return;
    }
    await Promise.all([loadServices(), loadProfessionals()]);
    if (adminToken) {
      await Promise.all([loadReservations(), loadAdminResources(), loadAgenda()]);
    }
  } catch (error) {
    console.warn("No se pudieron cargar los datos iniciales.", error);
    addMessage("No pude cargar los datos del servidor. Revisemos que el backend este activo.");
  }

  renderAdminPanel();
  startBooking();
}

initApp();
