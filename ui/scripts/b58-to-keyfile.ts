import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import bs58 from "bs58";

const b58 = '';
if (!b58) {
  console.error("usage: tsx b58-to-keyfile.ts <base58-private-key> [output-path]");
  process.exit(1);
}

const out = resolve(process.argv[3] ?? "../../squads-multisig/member1.json");
const bytes = Array.from(bs58.decode(b58));

if (bytes.length !== 64) {
  console.error(`expected 64-byte secret key, got ${bytes.length}`);
  process.exit(1);
}

writeFileSync(out, JSON.stringify(bytes));
console.log(`wrote ${bytes.length}-byte key to ${out}`);
