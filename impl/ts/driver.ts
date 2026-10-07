import { handleLine } from "./lib/dispatch.ts";

const chunks: Buffer[] = [];
process.stdin.on("data", (c: Buffer) => chunks.push(c));
process.stdin.on("end", () => {
  const out: string[] = [];
  for (const line of Buffer.concat(chunks).toString("utf8").split("\n")) {
    if (/^\s*$/.test(line)) continue;
    out.push(handleLine(line) + "\n");
  }
  process.stdout.write(out.join(""));
});
