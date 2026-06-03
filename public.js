const root = document.querySelector("#wizard-root");
const progress = document.querySelector("#wizard-progress");
const businessNameElement = document.querySelector("#business-name");
const businessMetaElement = document.querySelector("#business-meta");
const businessAvatarElement = document.querySelector("#business-avatar");
const businessLocationPillElement = document.querySelector("#business-location-pill");
const assistantTitleElement = document.querySelector("#assistant-title");
const assistantMessageElement = document.querySelector("#assistant-message");
const cancelSearchForm = document.querySelector("#cancel-search-form");
const cancelSearchError = document.querySelector("#cancel-search-error");
const cancelSearchResults = document.querySelector("#cancel-search-results");

const parts = window.location.pathname.split("/").filter(Boolean);
const BUSINESS_SLUG = parts[0] || "demo";
const BUSINESS_API_URL = `/api/businesses/${BUSINESS_SLUG}`;

const weekdayLabels = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
const BUSINESS_TIME_ZONE = "America/Argentina/Buenos_Aires";
const services = [];
const professionals = [];
let businessName = "Momentia";
let businessPhone = "";
let businessAddress = "";
let businessPaymentAlias = "";

const state = {
  step: 1,
  service: null,
  professionalMode: null,
  professional: null,
  date: null,
  time: null,
  customerName: "",
  customerPhone: "",
  assignedProfessionalName: "",
  cancelUrl: "",
};

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

function getArgentinaNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function filterExpiredTimesForDate(times, date) {
  const now = getArgentinaNowParts();
  if (!date || date.date !== now.date) return times;
  return times.filter((time) => timeToMinutes(time) > now.minutes);
}

function formatDateLabel(value) {
  const date = parseIsoDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${weekdayLabels[date.getDay()]} ${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getNextDates(days = 14) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + index);
    const iso = toIsoDate(date);
    return { date: iso, label: formatDateLabel(iso), weekday: date.getDay() };
  });
}

function normalizeService(service) {
  return {
    id: String(service.id || ""),
    name: String(service.name || ""),
    durationMinutes: Number(service.durationMinutes) || 0,
    price: service.price === null || service.price === undefined ? null : Number(service.price),
    requiresDeposit: Boolean(service.requiresDeposit),
    depositAmount: Number(service.depositAmount) || 0,
    paymentInstructions: String(service.paymentInstructions || ""),
  };
}

function servicePaymentInstructions(service) {
  if (service.paymentInstructions) return service.paymentInstructions;
  if (service.requiresDeposit && businessPaymentAlias) {
    return `Transferi la sena al alias: ${businessPaymentAlias}`;
  }
  return "";
}

