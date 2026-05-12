import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function md5(str: string): string {
  // Simple MD5 (Mailchimp requires lowercase email MD5 for subscriber hash)
  // Using SubtleCrypto isn't available for MD5; small inline implementation.
  function rotateLeft(x: number, c: number) { return (x << c) | (x >>> (32 - c)); }
  function add(a: number, b: number) { return (a + b) & 0xffffffff; }
  function f(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function g(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function h(x: number, y: number, z: number) { return x ^ y ^ z; }
  function i(x: number, y: number, z: number) { return y ^ (x | ~z); }
  const msg = new TextEncoder().encode(str);
  const bits = msg.length * 8;
  const padded = new Uint8Array((((msg.length + 8) >>> 6) + 1) * 64);
  padded.set(msg); padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bits, true);
  let a = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const K = [
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391
  ];
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  for (let off = 0; off < padded.length; off += 64) {
    const M: number[] = [];
    for (let j = 0; j < 16; j++) M.push(view.getUint32(off + j*4, true));
    let A = a, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) {
      let F = 0, gIdx = 0;
      if (j < 16) { F = f(B,C,D); gIdx = j; }
      else if (j < 32) { F = g(B,C,D); gIdx = (5*j + 1) % 16; }
      else if (j < 48) { F = h(B,C,D); gIdx = (3*j + 5) % 16; }
      else { F = i(B,C,D); gIdx = (7*j) % 16; }
      const tmp = D; D = C; C = B;
      B = add(B, rotateLeft(add(add(A, F), add(K[j], M[gIdx])), S[j]));
      A = tmp;
    }
    a = add(a, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }
  const toHex = (n: number) => Array.from(new Uint8Array(new Uint32Array([n]).buffer)).map((x) => x.toString(16).padStart(2, "0")).join("");
  return toHex(a) + toHex(b0) + toHex(c0) + toHex(d0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const API_KEY = Deno.env.get("MAILCHIMP_API_KEY");
    const SERVER = Deno.env.get("MAILCHIMP_SERVER_PREFIX");
    const DEFAULT_AUDIENCE = Deno.env.get("MAILCHIMP_AUDIENCE_ID");
    if (!API_KEY || !SERVER) throw new Error("Mailchimp non configurato");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Non autenticato" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) return new Response(JSON.stringify({ error: "Non autenticato" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { contact_id, audience_id } = body;
    if (!contact_id) throw new Error("contact_id mancante");
    const audId = audience_id || DEFAULT_AUDIENCE;
    if (!audId) throw new Error("Audience ID mancante");

    const { data: contact, error: cErr } = await supabase.from("marketing_contacts").select("*").eq("id", contact_id).single();
    if (cErr || !contact) throw new Error("Contatto non trovato");
    if (!contact.email) throw new Error("Contatto senza email");

    // Recupera categorie (per usarle come tags)
    const { data: cats } = await supabase
      .from("marketing_contact_categories")
      .select("category_id, marketing_categories(name)")
      .eq("contact_id", contact_id);
    const tags = (cats ?? []).map((c: any) => c.marketing_categories?.name).filter(Boolean);

    const emailLower = String(contact.email).trim().toLowerCase();
    const subscriberHash = md5(emailLower);
    const url = `https://${SERVER}.api.mailchimp.com/3.0/lists/${audId}/members/${subscriberHash}`;

    const auth = "Basic " + btoa("anystring:" + API_KEY);
    const splitName = String(contact.nome || "").split(" ");
    const FNAME = splitName[0] || "";
    const LNAME = splitName.slice(1).join(" ") || "";

    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        email_address: emailLower,
        status_if_new: "subscribed",
        merge_fields: { FNAME, LNAME, COMPANY: contact.azienda || "", PHONE: contact.telefono || "" },
        tags,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Mailchimp [${res.status}]: ${data.detail || data.title || JSON.stringify(data)}`);

    return new Response(JSON.stringify({ success: true, member: data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});