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
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userData.user.id);
    if (!(roleRows ?? []).some((r) => r.role === "admin")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { user_id, email, display_name } = await req.json() as { user_id: string; email?: string; display_name?: string };
    if (!user_id) return new Response(JSON.stringify({ error: "user_id mancante" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const authPatch: Record<string, unknown> = {};
    if (typeof email === "string" && email.trim()) {
      authPatch.email = email.trim();
      authPatch.email_confirm = true;
    }
    if (typeof display_name === "string") {
      authPatch.user_metadata = { display_name: display_name.trim() };
    }
    if (Object.keys(authPatch).length > 0) {
      const { data: upd, error } = await admin.auth.admin.updateUserById(user_id, authPatch);
      if (error) {
        console.error("updateUserById error", { user_id, authPatch, error });
        return new Response(JSON.stringify({ error: error.message, details: (error as any).code ?? null, status: (error as any).status ?? null }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log("updateUserById ok", upd?.user?.id);
    }

    if (typeof display_name === "string") {
      await admin.from("profiles").update({ display_name: display_name.trim() }).eq("id", user_id);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
