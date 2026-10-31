import { z } from "zod";
import { reach } from "./knowledge.ts";
import { convertUnits } from "./units.ts";
import type { ToolDef } from "./tools.ts";

// Free, keyless, read-only services (overridable for tests).
const FX = () => process.env.ULTRON_FX_API ?? "https://api.frankfurter.dev/v1";
const DICT = () => process.env.ULTRON_DICT_API ?? "https://api.dictionaryapi.dev/api/v2/entries/en";
const GEO = () => process.env.ULTRON_GEOCODE_API ?? "https://geocoding-api.open-meteo.com";

async function json(url: string): Promise<any> {
  const res = await reach(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The service answered ${res.status}.`);
  return res.json();
}

const CURRENCY_WORDS: Record<string, string> = {
  dollar: "USD", dollars: "USD", usd: "USD", buck: "USD", bucks: "USD", euro: "EUR", euros: "EUR", eur: "EUR", pound: "GBP", pounds: "GBP", quid: "GBP", gbp: "GBP", sterling: "GBP",
  yen: "JPY", jpy: "JPY", yuan: "CNY", rmb: "CNY", cny: "CNY", rupee: "INR", rupees: "INR", inr: "INR", franc: "CHF", francs: "CHF", chf: "CHF", peso: "MXN", pesos: "MXN", mxn: "MXN",
  "canadian dollar": "CAD", "canadian dollars": "CAD", cad: "CAD", "australian dollar": "AUD", "australian dollars": "AUD", aud: "AUD", krona: "SEK", kronor: "SEK", sek: "SEK", won: "KRW", krw: "KRW",
  real: "BRL", reais: "BRL", brl: "BRL", zloty: "PLN", pln: "PLN", rand: "ZAR", zar: "ZAR", "new zealand dollar": "NZD", nzd: "NZD", "hong kong dollar": "HKD", hkd: "HKD", "singapore dollar": "SGD", sgd: "SGD",
  $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY",
};
/** "dollars" → USD, "EUR" → EUR; null if it isn't a currency. */
export const currencyCode = (s: string): string | null => CURRENCY_WORDS[s.trim().toLowerCase()] ?? null;

const units: ToolDef<{ value: number; from: string; to: string }> = {
  name: "convert_units",
  description: "Exact unit conversion: length, weight, volume (incl. cooking cups/tbsp), temperature, speed, time, data size, area. Use this instead of converting in your head.",
  input: z.object({ value: z.number().finite(), from: z.string().trim().min(1).max(40), to: z.string().trim().min(1).max(40) }).strict(),
  parameters: { type: "object", properties: { value: { type: "number" }, from: { type: "string", description: "e.g. 'miles', 'F', 'cups'" }, to: { type: "string", description: "e.g. 'km', 'C', 'ml'" } }, required: ["value", "from", "to"], additionalProperties: false },
  risk: 0,
  timeoutMs: 1000,
  describe: (i) => `Convert ${i.value} ${i.from} to ${i.to}`,
  run: async (i) => JSON.stringify(convertUnits(i.value, i.from, i.to)),
};

const currency: ToolDef<{ amount: number; from: string; to: string }> = {
  name: "convert_currency",
  description: "Convert money between currencies with today's European Central Bank reference rates (updated each working day). Use 3-letter codes like USD, EUR, GBP, JPY.",
  input: z.object({ amount: z.number().positive().finite(), from: z.string().trim().min(1).max(30), to: z.string().trim().min(1).max(30) }).strict(),
  parameters: { type: "object", properties: { amount: { type: "number" }, from: { type: "string", description: "e.g. USD" }, to: { type: "string", description: "e.g. EUR" } }, required: ["amount", "from", "to"], additionalProperties: false },
  risk: 0,
  timeoutMs: 12_000,
  describe: (i) => `Convert ${i.amount} ${i.from} to ${i.to}`,
  run: async (i) => {
    const from = currencyCode(i.from) ?? i.from.toUpperCase();
    const to = currencyCode(i.to) ?? i.to.toUpperCase();
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new Error("Use 3-letter currency codes like USD or EUR.");
    if (from === to) return JSON.stringify({ amount: i.amount, from, to, result: i.amount });
    const data = await json(`${FX()}/latest?base=${from}&symbols=${to}`);
    const rate = data?.rates?.[to];
    if (typeof rate !== "number") throw new Error(`No exchange rate for ${from} → ${to}.`);
    return JSON.stringify({ amount: i.amount, from, to, rate, result: Math.round(i.amount * rate * 100) / 100, date: data.date, source: "European Central Bank via Frankfurter" });
  },
};

const define: ToolDef<{ word: string }> = {
  name: "define_word",
  description: "Dictionary definitions (English): meanings, part of speech, an example, pronunciation.",
  input: z.object({ word: z.string().trim().min(1).max(60) }).strict(),
  parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"], additionalProperties: false },
  risk: 0,
  timeoutMs: 12_000,
  describe: (i) => `Look up the meaning of "${i.word}"`,
  run: async (i) => {
    const data = await json(`${DICT()}/${encodeURIComponent(i.word.toLowerCase())}`);
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) return JSON.stringify({ found: false, note: `No dictionary entry for "${i.word}".` });
    return JSON.stringify({
      found: true,
      word: entry.word,
      phonetic: entry.phonetic ?? entry.phonetics?.find((p: { text?: string }) => p.text)?.text,
      meanings: (entry.meanings ?? []).slice(0, 3).map((m: any) => ({
        part_of_speech: m.partOfSpeech,
        definitions: (m.definitions ?? []).slice(0, 2).map((d: any) => ({ definition: d.definition, example: d.example })),
      })),
    });
  },
};

export async function timeIn(place: string) {
  const geo = await json(`${GEO()}/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`);
  const g = geo?.results?.[0];
  if (!g?.timezone) return { found: false as const, note: `I couldn't find a place called "${place}".` };
  const now = new Date();
  const local = now.toLocaleString(undefined, { timeZone: g.timezone, weekday: "long", hour: "numeric", minute: "2-digit" });
  const offsetH = (Date.parse(now.toLocaleString("en-US", { timeZone: g.timezone })) - Date.parse(now.toLocaleString("en-US"))) / 3_600_000;
  return { found: true as const, place: [g.name, g.admin1, g.country].filter(Boolean).join(", "), time: local, time_zone: g.timezone, hours_ahead_of_you: Math.round(offsetH * 2) / 2 };
}

const worldTime: ToolDef<{ place: string }> = {
  name: "world_time",
  description: "The current local time in any city or country, and how far ahead/behind the owner it is.",
  input: z.object({ place: z.string().trim().min(2).max(80) }).strict(),
  parameters: { type: "object", properties: { place: { type: "string" } }, required: ["place"], additionalProperties: false },
  risk: 0,
  timeoutMs: 12_000,
  describe: (i) => `Check the time in ${i.place}`,
  run: async (i) => JSON.stringify(await timeIn(i.place)),
};

export const EVERYDAY_TOOLS: ToolDef[] = [units, currency, define, worldTime];
