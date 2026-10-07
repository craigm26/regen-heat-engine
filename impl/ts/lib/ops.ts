import { mk, an, type Out } from "./audit.ts";
import { numText, fixed } from "./json.ts";

const WB_CITE = "Stull (2011) eq. 1";

export function wetBulb(tempC: number, rhPercent: number, clock: string): Out {
  const inputs = { tempC: an(tempC), rhPercent: an(rhPercent) };
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPercent)) {
    const bad = Number.isFinite(tempC) ? "rhPercent" : "tempC";
    return { result: null, audit: mk("calculateWetBulb", WB_CITE, inputs, {}, "invalid_input:" + bad, clock) };
  }
  const T = tempC;
  const RH = Math.min(100, Math.max(5, rhPercent));
  const term1 = T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659));
  const term2 = Math.atan(T + RH);
  const term3 = Math.atan(RH - 1.676331);
  const term4 = 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH);
  const wetBulbC = term1 + term2 - term3 + term4 + (-4.686035);
  const wetBulbF = (wetBulbC * 9) / 5 + 32;
  const clamped = RH !== rhPercent;
  const result: Record<string, number> = { wetBulbC, wetBulbF };
  if (clamped) result.clampedRhPct = RH;
  const constants: Record<string, number> = {
    stull_a: 0.151977, stull_b: 8.313659, stull_c: 1.676331,
    stull_d: 0.00391838, stull_e: 0.023101, stull_offset: -4.686035,
  };
  if (clamped) { constants.rh_clamp_min = 5; constants.rh_clamp_max = 100; }
  const markers: string[] = [];
  if (clamped) markers.push("rh_clamped");
  if (tempC < -20 || tempC > 50) markers.push("out_of_validity_range");
  const rh = clamped ? `${numText(rhPercent)}→${numText(RH)}%` : `${numText(RH)}%`;
  const m = markers.length ? ` (${markers.join(",")})` : "";
  const summary = `T=${fixed(T, 1)}°C RH=${rh}${m} → Tw=${fixed(wetBulbC, 2)}°C`;
  return { result, audit: mk("calculateWetBulb", WB_CITE, inputs, constants, summary, clock) };
}

export function wetBulbFromF(tempF: number, rhPercent: number, clock: string): Out {
  return wetBulb(((tempF - 32) * 5) / 9, rhPercent, clock);
}

const FLAG_CITE = "USMC 6200.1E Table 3-1";
const FLAG_CONSTS = { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 };
const LABELS: Record<string, string> = {
  white: "low", green: "moderate", yellow: "high", red: "extreme", black: "critical",
};

export function flagF(w: number, clock: string): Out {
  if (!Number.isFinite(w)) {
    return { result: null, audit: mk("flagFromWetBulbF", FLAG_CITE, { wetBulbF: an(w) }, {}, "invalid_input:wetBulbF", clock) };
  }
  const flag = w < 80 ? "white" : w < 85 ? "green" : w < 88 ? "yellow" : w < 90 ? "red" : "black";
  const oor = w < -50 || w > 200 ? " (out_of_observed_range)" : "";
  return {
    result: { flag, flagDartLabel: LABELS[flag] },
    audit: mk("flagFromWetBulbF", FLAG_CITE, { wetBulbF: w }, FLAG_CONSTS, `wetBulbF=${numText(w)} → ${flag}${oor}`, clock),
  };
}

export function flagC(c: number, clock: string): Out {
  if (!Number.isFinite(c)) {
    return { result: null, audit: mk("flagFromWetBulbC", FLAG_CITE, { wetBulbC: an(c) }, {}, "invalid_input:wetBulbC", clock) };
  }
  const f = (c * 9) / 5 + 32;
  const child = flagF(f, clock);
  const flag = (child.result as { flag: string } | null)?.flag ?? "invalid_input";
  const summary = `wetBulbC=${numText(c)} → wetBulbF=${fixed(f, 4)} → ${flag}`;
  return {
    result: child.result,
    audit: mk("flagFromWetBulbC", FLAG_CITE, { wetBulbC: c }, FLAG_CONSTS, summary, clock, { children: [child.audit] }),
  };
}

