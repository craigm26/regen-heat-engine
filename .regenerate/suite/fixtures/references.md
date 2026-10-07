# Tier 1 Foundation — Primary References

Every fixture row in `*.fixtures.csv` declares a `source_ref` that must resolve to one of the entries below. CI lints this.

## stull-2011
Stull, R. (2011). "Wet-Bulb Temperature from Relative Humidity and Air Temperature."
*Journal of Applied Meteorology and Climatology*, 50(11), 2267-2269.
DOI: 10.1175/JAMC-D-11-0143.1

Provides the empirical formula and validity range:
- Temperature: -20 °C ≤ T ≤ 50 °C
- Relative humidity: 5% ≤ RH ≤ 99%
- Claimed accuracy: ±0.65 °C RMS across this domain

## stull-2011-cross-check
Cross-check method for fixture values that don't appear in the paper's published table:
expected values are derived by running the formula in floating-point (double-precision)
against a reference NOAA wet-bulb calculator at https://www.weather.gov/epz/wxcalc_rh
on selected (T, RH) pairs. Cross-check tolerance: ±0.3 °C.

## usmc-6200-1e
U.S. Marine Corps Order 6200.1E. (2002). "Marine Corps Heat Stress Program."
Establishes WBGT-based environmental-flag boundaries used for training and operations:
- White:  WBGT < 80.0 °F
- Green:  80.0 ≤ WBGT < 85.0 °F
- Yellow: 85.0 ≤ WBGT < 88.0 °F
- Red:    88.0 ≤ WBGT < 90.0 °F
- Black:  WBGT ≥ 90.0 °F

(Boundaries are defined in Fahrenheit; this spec keeps the source unit for flag mapping to avoid float-precision artifacts at boundary edges.)

## cascade-nws
National Weather Service observation API — `api.weather.gov`. Cascade tier 1
(highest authority for US locations). Endpoint:
`GET /points/{lat},{lng}/observations/latest`. Expected response shape:
`{ properties: { temperature: { value }, relativeHumidity: { value }, windSpeed: { value } } }`.
Each value field may be null; cascade treats null as a missing field and
falls through to the next tier. Per-source timeout 5000ms (default).

## cascade-open-meteo
Open-Meteo forecast API — `api.open-meteo.com`. Cascade tier 2 (worldwide
coverage, no API key). Endpoint:
`GET /v1/forecast?latitude={lat}&longitude={lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`.
Expected response shape: `{ current: { temperature_2m, relative_humidity_2m, wind_speed_10m } }`.
Per-source timeout 5000ms (default).

## cascade-simulated
Deterministic fallback sample for the case where both live sources failed.
Fixed at `{ tempC: 20, rhPercent: 50, source: 'simulated' }` — represents
"unknown but not alarming" conditions. The audit always declares
`fallback_reason: 'all_live_sources_failed'` when this tier fires.

## heat-engine-spec-design-doc-2-5
heat-engine-spec design doc §2.5 — verdict promotion rule matrix. The state
machine resolves five named rules in this priority order:

1. `FIRST_RUN_DEFAULT` — fires when `priorVerdict === null`. Returns `delay`
   when `currentFlag` is red or black, otherwise `go`. `changedFromPrior=false`.
2. `NO_CHANGE` — fires when `currentFlag === priorFlag`. Holds `priorVerdict`
   unchanged. `changedFromPrior=false`.
3. `ALTERNATE_AVAILABLE_AT_BLACK` — fires when `currentFlag === 'black'`
   and `hasAlternateAvailable === true`. Returns `alternate`.
4. `ESCALATE_TO_DELAY_ON_RED_OR_BLACK` — fires when `currentFlag` is red
   or black and the alternate-at-black rule did not. Returns `delay`.
5. `DEESCALATE_TO_GO` — catch-all for transitions that left the
   red/black band. Returns `go`.

Flag severity ranking (low → high): white=0, green=1, yellow=2, red=3, black=4.

## usmc-6200-1e-section-3-2
U.S. Marine Corps Order 6200.1E §3.2 — work/rest matrix for *moderate work intensity*.
Prescribes per-hour work/rest intervals by environmental flag and acclimatization state:

| Flag   | Acclimatized      | Unacclimatized    |
|--------|-------------------|-------------------|
| White  | 60w/0r            | 50w/10r           |
| Green  | 50w/10r           | 40w/20r           |
| Yellow | 45w/15r, reassess after 6 cycles | 30w/30r, reassess after 4 cycles |
| Red    | 30w/30r, reassess after 4 cycles | cease work        |
| Black  | 10w/50r, reassess every cycle    | cease work        |

The "reassess" requirement instructs the supervisor to evaluate the worker for heat-stress symptoms before continuing the next cycle. "Cease work" mandates moving the worker to refuge regardless of operational tempo.
