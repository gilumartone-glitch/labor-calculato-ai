// Italian cities helper. The full ~8000-comune dataset (~500KB) is lazy-loaded
// via dynamic import so it never ships in the main bundle.
//
// Data shape in italian-cities.json (compact keys to keep file small):
//   n = nome, p = sigla provincia, c = CAP principale, la = lat, lo = lon

export type ItalianCity = {
  name: string;
  province: string;
  cap: string;
  lat: number;
  lon: number;
};

let cached: ItalianCity[] | null = null;
let loading: Promise<ItalianCity[]> | null = null;

export const loadItalianCities = async (): Promise<ItalianCity[]> => {
  if (cached) return cached;
  if (loading) return loading;
  loading = import("./italian-cities.json").then((mod) => {
    const raw = (mod.default ?? mod) as Array<{ n: string; p: string; c: string; la: number; lo: number }>;
    cached = raw.map((r) => ({ name: r.n, province: r.p, cap: r.c, lat: r.la, lon: r.lo }));
    return cached;
  });
  return loading;
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Cerca per nome/CAP/sigla provincia. Restituisce max `limit` risultati. */
export const searchCities = (all: ItalianCity[], query: string, limit = 30): ItalianCity[] => {
  const q = norm(query);
  if (!q) return all.slice(0, limit);
  const out: ItalianCity[] = [];
  for (const c of all) {
    if (out.length >= limit) break;
    if (norm(c.name).startsWith(q) || c.cap.startsWith(q) || norm(c.province) === q) {
      out.push(c);
    }
  }
  if (out.length < limit) {
    for (const c of all) {
      if (out.length >= limit) break;
      if (out.includes(c)) continue;
      if (norm(c.name).includes(q)) out.push(c);
    }
  }
  return out;
};

/** Distanza in linea d'aria (km) tra due coordinate via formula di haversine. */
export const haversineKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Stima distanza stradale: linea d'aria × 1.3 (fattore tipico per l'Italia). */
export const estimateRoadKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number =>
  Math.round(haversineKm(a, b) * 1.3);

export const findCityByCap = (all: ItalianCity[], cap: string): ItalianCity | undefined =>
  all.find((c) => c.cap === cap);

export const cityKey = (c: ItalianCity) => `${c.name}|${c.cap}|${c.province}`;
export const parseCityKey = (key: string, all: ItalianCity[]): ItalianCity | undefined => {
  const [name, cap, province] = key.split("|");
  return all.find((c) => c.name === name && c.cap === cap && c.province === province);
};

export const CASORIA: ItalianCity = { name: "Casoria", province: "NA", cap: "80026", lat: 40.9057, lon: 14.2903 };
