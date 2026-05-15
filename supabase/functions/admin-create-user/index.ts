import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verifica che il chiamante sia admin
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userData.user.id);
    const isAdmin = (roleRows ?? []).some((r) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { email, password, display_name, approved, roles, permissions } = body as {
      email: string;
      password: string;
      display_name?: string;
      approved?: boolean;
      roles?: string[];
      permissions?: { page_key: string; level: "none" | "read" | "write" }[];
    };

    if (!email || !password || password.length < 8) {
      return new Response(JSON.stringify({ error: "Email e password (min 8 caratteri) sono obbligatori" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: display_name ?? email.split("@")[0] },
    });
    if (createErr || !created?.user) {
      console.error("createUser error", { email, error: createErr });
      const msg = createErr?.message ?? "Creazione fallita";
      const human = /weak|pwned|password/i.test(msg)
        ? "Password troppo debole o compromessa. Usa qualcosa tipo 'Tecnofra2026!'"
        : /already|exists|registered/i.test(msg)
        ? "Email già registrata"
        : msg;
      return new Response(JSON.stringify({ error: human, raw: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const newId = created.user.id;

    // approvato di default per utenti creati dall'admin
    await admin.from("profiles").update({ approved: approved ?? true, display_name: display_name ?? email.split("@")[0] }).eq("id", newId);

    if (roles && roles.length) {
      await admin.from("user_roles").delete().eq("user_id", newId);
      await admin.from("user_roles").insert(roles.map((r) => ({ user_id: newId, role: r as any })));
    }

    if (permissions && permissions.length) {
      for (const p of permissions) {
        await admin.from("user_permissions").upsert({ user_id: newId, page_key: p.page_key, level: p.level }, { onConflict: "user_id,page_key" });
      }
    }

    return new Response(JSON.stringify({ id: newId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});