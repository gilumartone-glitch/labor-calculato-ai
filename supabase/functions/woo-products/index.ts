import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const baseUrl = Deno.env.get('WOOCOMMERCE_URL');
    const ck = Deno.env.get('WOOCOMMERCE_CONSUMER_KEY');
    const cs = Deno.env.get('WOOCOMMERCE_CONSUMER_SECRET');
    if (!baseUrl || !ck || !cs) {
      return new Response(JSON.stringify({ error: 'WooCommerce non configurato' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const url = new URL(req.url);
    const search = url.searchParams.get('search') ?? '';
    const page = url.searchParams.get('page') ?? '1';
    const per_page = url.searchParams.get('per_page') ?? '20';
    const id = url.searchParams.get('id');

    const base = baseUrl.replace(/\/+$/, '');
    const auth = 'Basic ' + btoa(`${ck}:${cs}`);

    let endpoint = `${base}/wp-json/wc/v3/products`;
    if (id) endpoint += `/${encodeURIComponent(id)}`;
    else {
      const qs = new URLSearchParams({ per_page, page, status: 'publish' });
      if (search) qs.set('search', search);
      endpoint += `?${qs.toString()}`;
    }

    const r = await fetch(endpoint, { headers: { Authorization: auth } });
    const text = await r.text();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: `WooCommerce ${r.status}`, detail: text.slice(0, 500) }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const data = JSON.parse(text);

    const simplify = (p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      permalink: p.permalink,
      price: p.price,
      regular_price: p.regular_price,
      short_description: (p.short_description || '').replace(/<[^>]+>/g, '').trim(),
      description: (p.description || '').replace(/<[^>]+>/g, '').trim(),
      images: (p.images || []).map((i: any) => ({ src: i.src, alt: i.alt })),
      categories: (p.categories || []).map((c: any) => c.name),
      tags: (p.tags || []).map((t: any) => t.name),
    });

    const out = Array.isArray(data) ? data.map(simplify) : simplify(data);
    return new Response(JSON.stringify(out), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
