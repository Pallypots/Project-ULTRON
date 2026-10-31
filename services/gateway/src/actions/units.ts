/** Exact unit conversion (local models are unreliable at this). Temperature is handled separately (offsets). */
const UNITS: Record<string, { dim: string; factor: number; names: string[] }> = {
  // length (metres)
  mm: { dim: "length", factor: 0.001, names: ["mm", "millimeter", "millimeters", "millimetre", "millimetres"] },
  cm: { dim: "length", factor: 0.01, names: ["cm", "centimeter", "centimeters", "centimetre", "centimetres"] },
  m: { dim: "length", factor: 1, names: ["m", "meter", "meters", "metre", "metres"] },
  km: { dim: "length", factor: 1000, names: ["km", "kilometer", "kilometers", "kilometre", "kilometres", "kms"] },
  in: { dim: "length", factor: 0.0254, names: ["in", "inch", "inches", '"'] },
  ft: { dim: "length", factor: 0.3048, names: ["ft", "foot", "feet", "'"] },
  yd: { dim: "length", factor: 0.9144, names: ["yd", "yard", "yards"] },
  mi: { dim: "length", factor: 1609.344, names: ["mi", "mile", "miles"] },
  nmi: { dim: "length", factor: 1852, names: ["nautical mile", "nautical miles", "nmi"] },
  // mass (kilograms)
  mg: { dim: "mass", factor: 1e-6, names: ["mg", "milligram", "milligrams"] },
  g: { dim: "mass", factor: 0.001, names: ["g", "gram", "grams"] },
  kg: { dim: "mass", factor: 1, names: ["kg", "kilo", "kilos", "kilogram", "kilograms"] },
  t: { dim: "mass", factor: 1000, names: ["tonne", "tonnes", "metric ton", "metric tons"] },
  oz: { dim: "mass", factor: 0.028349523125, names: ["oz", "ounce", "ounces"] },
  lb: { dim: "mass", factor: 0.45359237, names: ["lb", "lbs", "pound", "pounds"] },
  st: { dim: "mass", factor: 6.35029318, names: ["st", "stone", "stones"] },
  // volume (litres)
  ml: { dim: "volume", factor: 0.001, names: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"] },
  l: { dim: "volume", factor: 1, names: ["l", "liter", "liters", "litre", "litres"] },
  tsp: { dim: "volume", factor: 0.00492892159375, names: ["tsp", "teaspoon", "teaspoons"] },
  tbsp: { dim: "volume", factor: 0.01478676478125, names: ["tbsp", "tablespoon", "tablespoons"] },
  floz: { dim: "volume", factor: 0.0295735295625, names: ["fl oz", "fluid ounce", "fluid ounces"] },
  cup: { dim: "volume", factor: 0.2365882365, names: ["cup", "cups"] },
  pt: { dim: "volume", factor: 0.473176473, names: ["pint", "pints", "us pint", "us pints"] },
  qt: { dim: "volume", factor: 0.946352946, names: ["quart", "quarts"] },
  gal: { dim: "volume", factor: 3.785411784, names: ["gallon", "gallons", "gal", "us gallon", "us gallons"] },
  ukgal: { dim: "volume", factor: 4.54609, names: ["uk gallon", "uk gallons", "imperial gallon", "imperial gallons"] },
  // speed (m/s)
  kmh: { dim: "speed", factor: 1 / 3.6, names: ["km/h", "kmh", "kph", "kilometers per hour", "kilometres per hour"] },
  mph: { dim: "speed", factor: 0.44704, names: ["mph", "miles per hour"] },
  ms: { dim: "speed", factor: 1, names: ["m/s", "meters per second", "metres per second"] },
  kn: { dim: "speed", factor: 0.514444, names: ["knot", "knots", "kn"] },
  // time (seconds)
  sec: { dim: "time", factor: 1, names: ["s", "sec", "secs", "second", "seconds"] },
  min: { dim: "time", factor: 60, names: ["min", "mins", "minute", "minutes"] },
  h: { dim: "time", factor: 3600, names: ["h", "hr", "hrs", "hour", "hours"] },
  day: { dim: "time", factor: 86400, names: ["day", "days"] },
  week: { dim: "time", factor: 604800, names: ["week", "weeks"] },
  // data (bytes)
  kb: { dim: "data", factor: 1e3, names: ["kb", "kilobyte", "kilobytes"] },
  mb: { dim: "data", factor: 1e6, names: ["mb", "megabyte", "megabytes"] },
  gb: { dim: "data", factor: 1e9, names: ["gb", "gigabyte", "gigabytes"] },
  tb: { dim: "data", factor: 1e12, names: ["tb", "terabyte", "terabytes"] },
  // area (m²)
  sqm: { dim: "area", factor: 1, names: ["m2", "m²", "square meter", "square meters", "square metre", "square metres", "sq m"] },
  sqft: { dim: "area", factor: 0.09290304, names: ["ft2", "ft²", "square foot", "square feet", "sq ft"] },
  acre: { dim: "area", factor: 4046.8564224, names: ["acre", "acres"] },
  ha: { dim: "area", factor: 10000, names: ["hectare", "hectares", "ha"] },
};
const TEMP: Record<string, string[]> = {
  c: ["c", "°c", "celsius", "centigrade", "degrees c", "degrees celsius"],
  f: ["f", "°f", "fahrenheit", "degrees f", "degrees fahrenheit"],
  k: ["k", "kelvin"],
};

const findUnit = (name: string) => {
  const n = name.trim().toLowerCase().replace(/\.$/, "");
  for (const [id, u] of Object.entries(UNITS)) if (u.names.includes(n)) return { id, ...u };
  return null;
};
const findTemp = (name: string) => {
  const n = name.trim().toLowerCase().replace(/^degrees?\s+/, "degrees ").replace(/\.$/, "");
  for (const [id, names] of Object.entries(TEMP)) if (names.includes(n) || names.includes(n.replace(/^degrees /, ""))) return id;
  return null;
};

export class UnitError extends Error {}

export function convertUnits(value: number, from: string, to: string): { value: number; from: string; to: string } {
  const tf = findTemp(from);
  const tt = findTemp(to);
  if (tf && tt) {
    const c = tf === "c" ? value : tf === "f" ? ((value - 32) * 5) / 9 : value - 273.15;
    const out = tt === "c" ? c : tt === "f" ? (c * 9) / 5 + 32 : c + 273.15;
    return { value: Number(out.toPrecision(10)), from: tf.toUpperCase(), to: tt.toUpperCase() };
  }
  const a = findUnit(from);
  const b = findUnit(to);
  if (!a) throw new UnitError(`I don't know the unit "${from}".`);
  if (!b) throw new UnitError(`I don't know the unit "${to}".`);
  if (a.dim !== b.dim) throw new UnitError(`Can't convert ${a.dim} (${from}) to ${b.dim} (${to}).`);
  return { value: Number(((value * a.factor) / b.factor).toPrecision(10)), from: a.names[1] ?? a.id, to: b.names[1] ?? b.id };
}

/** "5 miles to km", "how many cups in a litre", "72 f in c" → a conversion, or null. */
export function parseConversion(text: string): { value: number; from: string; to: string } | null {
  const t = text.trim().toLowerCase().replace(/[?!]+$/, "").replace(/,(?=\d{3}\b)/g, "");
  let m = /^(?:convert\s+)?(-?\d+(?:\.\d+)?)\s*([a-z°'"²/. ]+?)\s+(?:to|in|into|as)\s+([a-z°'"²/. ]+)$/.exec(t.replace(/^(?:what(?:'s| is)|how much is|how many is)\s+/, ""));
  if (m) return { value: Number(m[1]), from: m[2]!, to: m[3]!.replace(/^(?:a|an)\s+/, "") };
  m = /^how many\s+([a-z°'"²/. ]+?)\s+(?:are )?(?:in|is)\s+(?:(-?\d+(?:\.\d+)?)|an?|one)\s+([a-z°'"²/. ]+)$/.exec(t);
  if (m) return { value: m[2] ? Number(m[2]) : 1, from: m[3]!, to: m[1]! };
  return null;
}

/** Money conversion in plain words: "$50 to euros", "50 dollars in pounds", "100 GBP to USD". */
export function parseMoney(text: string, codeOf: (s: string) => string | null): { amount: number; from: string; to: string } | null {
  const t = text.trim().replace(/[?!]+$/, "").replace(/^(?:convert|what(?:'s| is)|how much is)\s+/i, "").replace(/,(?=\d{3}\b)/g, "");
  const m = /^([$€£¥])?\s*(\d+(?:\.\d+)?)\s*([\p{L}$€£¥ ]*?)\s+(?:to|in|into)\s+([\p{L}$€£¥ ]+)$/iu.exec(t);
  if (!m) return null;
  const from = codeOf(m[1] ?? m[3] ?? "") ?? (m[3] ? codeOf(m[3]) : null);
  const to = codeOf(m[4]!);
  return from && to ? { amount: Number(m[2]), from, to } : null;
}
