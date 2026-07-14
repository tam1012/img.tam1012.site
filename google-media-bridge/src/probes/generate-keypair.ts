import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_PRIVATE_OUT = "secrets/probe-private.pem";
const DEFAULT_PUBLIC_OUT = "../google-flow-enroller/state/probe-public.pem";

function parseArgs(argv: string[]) {
  let privateOut = DEFAULT_PRIVATE_OUT;
  let publicOut = DEFAULT_PUBLIC_OUT;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") force = true;
    else if (arg === "--private-out") privateOut = argv[++i] ?? privateOut;
    else if (arg === "--public-out") publicOut = argv[++i] ?? publicOut;
  }
  return { privateOut, publicOut, force };
}

function assertWritable(target: string, force: boolean) {
  if (existsSync(target) && !force) {
    throw new Error(`Refusing to overwrite ${target} without --force`);
  }
}

function main() {
  const { privateOut, publicOut, force } = parseArgs(process.argv.slice(2));
  assertWritable(privateOut, force);
  assertWritable(publicOut, force);

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  mkdirSync(dirname(privateOut), { recursive: true });
  mkdirSync(dirname(publicOut), { recursive: true });
  writeFileSync(privateOut, privateKey, { mode: 0o600 });
  writeFileSync(publicOut, publicKey, { mode: 0o644 });

  process.stdout.write(`FLOW_KEYPAIR_READY private=${privateOut} public=${publicOut}\n`);
}

main();
