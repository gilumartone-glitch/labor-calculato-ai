import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const stripHtml = (value = '') => value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const isFirewallChallenge = (text: string) =>
  /just a moment|cloudflare|cf-browser-verification|challenge-platform|cf_chl|enable javascript/i.test(text);

const simplify = (p: any) => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  permalink: p.permalink,
  price: p.price ?? p.prices?.price ?? '',
  regular_price: p.regular_price ?? p.prices?.regular_price ?? '',
  short_description: stripHtml(p.short_description),
  description: stripHtml(p.description),
  images: (p.images || []).map((i: any) => ({ src: i.src || i.thumbnail, alt: i.alt })),
  categories: (p.categories || []).map((c: any) => c.name),
  tags: (p.tags || []).map((t: any) => t.name),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const baseUrl = Deno.env.get('WOOCOMMERCE_URL');
    const ck = Deno.env.get('WOOCOMMERCE_CONSUMER_KEY');
    const cs = Deno.env.get('WOOCOMMERCE_CONSUMER_SECRET');
    if (!baseUrl || !ck || !cs) return jsonResponse({ error: 'WooCommerce non configurato' }, 500);

    const url = new URL(req.url);
    const search = (url.searchParams.get('search') ?? '').trim();
    const page = String(Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1));
    const perPage = String(Math.min(50, Math.max(1, Number(url.searchParams.get('per_page') ?? '20') || 20)));
    const id = url.searchParams.get('id');

    const base = baseUrl.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
    const auth = 'Basic ' + btoa(`${ck}:${cs}`);
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: `${base}/`,
    };

    const buildAdminUrl = (withQueryCredentials: boolean, useRestRoute = false) => {
      const routePath = `/wc/v3/products${id ? `/${encodeURIComponent(id)}` : ''}`;
      const endpoint = useRestRoute
        ? new URL(`${base}/index.php`)
        : new URL(`${base}/wp-json${routePath}`);
      if (useRestRoute) endpoint.searchParams.set('rest_route', routePath);
      if (!id) {
        endpoint.searchParams.set('per_page', perPage);
        endpoint.searchParams.set('page', page);
        endpoint.searchParams.set('status', 'publish');
        if (search) endpoint.searchParams.set('search', search);
      }
      if (withQueryCredentials) {
        endpoint.searchParams.set('consumer_key', ck);
        endpoint.searchParams.set('consumer_secret', cs);
      }
      return endpoint.toString();
    };

    const buildStoreApiUrl = (useRestRoute = false) => {
      const routePath = `/wc/store/v1/products`;
      const endpoint = useRestRoute
        ? new URL(`${base}/index.php`)
        : new URL(`${base}/wp-json${routePath}`);
      if (useRestRoute) endpoint.searchParams.set('rest_route', routePath);
      endpoint.searchParams.set('per_page', perPage);
      endpoint.searchParams.set('page', page);
      if (search) endpoint.searchParams.set('search', search);
      return endpoint.toString();
    };

    const attempts = [
      { name: 'wc-query-auth', endpoint: buildAdminUrl(true), headers: browserHeaders },
      { name: 'wc-basic-auth', endpoint: buildAdminUrl(false), headers: { ...browserHeaders, Authorization: auth } },
      { name: 'wc-restroute-query-auth', endpoint: buildAdminUrl(true, true), headers: browserHeaders },
      { name: 'wc-restroute-basic-auth', endpoint: buildAdminUrl(false, true), headers: { ...browserHeaders, Authorization: auth } },
      ...(id ? [] : [
        { name: 'wc-store-api', endpoint: buildStoreApiUrl(), headers: browserHeaders },
        { name: 'wc-store-api-restroute', endpoint: buildStoreApiUrl(true), headers: browserHeaders },
      ]),
    ];

    let lastError: { status: number; detail: string; blocked: boolean; source: string } | null = null;

    for (const attempt of attempts) {
      const r = await fetch(attempt.endpoint, { headers: attempt.headers });
      const text = await r.text();
      const blocked = isFirewallChallenge(text);

      if (r.ok && !blocked) {
        const data = JSON.parse(text);
        const out = Array.isArray(data) ? data.map(simplify) : simplify(data);
        return jsonResponse(out);
      }

      lastError = { status: r.status, detail: text.slice(0, 500), blocked, source: attempt.name };
    }

    if (lastError?.blocked) {
      return jsonResponse({
        products: [],
        blocked: true,
        warning: 'Cloudflare/firewall sta bloccando le richieste REST con una pagina “Just a moment…”. Su Cloudflare crea una WAF Skip Rule per i path che iniziano con /wp-json/ e /index.php?rest_route= (Security Level: Essentially Off, Browser Integrity Check: Off, Bot Fight Mode: Off). In alternativa whitelist gli IP delle edge functions Supabase.',
      });
    }

    return jsonResponse({ error: `WooCommerce ${lastError?.status ?? 502}`, detail: lastError?.detail, source: lastError?.source }, 502);
  } catch (e) {
    return jsonResponse({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
