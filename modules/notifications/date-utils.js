function buildBookingDateTime(date, time) {
  const dateText = String(date || "").slice(0, 10);
  const timeText = String(time || "").slice(0, 5);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) {
    throw new Error("Invalid booking date or time");
  }

  const [year, month, day] = dateText.split("-").map(Number);
  const [hours, minutes] = timeText.split(":").map(Number);
  const value = new Date(year, month - 1, day, hours, minutes, 0, 0);

  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hours ||
    value.getMinutes() !== minutes
  ) {
    throw new Error("Invalid booking date or time");
  }

  return value;
}

function subtractHours(date, hours) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) {
    throw new Error("Invalid date");
  }
  return new Date(value.getTime() - Number(hours) * 60 * 60 * 1000);
}

function formatDate(date) {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-").map(Number);
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }

  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) {
    return "";
  }

  return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
}

module.exports = {
  buildBookingDateTime,
  subtractHours,
  formatDate,
};
