import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Publish 1 or more 1080x1080 images (data URLs) to Facebook Page + Instagram Business as a single post / carousel.
// Requires secrets: META_PAGE_ID, META_PAGE_ACCESS_TOKEN, META_IG_BUSINESS_ID
// Images are uploaded to the public `marketing-attachments` bucket to get public URLs (Meta requires public URLs).

const GRAPH = 'https://graph.facebook.com/v22.0';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

class MetaApiError extends Error {
  constructor(
    public readonly step: string,
    public readonly status: number,
    public readonly payload: any,
  ) {
    super(`${step}: ${JSON.stringify(payload)}`);
  }
}

const toMetaParam = (value: unknown) => Array.isArray(value)
  ? value.join(',')
  : typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : String(value);

const metaGet = async (path: string, params: Record<string, unknown>, token: string, step: string) => {
  const url = new URL(`${GRAPH}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, toMetaParam(value)));
  url.searchParams.set('access_token', token);
  const r = await fetch(url);
  const payload = await r.json().catch(() => ({ error: { message: 'Risposta Meta non valida' } }));
  if (!r.ok || payload?.error) throw new MetaApiError(step, r.status, payload);
  return payload;
};

const metaPost = async (path: string, body: Record<string, unknown>, token: string, step: string) => {
  const form = new URLSearchParams();
  Object.entries(body).forEach(([key, value]) => form.set(key, toMetaParam(value)));
  form.set('access_token', token);
  const r = await fetch(`${GRAPH}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const payload = await r.json().catch(() => ({ error: { message: 'Risposta Meta non valida' } }));
  if (!r.ok || payload?.error) throw new MetaApiError(step, r.status, payload);
  return payload;
};

const resolvePageAccessToken = async (pageId: string, configuredToken: string) => {
  let token = configuredToken;
  let tokenSource = 'configured_page_token';
  let selectedPage: any = null;

  try {
    const accounts = await metaGet('/me/accounts', {
      fields: 'id,name,access_token,instagram_business_account{id,username}',
      limit: 100,
    }, configuredToken, 'Recupero Page Access Token');
    const page = Array.isArray(accounts?.data)
      ? accounts.data.find((p: any) => String(p?.id) === String(pageId))
      : null;
    if (page?.access_token) {
      token = page.access_token;
      tokenSource = 'derived_page_token';
      selectedPage = page;
    }
  } catch (_) {
    // Se il secret è già un Page Access Token, /me/accounts può non essere disponibile: procediamo con quello configurato.
  }

  if (!selectedPage) {
    try {
      selectedPage = await metaGet(`/${pageId}`, {
        fields: 'id,name,instagram_business_account{id,username}',
      }, token, 'Verifica Page Access Token');
    } catch (_) {
      selectedPage = null;
    }
  }

  return { token, tokenSource, page: selectedPage };
};

const friendlyMetaError = (error: MetaApiError) => {
  const meta = error.payload?.error;
  const message = String(meta?.message || 'Errore Meta non specificato');
  if (meta?.code === 10 && message.includes('instagram_content_publish')) {
    return {
      ok: false,
      code: 'META_INSTAGRAM_PERMISSION_MISSING',
      error: 'Instagram non autorizzato: il token Meta non include il permesso attivo instagram_content_publish.',
      action: 'Genera un nuovo Page Access Token dalla stessa app Meta aggiungendo instagram_basic e instagram_content_publish, seleziona la pagina Tecnofra e l’account Instagram collegato, poi aggiorna META_PAGE_ACCESS_TOKEN.',
      meta: { step: error.step, code: meta.code, type: meta.type, fbtrace_id: meta.fbtrace_id },
    };
  }
  if (meta?.code === 100 && meta?.error_subcode === 33) {
    return {
      ok: false,
      code: 'META_INSTAGRAM_OBJECT_NOT_ACCESSIBLE',
      error: 'Instagram non accessibile: l’ID account o il token non hanno accesso all’account Instagram Business configurato.',
      action: 'Verifica META_IG_BUSINESS_ID e rigenera il token scegliendo la pagina Tecnofra con l’account Instagram collegato.',
      meta: { step: error.step, code: meta.code, subcode: meta.error_subcode, type: meta.type, fbtrace_id: meta.fbtrace_id },
    };
  }
  return {
    ok: false,
    code: 'META_API_ERROR',
    error: `${error.step}: ${message}`,
    action: 'Controlla token, permessi Meta e collegamento tra pagina Facebook e account Instagram Business.',
    meta: { step: error.step, code: meta?.code, subcode: meta?.error_subcode, type: meta?.type, fbtrace_id: meta?.fbtrace_id },
  };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const PAGE_ID = Deno.env.get('META_PAGE_ID');
    const CONFIGURED_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN');
    const IG_ID = Deno.env.get('META_IG_BUSINESS_ID');
    if (!PAGE_ID || !CONFIGURED_TOKEN || !IG_ID) {
      return jsonResponse({ error: 'Configurare i secret META_PAGE_ID, META_PAGE_ACCESS_TOKEN, META_IG_BUSINESS_ID' }, 400);
    }

    const { token: TOKEN, tokenSource, page } = await resolvePageAccessToken(PAGE_ID, CONFIGURED_TOKEN);
    const linkedIgId = page?.instagram_business_account?.id ? String(page.instagram_business_account.id) : '';
    const effectiveIgId = linkedIgId || IG_ID;
    if (IG_ID && linkedIgId && String(IG_ID) !== linkedIgId) {
      console.warn('META_IG_BUSINESS_ID diverso dall’account Instagram collegato alla pagina; uso account collegato alla pagina', {
        configuredIgId: IG_ID,
        linkedIgId,
      });
    }

    const { slides, caption, targets = ['facebook', 'instagram'] } = await req.json() as {
      slides: string[]; // data URLs
      caption: string;
      targets?: ('facebook' | 'instagram')[];
    };
    if (!slides?.length) return jsonResponse({ error: 'Nessuna slide' }, 400);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1) upload each slide → public URL
    const publicUrls: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const dataUrl = slides[i];
      const m = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!m) throw new Error('Slide non valida (atteso data URL)');
      const mime = m[1];
      const bin = atob(m[2]);
      const buf = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
      const path = `social/${Date.now()}-${i}.png`;
      const up = await supabase.storage.from('marketing-attachments').upload(path, buf, { contentType: mime, upsert: true });
      if (up.error) throw new Error('Upload storage: ' + up.error.message);
      const { data: pub } = supabase.storage.from('marketing-attachments').getPublicUrl(path);
      publicUrls.push(pub.publicUrl);
    }

    const results: any = { facebook: null, instagram: null };

    // 2) Facebook
    if (targets.includes('facebook')) {
      if (publicUrls.length === 1) {
        results.facebook = await metaPost(`/${PAGE_ID}/photos`, { url: publicUrls[0], caption }, TOKEN, 'Facebook foto');
      } else {
        // upload each as unpublished, then create a feed post linking them
        const mediaIds: string[] = [];
        for (const u of publicUrls) {
          const j = await metaPost(`/${PAGE_ID}/photos`, { url: u, published: false }, TOKEN, 'Facebook upload');
          mediaIds.push(j.id);
        }
        results.facebook = await metaPost(`/${PAGE_ID}/feed`, {
          message: caption,
          attached_media: mediaIds.map((id) => ({ media_fbid: id })),
        }, TOKEN, 'Facebook feed');
      }
    }

    // 3) Instagram
    if (targets.includes('instagram')) {
      if (publicUrls.length === 1) {
        const c = await metaPost(`/${effectiveIgId}/media`, { image_url: publicUrls[0], caption }, TOKEN, 'Instagram container');
        results.instagram = await metaPost(`/${effectiveIgId}/media_publish`, { creation_id: c.id }, TOKEN, 'Instagram pubblicazione');
      } else {
        const children: string[] = [];
        for (const u of publicUrls) {
          const c = await metaPost(`/${effectiveIgId}/media`, { image_url: u, is_carousel_item: true }, TOKEN, 'Instagram slide carosello');
          children.push(c.id);
        }
        const carousel = await metaPost(`/${effectiveIgId}/media`, { media_type: 'CAROUSEL', children, caption }, TOKEN, 'Instagram carosello');
        results.instagram = await metaPost(`/${effectiveIgId}/media_publish`, { creation_id: carousel.id }, TOKEN, 'Instagram pubblicazione carosello');
      }
    }

    return jsonResponse({ ok: true, urls: publicUrls, results, meta: { tokenSource, instagramId: effectiveIgId } });
  } catch (e) {
    if (e instanceof MetaApiError) return jsonResponse(friendlyMetaError(e));
    return jsonResponse({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