function normalizeProfessional(professional) {
  return {
    id: Number(professional.id) || 0,
    name: String(professional.name || ""),
    schedules: Array.isArray(professional.schedules)
      ? professional.schedules.map((schedule) => ({
          weekday: Number(schedule.weekday),
          startTime: String(schedule.startTime || ""),
          endTime: String(schedule.endTime || ""),
          intervalMinutes: Number(schedule.intervalMinutes) || 0,
        }))
      : [],
  };
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function getSchedule(professional, date) {
  return professional.schedules.filter((schedule) => schedule.weekday === date.weekday);
}

function generateTimesFromBlocks(blocks) {
  const duration = state.service?.durationMinutes || 0;
  return [...new Set(blocks.flatMap((block) => {
    if (!block.startTime || !block.endTime || block.intervalMinutes <= 0) return [];
    const times = [];
    const start = timeToMinutes(block.startTime);
    const end = timeToMinutes(block.endTime);
    for (let current = start; current < end; current += block.intervalMinutes) {
      if (current + duration <= end) times.push(minutesToTime(current));
    }
    return times;
  }))].sort();
}

function getAvailableTimesForProfessional(professional, date) {
  return generateTimesFromBlocks(getSchedule(professional, date));
}

function getAvailableTimesForAny(date) {
  return [...new Set(professionals.flatMap((professional) => getAvailableTimesForProfessional(professional, date)))].sort();
}

function getAvailableTimes(date) {
  const times = getRawAvailableTimes(date);
  return filterExpiredTimesForDate(times, date);
}

function getRawAvailableTimes(date) {
  return state.professionalMode === "any"
    ? getAvailableTimesForAny(date)
    : getAvailableTimesForProfessional(state.professional, date);
}

function getAvailableDates() {
  return getNextDates().filter((date) => getAvailableTimes(date).length > 0);
}

function getProfessionalsForService() {
  return professionals.filter((professional) => professional.schedules.length > 0);
}

function formatPrice(price) {
  if (price === null || Number.isNaN(price)) return "";
  return `$${price.toLocaleString("es-AR")}`;
}

function getInitials(name) {
  return String(name || "M")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "M";
}

function serviceMetaLabel(service) {
  const parts = [];
  if (service.durationMinutes) parts.push(`${service.durationMinutes} min`);
  parts.push(service.requiresDeposit ? "Requiere sena" : "Sin sena");
  return parts.join(" · ");
}

function statusLabel(status) {
  const labels = {
    pendiente: "Pendiente de sena",
    reservado: "Reservado",
    confirmado: "Confirmado",
    cancelado: "Cancelado",
    asistio: "Asistio",
    no_asistio: "No asistio",
  };
  return labels[status] || status;
}

function renderCancelResults(reservations, customerName, customerPhone) {
  if (!cancelSearchResults) return;
  if (reservations.length === 0) {
    cancelSearchResults.innerHTML = `
      <div class="admin-empty">
        <strong>No encontramos un turno activo con esos datos.</strong>
        <p>Revisa el nombre y telefono ingresados o comunicate directamente con el negocio.</p>
      </div>
    `;
    return;
  }

  cancelSearchResults.innerHTML = reservations.map((reservation) => `
    <article class="agenda-row cancel-result-card">
      <div>
        <strong>${escapeHtml(reservation.serviceName)} con ${escapeHtml(reservation.professionalName)}</strong>
        <span>${escapeHtml(formatDateLabel(reservation.date))} a las ${escapeHtml(reservation.time)}</span>
        <small>${escapeHtml(statusLabel(reservation.status))}</small>
        ${reservation.depositWarning ? `<p class="deposit-note">Este turno tiene sena registrada. Si cancelas con menos de 24 horas de anticipacion, la sena podria no ser reintegrable segun la politica del negocio.</p>` : ""}
      </div>
      <button class="danger-button" type="button" data-public-cancel="${reservation.id}" data-name="${escapeHtml(customerName)}" data-phone="${escapeHtml(customerPhone)}" ${reservation.canCancel ? "" : "disabled"}>Cancelar turno</button>
    </article>
  `).join("");
}

function setStep(step) {
  state.step = step;
  render();
}

function renderProgress() {
  const labels = ["Servicio", "Profesional", "Horario", "Datos"];
  progress.innerHTML = labels
    .map((label, index) => {
      const step = index + 1;
      const className = step < state.step ? "done" : step === state.step ? "active" : "pending";
      return `<span class="${className}"><b>${step < state.step ? "OK" : step}</b><small>${label}</small></span>`;
    })
    .join("");
}

function renderLayout(title, subtitle, assistantMessage, content) {
  renderProgress();
  assistantMessageElement.textContent = assistantMessage;
  root.innerHTML = `
    <div class="wizard-step">
      <div class="step-copy">
        <p>Paso ${state.step} de 4</p>
        <h2>${escapeHtml(title)}</h2>
        <span>${escapeHtml(subtitle)}</span>
      </div>
      ${content}
    </div>
  `;
}

function renderServices() {
  renderLayout(
    "Reserva tu turno",
    "Elegi el servicio que queres realizar. Te mostraremos los horarios disponibles.",
    "Primero elegi que necesitas.",
    `<div class="choice-grid service-grid">${services.map((service) => `
      <button class="choice-card service-card" type="button" data-service="${escapeHtml(service.id)}">
        <span class="choice-avatar">${escapeHtml(service.name.charAt(0) || "S")}</span>
        <span class="choice-main">
          <strong>${escapeHtml(service.name)}</strong>
          <small>${escapeHtml(serviceMetaLabel(service))}</small>
          ${service.requiresDeposit ? `<em class="deposit-note">Sena: ${escapeHtml(formatPrice(service.depositAmount))}</em>` : ""}
        </span>
        <span class="choice-side">
          ${service.price !== null ? `<strong>${escapeHtml(formatPrice(service.price))}</strong>` : `<strong>Consultar</strong>`}
          <small>Elegir</small>
        </span>
      </button>
    `).join("")}</div>`,
  );
}

function renderProfessionals() {
  const available = getProfessionalsForService();
  renderLayout(
    "Elegi tu profesional",
    "Podes reservar con alguien especifico o dejar que te asignemos el primer horario disponible.",
    "Podes elegir un profesional o dejar que el sistema busque uno disponible.",
    `<div class="choice-grid professional-grid">
      <button class="choice-card professional-card" type="button" data-professional-mode="any">
        <span class="pro-avatar any">+</span>
        <span class="choice-main">
          <strong>Cualquiera disponible</strong>
          <small>Primer profesional libre</small>
        </span>
      </button>
      ${available.map((professional) => `
        <button class="choice-card professional-card" type="button" data-professional="${professional.id}">
          <span class="pro-avatar">${escapeHtml(getInitials(professional.name))}</span>
          <span class="choice-main">
            <strong>${escapeHtml(professional.name)}</strong>
            <small>Ver horarios disponibles</small>
          </span>
        </button>
      `).join("")}
    </div>
    <button class="text-button" type="button" data-back="1">Volver</button>`,
  );
}

function renderDateTime() {
  const dates = getAvailableDates();
  const times = state.date ? getAvailableTimes(state.date) : [];
  const today = getArgentinaNowParts().date;
  const todayDate = getNextDates(1)[0];
  const todayExpired = todayDate.date === today
    && getRawAvailableTimes(todayDate).length > 0
    && getAvailableTimes(todayDate).length === 0;
  const selectedTodayWithoutTimes = state.date?.date === today && times.length === 0;
  renderLayout(
    "Cuando te queda comodo?",
    "Selecciona el dia y horario que prefieras.",
    "Estos son los horarios libres para vos.",
    `<div class="calendar-panel">
      <div class="calendar-title">Proximos dias disponibles</div>
      <div class="date-strip">
      ${dates.map((date) => `
        <button class="${state.date?.date === date.date ? "selected" : ""}" type="button" data-date="${date.date}">
          <small>${escapeHtml(date.label.split(" ")[0])}</small>
          <strong>${escapeHtml(date.label.replace(/^[^ ]+\s/, ""))}</strong>
        </button>
      `).join("") || "<p>No hay fechas disponibles por ahora.</p>"}
      </div>
    </div>
    ${todayExpired && !selectedTodayWithoutTimes ? `<p class="time-empty-message">No quedan horarios disponibles para hoy. Elegi otra fecha para reservar.</p>` : ""}
    <div class="time-title">${state.date ? `Horarios para ${escapeHtml(state.date.label)}` : "Elegi un dia para ver horarios"}</div>
    <div class="time-grid">
      ${times.map((time) => `<button type="button" data-time="${time}">${time}</button>`).join("")}
    </div>
    ${selectedTodayWithoutTimes ? `<p class="time-empty-message">No quedan horarios disponibles para hoy. Elegi otra fecha para reservar.</p>` : ""}
    <button class="text-button" type="button" data-back="2">Volver</button>`,
  );
}

function renderCustomer() {
  const professionalName = state.professionalMode === "any" ? "Cualquiera disponible" : state.professional.name;
  const paymentInstructions = servicePaymentInstructions(state.service);
  const depositInfo = state.service.requiresDeposit
    ? `<div class="deposit-box">
        <strong>Este servicio requiere una sena para confirmar la reserva.</strong>
        <span>Monto de sena: ${escapeHtml(formatPrice(state.service.depositAmount))}</span>
        ${paymentInstructions ? `<span>${escapeHtml(paymentInstructions)}</span>` : ""}
        <small>Una vez realizada la reserva te enviaremos los datos de pago por WhatsApp. Tu turno quedara pendiente hasta registrar la sena.</small>
      </div>`
    : "";
  renderLayout(
    "Ya casi terminamos",
    "Dejanos tus datos para confirmar la reserva",
    "Dejanos tus datos para confirmar el turno.",
    `<form class="wizard-form" id="booking-form">
      <label>
        <span>Como te llamas?</span>
        <input name="name" autocomplete="name" value="${escapeHtml(state.customerName)}" required />
      </label>
      <label>
        <span>A que WhatsApp te confirmamos el turno?</span>
        <input name="phone" type="tel" autocomplete="tel" value="${escapeHtml(state.customerPhone)}" required />
      </label>
      <div class="summary-box">
        <strong>Resumen</strong>
        <span><b>Servicio</b> ${escapeHtml(state.service.name)}</span>
        <span><b>Profesional</b> ${escapeHtml(professionalName)}</span>
        <span><b>Fecha</b> ${escapeHtml(state.date.label)} a las ${escapeHtml(state.time)}</span>
        ${state.service.price !== null ? `<span><b>Precio</b> ${escapeHtml(formatPrice(state.service.price))}</span>` : ""}
      </div>
      ${depositInfo}
      <p class="form-error" id="form-error" hidden>Completa nombre y telefono para confirmar.</p>
      <button class="primary-button" type="submit">Confirmar turno</button>
      <button class="text-button" type="button" data-back="3">Volver</button>
    </form>`,
  );
}

function renderSuccess() {
  const paymentInstructions = servicePaymentInstructions(state.service);
  const depositMessage = `Hola, hice una reserva en ${businessName} para el dia ${state.date.label} a las ${state.time}. Te envio el comprobante de la sena.`;
  const whatsappLink = buildWhatsappLink(businessPhone, depositMessage, "3549");
  if (state.service.requiresDeposit) {
    progress.innerHTML = "";
    root.innerHTML = `
      <div class="success-screen">
        <div class="success-icon">OK</div>
        <p>Reserva recibida</p>
        <h2>Tu turno quedo registrado</h2>
        <span>Ahora te enviaremos por WhatsApp la informacion necesaria para completar la sena y confirmar la reserva.</span>
        <div class="summary-box">
          <strong>${escapeHtml(businessName)}</strong>
          <span>Servicio: ${escapeHtml(state.service.name)}</span>
          <span>Profesional: ${escapeHtml(state.assignedProfessionalName)}</span>
          <span>Fecha: ${escapeHtml(state.date.label)}</span>
          <span>Horario: ${escapeHtml(state.time)}</span>
          <span>Sena: ${escapeHtml(formatPrice(state.service.depositAmount))}</span>
          ${paymentInstructions ? `<span>${escapeHtml(paymentInstructions)}</span>` : ""}
        </div>
        ${whatsappLink ? `<a class="primary-button link-button whatsapp-button" href="${whatsappLink}" target="_blank" rel="noopener">Escribir al negocio</a>` : ""}
        ${state.cancelUrl ? `<a class="text-button link-button" href="${escapeHtml(state.cancelUrl)}">Cancelar turno</a>` : ""}
        <button class="primary-button" type="button" data-restart>Reservar otro turno</button>
      </div>
    `;
    return;
  }

  progress.innerHTML = "";
  root.innerHTML = `
    <div class="success-screen">
      <div class="success-icon">OK</div>
      <p>Listo</p>
      <h2>Tu turno quedo registrado correctamente</h2>
      <span>En unos instantes recibiras la confirmacion por WhatsApp con todos los detalles. Te esperamos.</span>
      <div class="summary-box">
        <strong>${escapeHtml(businessName)}</strong>
        <span>Servicio: ${escapeHtml(state.service.name)}</span>
        <span>Profesional: ${escapeHtml(state.assignedProfessionalName)}</span>
        <span>Fecha: ${escapeHtml(state.date.label)}</span>
        <span>Horario: ${escapeHtml(state.time)}</span>
        <span>${escapeHtml(state.customerName)} - ${escapeHtml(state.customerPhone)}</span>
      </div>
      ${businessPhone ? `<a class="primary-button link-button whatsapp-button" href="${buildWhatsappLink(businessPhone, `Hola, tengo una reserva en ${businessName} para el dia ${state.date.label} a las ${state.time}.`, "3549")}" target="_blank" rel="noopener">Escribir al negocio</a>` : ""}
      ${state.cancelUrl ? `<a class="text-button link-button" href="${escapeHtml(state.cancelUrl)}">Cancelar turno</a>` : ""}
      <button class="primary-button" type="button" data-restart>Reservar otro turno</button>
    </div>
  `;
}

function renderNotFound() {
  progress.innerHTML = "";
  businessNameElement.textContent = "Negocio no encontrado";
  businessMetaElement.hidden = true;
  root.innerHTML = `
    <div class="success-screen">
      <h2>Negocio no encontrado</h2>
      <span>Revisa el enlace o pedi uno nuevo al negocio.</span>
    </div>
  `;
}

function render() {
  if (state.step === 1) renderServices();
  if (state.step === 2) renderProfessionals();
  if (state.step === 3) renderDateTime();
  if (state.step === 4) renderCustomer();
}

async function confirmBooking() {
  const response = await fetch(`${BUSINESS_API_URL}/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serviceId: state.service.id,
      professionalId: state.professionalMode === "specific" ? state.professional.id : null,
      date: state.date.date,
      time: state.time,
      customerName: state.customerName,
      customerPhone: state.customerPhone,
    }),
  });

  if (response.status === 409) {
    throw new Error("reserved");
  }
  if (!response.ok) {
    throw new Error("failed");
  }

  const reservation = await response.json();
  state.assignedProfessionalName = reservation.professionalName || state.professional?.name || "Profesional asignado";
  state.cancelUrl = reservation.cancelToken ? `/${BUSINESS_SLUG}/cancelar/${reservation.cancelToken}` : "";
}

root.addEventListener("click", (event) => {
  const serviceButton = event.target.closest("[data-service]");
  const professionalButton = event.target.closest("[data-professional], [data-professional-mode]");
  const dateButton = event.target.closest("[data-date]");
  const timeButton = event.target.closest("[data-time]");
  const backButton = event.target.closest("[data-back]");
  const restartButton = event.target.closest("[data-restart]");

  if (serviceButton) {
    state.service = services.find((service) => service.id === serviceButton.dataset.service);
    state.date = null;
    state.time = null;
    setStep(2);
  }
  if (professionalButton) {
    state.professionalMode = professionalButton.dataset.professionalMode || "specific";
    state.professional = state.professionalMode === "specific"
      ? professionals.find((professional) => professional.id === Number(professionalButton.dataset.professional))
      : null;
    state.date = null;
    state.time = null;
    setStep(3);
  }
  if (dateButton) {
    state.date = getAvailableDates().find((date) => date.date === dateButton.dataset.date);
    state.time = null;
    renderDateTime();
  }
  if (timeButton) {
    state.time = timeButton.dataset.time;
    setStep(4);
  }
  if (backButton) setStep(Number(backButton.dataset.back));
  if (restartButton) {
    Object.assign(state, {
      step: 1,
      service: null,
      professionalMode: null,
      professional: null,
      date: null,
      time: null,
      customerName: "",
      customerPhone: "",
      assignedProfessionalName: "",
      cancelUrl: "",
    });
    render();
  }
});

root.addEventListener("submit", async (event) => {
  if (event.target.id !== "booking-form") return;
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  state.customerName = String(data.get("name") || "").trim();
  state.customerPhone = String(data.get("phone") || "").trim();

  if (!state.customerName || !state.customerPhone) {
    form.querySelector("#form-error").hidden = false;
    return;
  }
  if (typeof normalizePhone === "function") {
    const phone = normalizePhone(state.customerPhone);
    if (!phone.ok) {
      const error = form.querySelector("#form-error");
      error.hidden = false;
      error.textContent = phone.error === "missing_area_code"
        ? "Ingresa el numero con codigo de area. Ejemplo: 3549432877."
        : "Ingresa un WhatsApp valido.";
      return;
    }
    state.customerPhone = phone.normalized;
  }

  try {
    await confirmBooking();
    renderSuccess();
  } catch (error) {
    form.querySelector("#form-error").hidden = false;
    form.querySelector("#form-error").textContent =
      error.message === "reserved"
        ? "Ese horario acaba de ocuparse. Volve y elegi otro horario."
        : "No pudimos confirmar el turno. Intenta otra vez.";
  }
});

if (cancelSearchForm) {
  cancelSearchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(cancelSearchForm);
    const customerName = String(data.get("name") || "").trim();
    const customerPhoneInput = String(data.get("phone") || "").trim();
    const phone = typeof normalizePhone === "function"
      ? normalizePhone(customerPhoneInput)
      : { ok: true, normalized: customerPhoneInput };

    cancelSearchError.hidden = true;
    cancelSearchError.textContent = "";
    cancelSearchResults.innerHTML = "";

    if (!customerName || !phone.ok) {
      cancelSearchError.hidden = false;
      cancelSearchError.textContent = phone.error === "missing_area_code"
        ? "Ingresa el numero con codigo de area. Ejemplo: 3549432877."
        : "Ingresa nombre y WhatsApp validos.";
      return;
    }

    const response = await fetch(`${BUSINESS_API_URL}/cancellations/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerName, customerPhone: phone.normalized }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      cancelSearchError.hidden = false;
      cancelSearchError.textContent = payload.error || "No pudimos buscar tus turnos.";
      return;
    }

    renderCancelResults(payload.reservations || [], customerName, phone.normalized);
  });
}

