export const NEWSLETTER_TEMPLATE_HTML = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>*|MC:SUBJECT|*</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <!-- HEADER -->
        <tr>
          <td style="background:#0e6e7a;padding:24px;text-align:center;color:#ffffff;">
            <h1 style="margin:0;font-size:24px;letter-spacing:-0.02em;">Tecnofra</h1>
            <p style="margin:4px 0 0;font-size:12px;opacity:0.85;text-transform:uppercase;letter-spacing:0.15em;">Laboratorio · Stampa · Allestimenti</p>
          </td>
        </tr>
        <!-- HERO -->
        <tr>
          <td style="padding:32px 32px 8px;">
            <h2 style="margin:0 0 8px;font-size:22px;color:#0f172a;">Ciao *|FNAME|*,</h2>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">
              Benvenuto nella nostra newsletter. Sostituisci questo testo con il messaggio che vuoi comunicare.
            </p>
          </td>
        </tr>
        <!-- BLOCCO 1 -->
        <tr>
          <td style="padding:24px 32px;">
            <h3 style="margin:0 0 8px;font-size:18px;color:#0e6e7a;">Titolo della novità</h3>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">
              Descrivi qui il tuo prodotto, servizio o aggiornamento. Mantieni i paragrafi brevi per una lettura facile da mobile.
            </p>
            <a href="https://tecnofra.it" style="display:inline-block;background:#0e6e7a;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;">Scopri di più</a>
          </td>
        </tr>
        <!-- DIVIDER -->
        <tr><td style="padding:0 32px;"><hr style="border:0;border-top:1px solid #e2e8f0;margin:0;" /></td></tr>
        <!-- BLOCCO 2 -->
        <tr>
          <td style="padding:24px 32px;">
            <h3 style="margin:0 0 8px;font-size:18px;color:#0e6e7a;">Secondo blocco</h3>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">
              Aggiungi un secondo argomento, un'offerta o un caso studio. Puoi duplicare questo blocco quante volte vuoi.
            </p>
          </td>
        </tr>
        <!-- FOOTER -->
        <tr>
          <td style="background:#0f172a;padding:20px 32px;color:#cbd5e1;font-size:12px;line-height:1.6;text-align:center;">
            <p style="margin:0 0 6px;color:#ffffff;font-weight:600;">Tecnofra S.r.l.</p>
            <p style="margin:0 0 10px;">Via Esempio 1 · Città · P.IVA 00000000000</p>
            <p style="margin:0;">
              <a href="*|UNSUB|*" style="color:#94a3b8;text-decoration:underline;">Disiscriviti</a> ·
              <a href="*|UPDATE_PROFILE|*" style="color:#94a3b8;text-decoration:underline;">Aggiorna preferenze</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

export const CONTACTS_CSV_TEMPLATE = `nome,email,telefono,azienda,note,categorie
Mario Rossi,mario.rossi@example.com,+39 333 1234567,Acme Srl,Cliente storico,Clienti;VIP
Anna Bianchi,anna.bianchi@example.com,,Studio Bianchi,,Prospect
`;

/** Parser CSV minimale che gestisce virgolette e virgole nei valori. */
export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let val = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { val += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { val += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { cur.push(val); val = ""; }
      else if (ch === "\n") { cur.push(val); rows.push(cur); cur = []; val = ""; }
      else if (ch === "\r") { /* skip */ }
      else val += ch;
    }
  }
  if (val.length > 0 || cur.length > 0) { cur.push(val); rows.push(cur); }
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).filter((r) => r.some((v) => v.trim() !== "")).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
    return obj;
  });
}