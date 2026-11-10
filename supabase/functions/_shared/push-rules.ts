export function safeNotificationPath(value: unknown): string {
  return typeof value === "string" && /^\/(?!\/)/.test(value) && !/[\\\r\n]/.test(value) ? value : "/hub";
}
export function pushFailureStatus(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const status = (value as { statusCode?: unknown }).statusCode;
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 0;
}
