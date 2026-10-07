import { canonical } from "./json.ts";

export type Audit = Record<string, unknown>;
export type Out = { result: unknown; audit: Audit };

// Non-finite numbers are written as strings in audits (REQ-AU-002).
export function an(x: number): number | string {
  return Number.isFinite(x) ? x : String(x);
}

export function mk(
  fn: string, citation: string, inputs: Audit, constants: Audit, summary: string, clock: string, extra: Audit = {},
): Audit {
  return {
    spec_version: "0.2.0", function: fn, inputs, constants, citation,
    result_summary: summary, computed_at: clock, ...extra,
  };
}

export function serialize(a: Audit): string {
  return canonical(a);
}
