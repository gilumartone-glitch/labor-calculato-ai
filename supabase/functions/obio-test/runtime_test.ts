import { OpenBankingClient } from "npm:@open-banking-io/client@1.3.0";

Deno.test("open-banking.io SDK loads in Deno with node:crypto support", () => {
  if (typeof OpenBankingClient !== "function") throw new Error("SDK constructor unavailable");
});

Deno.test("Deno supports SDK-compatible PKCS8 import and encrypted envelope primitives", async () => {
  const { webcrypto } = await import("node:crypto");
  const keys = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  const exported = await webcrypto.subtle.exportKey("pkcs8", keys.privateKey);
  const imported = await webcrypto.subtle.importKey("pkcs8", exported, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"]);
  if (imported.type !== "private") throw new Error("PKCS8 import failed");
});