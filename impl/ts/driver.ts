// JSON-lines driver: stdin requests -> stdout responses (SPEC § 1.2).
import { run } from "./handler.ts";

const chunks: Buffer[] = [];
process.stdin.on("data", (c: Buffer) => chunks.push(c));
process.stdin.on("end", () => {
  process.stdout.write(run(Buffer.concat(chunks).toString("utf8")), () => process.exit(0));
});
