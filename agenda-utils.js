(function initAgendaUtils(root) {
  function compareAgendaItems(a, b) {
    return String(a.time || "").localeCompare(String(b.time || ""))
      || String(a.professionalName || "").localeCompare(String(b.professionalName || ""))
      || String(a.customerName || "").localeCompare(String(b.customerName || ""));
  }

  function sortAgendaByTime(items) {
    return [...items].sort(compareAgendaItems);
  }

  function filterAgendaItems(items, filters = {}) {
    const date = String(filters.date || "");
    const professionalId = filters.professionalId ? Number(filters.professionalId) : 0;
    return items.filter((item) => {
      if (date && item.date !== date) return false;
      if (professionalId && Number(item.professionalId) !== professionalId) return false;
      return true;
    });
  }

  function groupAgendaByProfessional(items) {
    const grouped = new Map();
    for (const item of sortAgendaByTime(items)) {
      const id = Number(item.professionalId) || 0;
      const name = String(item.professionalName || "Profesional");
      if (!grouped.has(id)) grouped.set(id, { id, name, items: [] });
      grouped.get(id).items.push(item);
    }
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function buildProfessionalDaySummary(professionalName, dateLabel, items) {
    const lines = [
      `Turnos de ${professionalName || "Profesional"}`,
      dateLabel || "",
      "",
    ];

    for (const item of sortAgendaByTime(items)) {
      lines.push(`${item.time} - ${item.customerName}`);
      lines.push(item.serviceName);
      lines.push("");
    }

    lines.push("-------------");
    return lines.join("\n").trimEnd();
  }

  root.sortAgendaByTime = sortAgendaByTime;
  root.filterAgendaItems = filterAgendaItems;
  root.groupAgendaByProfessional = groupAgendaByProfessional;
  root.buildProfessionalDaySummary = buildProfessionalDaySummary;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      sortAgendaByTime,
      filterAgendaItems,
      groupAgendaByProfessional,
      buildProfessionalDaySummary,
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
