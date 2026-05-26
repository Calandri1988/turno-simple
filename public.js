const root = document.querySelector("#wizard-root");
const progress = document.querySelector("#wizard-progress");
const businessNameElement = document.querySelector("#business-name");
const businessMetaElement = document.querySelector("#business-meta");
const assistantTitleElement = document.querySelector("#assistant-title");
const assistantMessageElement = document.querySelector("#assistant-message");

const parts = window.location.pathname.split("/").filter(Boolean);
const BUSINESS_SLUG = parts[0] || "demo";
const BUSINESS_API_URL = `/api/businesses/${BUSINESS_SLUG}`;

const weekdayLabels = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
const services = [];
const professionals = [];
let businessName = "Turno Simple";
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
    return `Transferi la seña al alias: ${businessPaymentAlias}`;
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

function setStep(step) {
  state.step = step;
  render();
}

function renderProgress() {
  progress.innerHTML = [1, 2, 3, 4]
    .map((step) => `<span class="${step <= state.step ? "active" : ""}">${step}</span>`)
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
    "Reserva tu turno en pocos pasos",
    "Elegi el servicio que necesitas",
    "Primero elegi que necesitas.",
    `<div class="choice-grid">${services.map((service) => `
      <button class="choice-card" type="button" data-service="${escapeHtml(service.id)}">
        <strong>${escapeHtml(service.name)}</strong>
        <span>${service.durationMinutes ? `${service.durationMinutes} min` : "Duracion a confirmar"}</span>
        ${service.price !== null ? `<small>${escapeHtml(formatPrice(service.price))}</small>` : ""}
        ${service.requiresDeposit ? `<small class="deposit-note">Requiere seña</small>` : ""}
      </button>
    `).join("")}</div>`,
  );
}

function renderProfessionals() {
  const available = getProfessionalsForService();
  renderLayout(
    "Ahora elegi con quien queres atenderte",
    "Tambien podes elegir cualquiera disponible",
    "Podes elegir un profesional o dejar que el sistema busque uno disponible.",
    `<div class="choice-grid">
      <button class="choice-card" type="button" data-professional-mode="any">
        <strong>Cualquiera disponible</strong>
        <span>Asignamos automaticamente un profesional libre.</span>
      </button>
      ${available.map((professional) => `
        <button class="choice-card" type="button" data-professional="${professional.id}">
          <strong>${escapeHtml(professional.name)}</strong>
          <span>Ver sus horarios disponibles</span>
        </button>
      `).join("")}
    </div>
    <button class="text-button" type="button" data-back="1">Volver</button>`,
  );
}

function renderDateTime() {
  const dates = getAvailableDates();
  const times = state.date ? getAvailableTimes(state.date) : [];
  renderLayout(
    "Estos son los horarios disponibles",
    "Elegi una fecha y despues el horario que prefieras",
    "Estos son los horarios libres para vos.",
    `<div class="date-strip">
      ${dates.map((date) => `
        <button class="${state.date?.date === date.date ? "selected" : ""}" type="button" data-date="${date.date}">
          ${escapeHtml(date.label)}
        </button>
      `).join("") || "<p>No hay fechas disponibles por ahora.</p>"}
    </div>
    <div class="time-grid">
      ${times.map((time) => `<button type="button" data-time="${time}">${time}</button>`).join("")}
    </div>
    <button class="text-button" type="button" data-back="2">Volver</button>`,
  );
}

function renderCustomer() {
  const professionalName = state.professionalMode === "any" ? "Cualquiera disponible" : state.professional.name;
  const paymentInstructions = servicePaymentInstructions(state.service);
  const depositInfo = state.service.requiresDeposit
    ? `<div class="deposit-box">
        <strong>Este turno requiere una seña para quedar confirmado.</strong>
        <span>Seña: ${escapeHtml(formatPrice(state.service.depositAmount))}</span>
        ${paymentInstructions ? `<span>${escapeHtml(paymentInstructions)}</span>` : ""}
        <small>Tu turno quedara pendiente hasta que el negocio confirme la recepcion.</small>
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
        <span>${escapeHtml(state.service.name)} con ${escapeHtml(professionalName)}</span>
        <span>${escapeHtml(state.date.label)} a las ${escapeHtml(state.time)}</span>
        <span>${escapeHtml(state.customerName || "Tu nombre")} - ${escapeHtml(state.customerPhone || "Tu WhatsApp")}</span>
      </div>
      ${depositInfo}
      <p class="form-error" id="form-error" hidden>Completa nombre y telefono para confirmar.</p>
      <button class="primary-button" type="submit">Confirmar turno</button>
      <button class="text-button" type="button" data-back="3">Volver</button>
    </form>`,
  );
}

function renderSuccess() {
  const phone = normalizePhoneForWhatsapp(businessPhone);
  const paymentInstructions = servicePaymentInstructions(state.service);
  const depositMessage = `Hola, hice una reserva en ${businessName} para el dia ${state.date.label} a las ${state.time}. Te envio el comprobante de la seña.`;
  if (state.service.requiresDeposit) {
    progress.innerHTML = "";
    root.innerHTML = `
      <div class="success-screen">
        <p>Pendiente</p>
        <h2>Tu turno quedo pendiente de confirmacion</h2>
        <span>Para confirmarlo, envia el comprobante al negocio.</span>
        <div class="summary-box">
          <strong>${escapeHtml(state.service.name)}</strong>
          <span>${escapeHtml(state.assignedProfessionalName)} - ${escapeHtml(state.date.label)} ${escapeHtml(state.time)}</span>
          <span>Seña: ${escapeHtml(formatPrice(state.service.depositAmount))}</span>
          ${paymentInstructions ? `<span>${escapeHtml(paymentInstructions)}</span>` : ""}
        </div>
        ${phone ? `<a class="primary-button link-button" href="https://wa.me/${phone}?text=${encodeURIComponent(depositMessage)}" target="_blank" rel="noopener">Enviar comprobante por WhatsApp</a>` : ""}
        <button class="primary-button" type="button" data-restart>Reservar otro turno</button>
      </div>
    `;
    return;
  }

  progress.innerHTML = "";
  root.innerHTML = `
    <div class="success-screen">
      <p>Listo</p>
      <h2>Tu turno quedo reservado</h2>
      <span>Te esperamos en ${escapeHtml(businessName)}.</span>
      <div class="summary-box">
        <strong>${escapeHtml(state.service.name)}</strong>
        <span>${escapeHtml(state.assignedProfessionalName)} - ${escapeHtml(state.date.label)} ${escapeHtml(state.time)}</span>
        <span>${escapeHtml(state.customerName)} - ${escapeHtml(state.customerPhone)}</span>
      </div>
      <button class="primary-button" type="button" data-restart>Reservar otro turno</button>
    </div>
  `;
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

async function init() {
  try {
    const businessResponse = await fetch(BUSINESS_API_URL);
    if (businessResponse.status === 404) {
      renderNotFound();
      return;
    }
    const business = await businessResponse.json();
    businessName = business.name || "Turno Simple";
    businessPhone = business.phone || business.whatsapp || "";
    businessAddress = business.address || "";
    businessPaymentAlias = business.paymentAlias || business.payment_alias || "";
    businessNameElement.textContent = businessName;
    assistantTitleElement.textContent = `Hola, soy el asistente de turnos de ${businessName}.`;
    assistantMessageElement.textContent = "Te ayudo a reservar en pocos pasos.";
    const meta = [business.category, business.city, businessAddress].filter(Boolean).join(" - ");
    businessMetaElement.textContent = meta;
    businessMetaElement.hidden = !meta;
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
