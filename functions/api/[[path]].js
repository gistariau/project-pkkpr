/**
 * ============================================================================
 * CLOUDFLARE PAGES FUNCTION — SAME-ORIGIN API PROXY (/api)
 * Menghubungkan FrontEnd (index.html) dengan Google Apps Script Web App
 * Environment Variable Wajib: GAS_WEB_APP_URL
 * ============================================================================
 */

const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 MB (mendukung unggahan file hingga 10 MB dalam Base64)
const UPSTREAM_TIMEOUT_MS = 40000;       // 40 Detik

export async function onRequest(context) {
  const { request, env } = context;

  // 1. Batasi metode HTTP yang diizinkan
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Allow': 'POST, OPTIONS',
        'Cache-Control': 'no-store'
      }
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      {
        success: false,
        message: 'Metode HTTP tidak diizinkan. Gunakan metode POST.'
      },
      405
    );
  }

  // 2. Periksa ketersediaan environment variable GAS_WEB_APP_URL
  const gasUrl = env && env.GAS_WEB_APP_URL ? String(env.GAS_WEB_APP_URL).trim() : '';
  if (!gasUrl || !gasUrl.startsWith('https://script.google.com/')) {
    return jsonResponse(
      {
        success: false,
        message: 'Konfigurasi server belum lengkap. Environment variable GAS_WEB_APP_URL belum diatur dengan benar pada Cloudflare Pages.'
      },
      500
    );
  }

  // 3. Validasi ukuran request header jika tersedia
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(
      {
        success: false,
        message: 'Ukuran payload melebihi batas maksimal yang diizinkan server.'
      },
      413
    );
  }

  // 4. Baca dan validasi JSON request dari FrontEnd
  let rawBody;
  try {
    rawBody = await request.text();
  } catch (readErr) {
    return jsonResponse(
      {
        success: false,
        message: 'Gagal membaca isi permintaan dari klien.'
      },
      400
    );
  }

  if (!rawBody || rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse(
      {
        success: false,
        message: 'Payload permintaan kosong atau terlalu besar.'
      },
      400
    );
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (jsonErr) {
    return jsonResponse(
      {
        success: false,
        message: 'Format JSON permintaan tidak valid.'
      },
      400
    );
  }

  if (!parsedBody || typeof parsedBody !== 'object' || !parsedBody.action) {
    return jsonResponse(
      {
        success: false,
        message: 'Parameter action wajib disertakan dalam payload JSON.'
      },
      400
    );
  }

  // 5. Teruskan permintaan ke Google Apps Script Web App dengan penanganan timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        'Accept': 'application/json'
      },
      body: JSON.stringify(parsedBody),
      redirect: 'follow',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const upstreamText = await upstreamResponse.text();
    let upstreamJson;

    try {
      upstreamJson = JSON.parse(upstreamText);
    } catch (parseErr) {
      return jsonResponse(
        {
          success: false,
          message: 'Respons dari Google Apps Script bukan JSON yang valid. Pastikan Web App di-deploy dengan akses "Anyone" (Siapa saja).'
        },
        502
      );
    }

    return jsonResponse(upstreamJson, 200);
  } catch (err) {
    clearTimeout(timeoutId);

    if (err && err.name === 'AbortError') {
      return jsonResponse(
        {
          success: false,
          message: 'Koneksi ke Google Apps Script melebihi batas waktu (timeout).'
        },
        504
      );
    }

    return jsonResponse(
      {
        success: false,
        message: 'Gagal menghubungi backend Google Apps Script.'
      },
      502
    );
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    }
  });
}