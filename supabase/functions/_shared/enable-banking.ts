import { importPKCS8, SignJWT } from "npm:jose@5";

export class BankProviderError extends Error {
  constructor(public status: number, public details: string) { super(`Enable Banking [${status}]: ${details}`); }
}

export async function bankingRequest(path: string, body?: unknown) {
  const appId = Deno.env.get("EB_APP_ID");
  const pem = Deno.env.get("EB_PRIVATE_KEY");
  if (!appId || !pem) throw new Error("Credenziali Enable Banking non configurate.");
  const key = await importPKCS8(pem.replace(/\\n/g, "\n"), "RS256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: appId })
    .setIssuer("enablebanking.com").setAudience("api.enablebanking.com")
    .setIssuedAt().setExpirationTime("5m").sign(key);
  const response = await fetch(`https://api.enablebanking.com${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    // Never log request headers, tokens, PEM keys or successful provider payloads.
    const raw = await response.text();
    let details = "Richiesta rifiutata dal provider.";
    try {
      const error = JSON.parse(raw);
      details = [error.error, error.message].filter((v) => typeof v === "string").join(": ") || details;
    } catch { /* Do not expose arbitrary upstream pages. */ }
    throw new BankProviderError(response.status, details);
  }
  return response.json();
}