export function blockedBankSync(code: string, message: string) {
  return { status: "blocked" as const, code, message, imported: 0 };
}