import { mk, type Audit, type Out } from "./audit.ts";
import { numText } from "./json.ts";

type Entry = { url_pattern?: unknown; status?: unknown; body_json?: unknown; body_text?: unknown; simulate?: unknown };
type Reply = { kind: "timeout" } | { kind: "transport" } | { kind: "http"; status: number; body: string };
type Sample = Record<string, unknown>;

function replay(url: string, responses: unknown[]): Reply {
  for (const e of responses as Entry[]) {
    if (e === null || typeof e !== "object" || typeof e.url_pattern !== "string") continue;
    let hit = false;
    try { hit = new RegExp(e.url_pattern).test(url); } catch { hit = false; }
    if (!hit) continue;
    if (e.simulate === "timeout") return { kind: "timeout" };
    if (typeof e.status !== "number") return { kind: "transport" };
    const body = e.body_json !== undefined && e.body_json !== null ? JSON.stringify(e.body_json)
      : typeof e.body_text === "string" ? e.body_text : "";
    return { kind: "http", status: e.status, body };
  }
  return { kind: "transport" };
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const missing = (v: unknown) => v === undefined || v === null;

type Attempt = { status: "ok" | "timeout" | "error"; error?: string; sample?: Sample };

function attempt(src: "nws" | "open-meteo", url: string, responses: unknown[]): Attempt {
  const r = replay(url, responses);
  if (r.kind === "timeout") return { status: "timeout", error: "timeout" };
  if (r.kind === "transport") return { status: "error", error: "transport_error" };
  if (r.status >= 400) return { status: "error", error: "http_" + numText(r.status) };
  let body: unknown;
  try { body = JSON.parse(r.body); } catch { return { status: "error", error: "parse_error" }; }
  let t: unknown, h: unknown, w: unknown, names: [string, string];
  if (src === "nws") {
    const p = isObj(body) && isObj(body.properties) ? body.properties : {};
    const val = (k: string) => (isObj(p[k]) ? (p[k] as Record<string, unknown>).value : undefined);
    t = val("temperature"); h = val("relativeHumidity"); w = val("windSpeed");
    names = ["temperature", "relativeHumidity"];
  } else {
    const c = isObj(body) && isObj(body.current) ? body.current : {};
    t = c.temperature_2m; h = c.relative_humidity_2m; w = c.wind_speed_10m;
    names = ["temperature_2m", "relative_humidity_2m"];
  }
  if (missing(t)) return { status: "error", error: "missing_field:" + names[0] };
  if (missing(h)) return { status: "error", error: "missing_field:" + names[1] };
  const sample: Sample = { tempC: t, rhPercent: h, source: src };
  if (!missing(w)) sample.windMps = (w as number) / 3.6;
  return { status: "ok", sample };
}

export function cascade(lat: number, lng: number, iso: string | undefined, responses: unknown[], clock: string): Out {
  const inputs: Audit = { lat, lng };
  if (iso !== undefined) inputs.isoTimestamp = iso;
  const la = numText(lat), ln = numText(lng);
  const sources: ["nws" | "open-meteo", string, string, string][] = [
    ["nws", `https://api.weather.gov/points/${la},${ln}/observations/latest`, "api.weather.gov", "nws_timeout_ms"],
    ["open-meteo", `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${ln}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`, "api.open-meteo.com", "open_meteo_timeout_ms"],
  ];
  const chain: string[] = [], tried: Audit[] = [], children: Audit[] = [];
  let sample: Sample | undefined, nwsText = "";
  for (const [src, url, cite, ckey] of sources) {
    const a = attempt(src, url, responses);
    chain.push(src);
    const entry: Audit = { source: src, status: a.status, duration_ms: a.status === "timeout" ? 5000 : 0 };
    if (a.status !== "ok") entry.error = a.error;
    tried.push(entry);
    const summary = a.status === "ok" ? `${src} OK in 0ms` : `${src} ${a.error}`;
    children.push(mk("fetchWeatherCascade." + src, cite, inputs, { [ckey]: 5000 }, summary, clock));
    if (a.status === "ok") { sample = a.sample; break; }
    if (src === "nws") {
      nwsText = a.error!.startsWith("missing_field:") ? "nws missing fields" : "nws " + a.error;
    }
  }
  const constants: Audit = { nws_timeout_ms: 5000, open_meteo_timeout_ms: 5000 };
  const extra: Audit = { source_chain: chain, sources_tried: tried, children };
  let summary: string;
  if (!sample) {
    sample = { tempC: 20, rhPercent: 50, source: "simulated" };
    chain.push("simulated");
    constants.simulated_temp_c = 20;
    constants.simulated_rh_percent = 50;
    extra.fallback_reason = "all_live_sources_failed";
    summary = "cascade → simulated (all_live_sources_failed)";
  } else {
    summary = `cascade → ${sample.source} OK (tempC=${numText(sample.tempC as number)}, rhPercent=${numText(sample.rhPercent as number)})`;
    if (sample.source === "open-meteo") { extra.fallback_reason = nwsText; summary += " after " + nwsText; }
  }
  return {
    result: { sample },
    audit: mk("fetchWeatherCascade", "Cascade order: NWS → Open-Meteo → simulated", inputs, constants, summary, clock, extra),
  };
}