if (cancelSearchResults) {
  cancelSearchResults.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-public-cancel]");
    if (!button) return;
    if (!window.confirm("Confirmas que queres cancelar este turno?")) return;

    const response = await fetch(`${BUSINESS_API_URL}/cancellations/${button.dataset.publicCancel}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: button.dataset.name,
        customerPhone: button.dataset.phone,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(payload.error || "No pudimos cancelar el turno.");
      return;
    }

    cancelSearchResults.innerHTML = `<div class="success-screen"><h2>Tu turno fue cancelado correctamente.</h2><span>Gracias por avisarnos con anticipacion.</span></div>`;
  });
}

async function init() {
  try {
    const businessResponse = await fetch(BUSINESS_API_URL);
    if (businessResponse.status === 404) {
      renderNotFound();
      return;
    }
    const business = await businessResponse.json();
    businessName = business.name || "Momentia";
    businessPhone = business.phone || business.whatsapp || "";
    businessAddress = business.address || "";
    businessPaymentAlias = business.paymentAlias || business.payment_alias || "";
    businessNameElement.textContent = businessName;
    if (businessAvatarElement) businessAvatarElement.textContent = getInitials(businessName);
    assistantTitleElement.textContent = `Hola, soy el asistente de turnos de ${businessName}.`;
    assistantMessageElement.textContent = "Te ayudo a reservar en pocos pasos.";
    const meta = [business.category, business.city, businessAddress].filter(Boolean).join(" - ");
    businessMetaElement.textContent = meta;
    businessMetaElement.hidden = !meta;
    if (businessLocationPillElement) {
      const location = businessAddress || business.city || "";
      businessLocationPillElement.textContent = location ? location : "";
      businessLocationPillElement.hidden = !location;
    }
    document.title = `${businessName} - Reservar turno`;

    const [servicesResponse, professionalsResponse] = await Promise.all([
      fetch(`${BUSINESS_API_URL}/services`),
      fetch(`${BUSINESS_API_URL}/professionals`),
    ]);
    services.splice(0, services.length, ...(await servicesResponse.json()).map(normalizeService));
    professionals.splice(0, professionals.length, ...(await professionalsResponse.json()).map(normalizeProfessional));
    render();
  } catch (error) {
    root.innerHTML = `<div class="success-screen"><h2>No pudimos cargar los turnos</h2><span>Intenta nuevamente en unos minutos.</span></div>`;
  }
}

init();
