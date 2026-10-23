/**
 * Groups bursts of calls (e.g. many realtime events) into one run after `waitMs`,
 * never running two at once: one database reload instead of dozens.
 */
export function coalesced(fn: () => Promise<unknown> | unknown, waitMs = 800) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    try { await fn(); } catch { /* ignore */ } finally {
      running = false;
      if (again) { again = false; schedule(); }
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void run(); }, waitMs);
  };
  schedule.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return schedule;
}
