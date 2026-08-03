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
    const perPage = String(Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') ?? '20') || 20)));
    const id = url.searchParams.get('id');
    const category = (url.searchParams.get('category') ?? '').trim();
    const mode = url.searchParams.get('mode') ?? 'products';
    const fetchAll = url.searchParams.get('all') === '1';

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

    // Servizi = pagine WordPress (non prodotti WooCommerce)
    if (mode === 'services') {
      const EXCLUDE = /(termini|privacy|cookie|carrello|checkout|account|^home$|shop|portfolio|grazie|ricerca|wishlist)/i;
      const wpFetch = async (path: string) => {
        const r = await fetch(`${base}/wp-json/wp/v2/${path}`, { headers: browserHeaders });
        if (!r.ok) return null;
        const t = await r.text();
        if (isFirewallChallenge(t)) return null;
        try { return JSON.parse(t); } catch { return null; }
      };

      // 1) prendi gli slug dei servizi linkati dalla pagina "Servizi" del sito
      const hub = await wpFetch('pages?slug=servizi-offerti&_fields=content');
      const hubHtml: string = Array.isArray(hub) ? (hub[0]?.content?.rendered ?? '') : '';
      const serviceSlugs = Array.from(
        new Set(
          Array.from(hubHtml.matchAll(/href="https?:\/\/[^"]*?\/([a-z0-9-]+)\/"/gi))
            .map((m: any) => m[1])
            .filter((s: string) => !/^(portfolio|categoria-prodotto|prodotto|shop|wp-content)$/i.test(s))
        )
      );

      let items: any[] = [];
      if (serviceSlugs.length) {
        const chunk = serviceSlugs.slice(0, 60).join(',');
        const bySlug = await wpFetch(`pages?per_page=100&status=publish&_fields=id,link,slug,title,excerpt,content&slug=${chunk}`);
        if (Array.isArray(bySlug)) items = bySlug;
      }

      // 2) fallback: tutte le pagine del sito
      if (!items.length) {
        for (let p = 1; p <= 5; p++) {
          const pdata = await wpFetch(
            `pages?per_page=100&page=${p}&status=publish&_fields=id,link,slug,title,excerpt,content${search ? `&search=${encodeURIComponent(search)}` : ''}`
          );
          if (!Array.isArray(pdata) || pdata.length === 0) break;
          items.push(...pdata);
          if (pdata.length < 100) break;
        }
      }

      const q = search.toLowerCase();
      const services = items
        .filter((it) => !EXCLUDE.test(`${it.slug ?? ''} ${it.title?.rendered ?? ''}`))
        .filter((it) => !q || `${it.title?.rendered ?? ''} ${it.slug ?? ''}`.toLowerCase().includes(q))

        .map((it) => {
          const html: string = it.content?.rendered ?? '';
          const raw: string[] = [
            ...Array.from(html.matchAll(/<img[^>]+?(?:data-lazy-src|data-src|src)=["']([^"']+)["']/gi)).map((m: any) => m[1]),
            ...Array.from(html.matchAll(/(?:data-)?srcset=["']([^"']+)["']/gi))
              .flatMap((m: any) => String(m[1]).split(',').map((s) => s.trim().split(' ')[0])),
            ...Array.from(html.matchAll(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi)).map((m: any) => m[1]),
            ...Array.from(html.matchAll(/data-bg(?:-image)?=["']([^"']+)["']/gi)).map((m: any) => m[1]),
          ];
          const srcs = Array.from(new Set(raw))
            .filter((s: string) => /^https?:\/\//.test(s) && /\.(jpe?g|png|webp)(\?|$)/i.test(s))
            .slice(0, 8);
          const name = stripHtml(it.title?.rendered ?? '');

          return {
            id: it.id,
            name,
            slug: it.slug,
            permalink: it.link,
            price: '',
            regular_price: '',
            short_description: stripHtml(it.excerpt?.rendered ?? '').slice(0, 400),
            description: stripHtml(html).slice(0, 4000),
            images: srcs.map((src: string) => ({ src, alt: name })),
            categories: ['Servizi'],
            tags: [],
            is_service: true,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'it'));

      // fallback immagini: leggi og:image / prime <img> dalla pagina pubblica
      await Promise.all(
        services
          .filter((s) => s.images.length === 0)
          .map(async (s) => {
            try {
              const pr = await fetch(s.permalink, { headers: browserHeaders });
              if (!pr.ok) return;
              const phtml = await pr.text();
              if (isFirewallChallenge(phtml)) return;
              const found = [
                ...Array.from(phtml.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)).map((m: any) => m[1]),
                ...Array.from(phtml.matchAll(/<img[^>]+?(?:data-lazy-src|data-src|src)=["']([^"']+)["']/gi)).map((m: any) => m[1]),
                ...Array.from(phtml.matchAll(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi)).map((m: any) => m[1]),
              ];
              s.images = Array.from(new Set(found))
                .filter((u: string) => /^https?:\/\//.test(u) && /\.(jpe?g|png|webp)(\?|$)/i.test(u) && !/logo|icon|placeholder|avatar/i.test(u))
                .slice(0, 8)
                .map((src: string) => ({ src, alt: s.name }));
            } catch { /* immagini opzionali */ }
          })
      );

      return jsonResponse(services);

    }


    const buildAdminUrl = (withQueryCredentials: boolean, useRestRoute = false, pageOverride?: string) => {
      const routePath = mode === 'categories'
        ? '/wc/v3/products/categories'
        : `/wc/v3/products${id ? `/${encodeURIComponent(id)}` : ''}`;
      const endpoint = useRestRoute
        ? new URL(`${base}/index.php`)
        : new URL(`${base}/wp-json${routePath}`);
      if (useRestRoute) endpoint.searchParams.set('rest_route', routePath);
      if (mode === 'categories') {
        endpoint.searchParams.set('per_page', '100');
        endpoint.searchParams.set('page', pageOverride ?? '1');
        endpoint.searchParams.set('hide_empty', 'false');
        endpoint.searchParams.set('orderby', 'name');
      } else if (!id) {

        endpoint.searchParams.set('per_page', perPage);
        endpoint.searchParams.set('page', pageOverride ?? page);
        endpoint.searchParams.set('status', 'publish');
        endpoint.searchParams.set('orderby', 'id');
        endpoint.searchParams.set('order', 'asc');
        if (search) endpoint.searchParams.set('search', search);
        if (category) endpoint.searchParams.set('category', category);
      }

      if (withQueryCredentials) {
        endpoint.searchParams.set('consumer_key', ck);
        endpoint.searchParams.set('consumer_secret', cs);
      }
      return endpoint.toString();
    };

    const buildStoreApiUrl = (useRestRoute = false, pageOverride?: string) => {
      const routePath = mode === 'categories' ? `/wc/store/v1/products/categories` : `/wc/store/v1/products`;
      const endpoint = useRestRoute
        ? new URL(`${base}/index.php`)
        : new URL(`${base}/wp-json${routePath}`);
      if (useRestRoute) endpoint.searchParams.set('rest_route', routePath);
      endpoint.searchParams.set('per_page', mode === 'categories' ? '100' : perPage);
      endpoint.searchParams.set('page', pageOverride ?? (mode === 'categories' ? '1' : page));
      if (mode !== 'categories') {
        if (search) endpoint.searchParams.set('search', search);
        if (category) endpoint.searchParams.set('category', category);
      }
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
        if (mode === 'categories') {
          const mapCat = (c: any) => ({ id: c.id, name: c.name, slug: c.slug, count: c.count ?? 0 });
          const cats = (Array.isArray(data) ? data : []).map(mapCat);
          // WooCommerce limita a 100 elementi per pagina: scarica tutte le pagine
          let catPage = 2;
          while (cats.length >= 100 * (catPage - 1) && catPage <= 20) {
            const nextUrl = attempt.name.startsWith('wc-store')
              ? buildStoreApiUrl(attempt.name.includes('restroute'), String(catPage))
              : buildAdminUrl(attempt.name.includes('query-auth'), attempt.name.includes('restroute'), String(catPage));
            const nr = await fetch(nextUrl, { headers: attempt.headers });
            if (!nr.ok) break;
            const ntext = await nr.text();
            if (isFirewallChallenge(ntext)) break;
            let ndata: any;
            try { ndata = JSON.parse(ntext); } catch { break; }
            if (!Array.isArray(ndata) || ndata.length === 0) break;
            cats.push(...ndata.map(mapCat));
            if (ndata.length < 100) break;
            catPage++;
          }
          cats.sort((a, b) => a.name.localeCompare(b.name, 'it'));
          return jsonResponse(cats);

        }
        let out = Array.isArray(data) ? data.map(simplify) : simplify(data);

        if (fetchAll && Array.isArray(out) && !id) {
          const seen = new Set<number>(out.map((p: any) => p.id));
          const acc = [...out];
          const totalPages = Number(r.headers.get('x-wp-totalpages') ?? '0') || 0;
          const maxPages = Math.min(totalPages || 100, 100);
          let currentPage = 2;
          let emptyStreak = 0;
          while (currentPage <= maxPages) {
            const nextUrl = attempt.name.startsWith('wc-store')
              ? buildStoreApiUrl(attempt.name.includes('restroute'), String(currentPage))
              : buildAdminUrl(attempt.name.includes('query-auth'), attempt.name.includes('restroute'), String(currentPage));
            const nr = await fetch(nextUrl, { headers: attempt.headers });
            if (!nr.ok) break;
            const ntext = await nr.text();
            if (isFirewallChallenge(ntext)) break;
            let ndata: any;
            try { ndata = JSON.parse(ntext); } catch { break; }
            if (!Array.isArray(ndata) || ndata.length === 0) {
              // qualche pagina può tornare vuota: continua ancora un po' se sappiamo il totale
              if (totalPages && ++emptyStreak <= 2) { currentPage++; continue; }
              break;
            }
            emptyStreak = 0;
            for (const item of ndata.map(simplify)) {
              if (!seen.has(item.id)) { seen.add(item.id); acc.push(item); }
            }
            currentPage++;
            if (!totalPages && ndata.length < Number(perPage)) break;
          }
          out = acc;
        }

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
