exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const key = process.env.GROQ_API_KEY;
  if (!key) return {
    statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({ error: "GROQ_API_KEY no configurada en Netlify." })
  };

  try {
    const body = JSON.parse(event.body || "{}");
    let text = "";

    let imgs = [];

    if (body.url) {
      const r = await fetch(body.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Upgrade-Insecure-Requests": "1",
        },
      });
      if (!r.ok) throw new Error(`No se pudo acceder a la página (${r.status})`);
      const html = await r.text();

      // Extrae URLs de imágenes de múltiples atributos HTML
      const addImg = (url) => {
        try { url = new URL(url).href; } catch { return; }
        if (!imgs.includes(url) && !/logo|icon|sprite|avatar|thumb_xs|favicon/i.test(url)) imgs.push(url);
      };
      // Atributos con URL directa
      const attrRx = /(?:src|data-src|data-lazy-src|data-original|data-lazy|data-image|data-full-src|data-large-src|data-url|href)=["'](https?[^"']*\.(?:jpe?g|png|webp)[^"']*)/gi;
      let m;
      while ((m = attrRx.exec(html)) !== null) addImg(m[1]);
      // srcset (puede tener múltiples URLs con descriptores)
      const srcsetRx = /srcset=["']([^"']+)/gi;
      while ((m = srcsetRx.exec(html)) !== null) {
        m[1].split(",").forEach(part => {
          const u = part.trim().split(/\s+/)[0];
          if (u.startsWith("http") && /\.(?:jpe?g|png|webp)/i.test(u)) addImg(u);
        });
      }
      // meta og:image y twitter:image
      const metaRx = /content=["'](https?[^"']*\.(?:jpe?g|png|webp)[^"']*)/gi;
      while ((m = metaRx.exec(html)) !== null) addImg(m[1]);
      // JSON embebido en scripts (ej: {"url":"https://...jpg"})
      const jsonRx = /["'](?:url|src|image|photo|picture)["']\s*:\s*["'](https?[^"']*\.(?:jpe?g|png|webp)[^"']*)/gi;
      while ((m = jsonRx.exec(html)) !== null) addImg(m[1]);

      // Solo texto al modelo — las fotos se adjuntan directamente, sin pasar por Groq
      text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .substring(0, 12000);

    } else if (body.text) {
      text = body.text.substring(0, 12000);
    } else {
      throw new Error("Enviá 'url' o 'text'.");
    }

    const prompt = `Sos un extractor de fichas inmobiliarias argentinas.
Devolvé ÚNICAMENTE JSON válido sin markdown:
{"tipo":"Casa","op":"alquiler","m2":"220","amb":"5","dorm":"4","ban":"3","gar":"2","pool":false,"precio":"450.000","moneda":"$","expensas":"85.000","monedaExp":"$","dir":"Calle 489, Gonnet","badge":"","frente":"","fondo":""}

Reglas:
- tipo: Departamento/Casa/Dúplex/Triplex/PH/Local/Oficina/Terreno/Cochera
- op: exactamente "venta" o "alquiler"
- moneda: "$" pesos, "USD" dólares. Alquiler casi siempre "$"
- precio: solo dígitos y puntos. "$ 450.000" → "450.000"
- Si tipo es Terreno: frente = metros de frente (solo número), fondo = metros de fondo (solo número)
- Sin datos: "" o false

CONTENIDO:
${text}`;

    const gr = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 512,
      }),
    });

    if (!gr.ok) throw new Error(`Groq error ${gr.status}: ${(await gr.text()).substring(0, 150)}`);

    const gd = await gr.json();
    const raw = (gd?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
    if (!raw) throw new Error("Groq no devolvió datos.");

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]+\}/); if (m) parsed = JSON.parse(m[0]); else throw new Error("JSON inválido: " + raw.substring(0, 80)); }

    // Adjuntamos las fotos extraídas directamente (Groq no las procesa)
    parsed.fotos = imgs;

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