type Cell = [number, number, number | null] | "cease";
const TABLE: Record<string, [Cell, Cell]> = {
  white: [[60, 0, null], [50, 10, null]],
  green: [[50, 10, null], [40, 20, null]],
  yellow: [[45, 15, 6], [30, 30, 4]],
  red: [[30, 30, 4], "cease"],
  black: [[10, 50, 1], "cease"],
};
export const FLAGS = Object.keys(TABLE);

export function workRest(flag: string, acclimatized: boolean, req: number, clock: string): Out {
  const cite = "USMC 6200.1E §3.2";
  const inputs = { flag, acclimatized, workMinutesRequested: an(req) };
  const bad = (s: string): Out => ({ result: null, audit: mk("workRestForFlag", cite, inputs, {}, "invalid_input:" + s, clock) });
  if (!Object.hasOwn(TABLE, flag)) return bad("flag");
  if (!Number.isFinite(req)) return bad("workMinutesRequested");
  const branch = acclimatized ? "acclim" : "unacclim";
  const cell = TABLE[flag][acclimatized ? 0 : 1];
  const tail = req <= 0 ? " (non_positive_work_window)" : "";
  if (cell === "cease") {
    return {
      result: { workMinutes: 0, restMinutes: 0, cyclesUntilReassessRequired: null, ceaseWork: true },
      audit: mk("workRestForFlag", cite, inputs, {}, `${flag}/${branch} → cease_work${tail}`, clock),
    };
  }
  const [w, r, n] = cell;
  const constants: Record<string, number> = { [`${flag}_work_${branch}`]: w, [`${flag}_rest_${branch}`]: r };
  let summary = `${flag}/${branch} → ${w}w/${r}r`;
  if (n !== null) {
    constants[acclimatized ? `${flag}_reassess_cycles` : `${flag}_reassess_cycles_unacclim`] = n;
    summary += n === 1 ? ", reassess every cycle" : `, reassess after ${n} cycles`;
  }
  return {
    result: { workMinutes: w, restMinutes: r, cyclesUntilReassessRequired: n, ceaseWork: false },
    audit: mk("workRestForFlag", cite, inputs, constants, summary + tail, clock),
  };
}

const VD_CITE = "Go/delay/alternate promotion matrix";

export function verdict(
  priorVerdict: string | null, priorFlag: string | null, currentFlag: string, alt: boolean, clock: string,
): Out {
  const inputs = { priorVerdict, priorFlag, currentFlag, hasAlternateAvailable: alt };
  const bad = (s: string): Out => ({ result: null, audit: mk("promoteVerdict", VD_CITE, inputs, {}, "invalid_input:" + s, clock) });
  if (!FLAGS.includes(currentFlag)) return bad("currentFlag");
  if (priorVerdict !== null && !["go", "delay", "alternate"].includes(priorVerdict)) return bad("priorVerdict");
  if (priorFlag !== null && !FLAGS.includes(priorFlag)) return bad("priorFlag");
  const hot = currentFlag === "red" || currentFlag === "black";
  let rule: string, v: string, summary: string;
  const prior = String(priorFlag);
  if (priorVerdict === null) {
    rule = "FIRST_RUN_DEFAULT"; v = hot ? "delay" : "go";
    summary = `first run, ${currentFlag} → ${v}`;
  } else if (priorFlag === currentFlag) {
    rule = "NO_CHANGE"; v = priorVerdict;
    summary = `no_change, ${currentFlag} → ${v}` + (priorVerdict === "delay" ? " (held)" : "");
  } else if (currentFlag === "black" && alt) {
    rule = "ALTERNATE_AVAILABLE_AT_BLACK"; v = "alternate";
    summary = `${prior} → ${currentFlag} + alternate → alternate`;
  } else if (hot) {
    rule = "ESCALATE_TO_DELAY_ON_RED_OR_BLACK"; v = "delay";
    summary = `${prior} → ${currentFlag}, escalate to delay`;
  } else {
    rule = "DEESCALATE_TO_GO"; v = "go";
    summary = `${prior} → ${currentFlag}, deescalate to go`;
  }
  const changed = rule === "FIRST_RUN_DEFAULT" || rule === "NO_CHANGE" ? false : priorVerdict !== v;
  return {
    result: { verdict: v, changedFromPrior: changed, promotionRule: rule },
    audit: mk("promoteVerdict", VD_CITE, inputs, {}, summary, clock, {
      prior_flag: priorFlag, next_flag: currentFlag, promotion_rule: rule,
    }),
  };
}
