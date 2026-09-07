export function numeric(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sumBy(rows, field) {
  return rows.reduce((total, row) => total + numeric(row[field]), 0);
}

export function groupSum(rows, keyField, valueField) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[keyField] || "Unknown";
    groups.set(key, (groups.get(key) || 0) + numeric(row[valueField]));
  }
  return [...groups.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

export function yearOf(value) {
  return typeof value === "string" && /^\d{4}-/.test(value)
    ? value.slice(0, 4)
    : "Unknown";
}

export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat("en-PH", {
    maximumFractionDigits: 2,
    ...options,
  }).format(numeric(value));
}

export function formatMetric(value, metric) {
  if (metric === "value_loss_php") {
    return `₱${formatNumber(value, { maximumFractionDigits: 0 })}`;
  }
  if (metric === "area_affected_ha") {
    return `${formatNumber(value)} ha`;
  }
  return `${formatNumber(value)} MT`;
}

export function csvValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
