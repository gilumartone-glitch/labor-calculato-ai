export const eur = (n: number) =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(isFinite(n) ? n : 0);

export const num = (n: number, d = 2) =>
  new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(isFinite(n) ? n : 0);

export const uid = () => Math.random().toString(36).slice(2, 9);
