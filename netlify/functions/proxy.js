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

    if (body.url) {
      // Fetch simulando un browser real
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

      if (!r.ok) throw new Error(`La URL no existe (${r.status}). Verificá que el link sea válido y público.`);
      const html = await r.text();

      // Extraer imágenes
      const imgs = [];
      const rx = /(?:src|data-src|data-lazy)=["'](https?[^"']*\.(?:jpe?g|png|webp)[^"']*)/gi;
      let m;
      while ((m = rx.exec(html)) !== null) {
        if (!imgs.includes(m[1]) && !/logo|icon|sprite|thumb/i.test(m[1])) imgs.push(m[1]);
      }

      // Limpiar HTML
      text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .substring(0, 14000);

      if (imgs.length) text += "\n\nURLs de imágenes:\n" + imgs.slice(0, 10).join("\n");

    } else if (body.text) {
      text = body.text.substring(0, 14000);
    } else {
      throw new Error("Enviá 'url' o 'text'.");
    }

    const prompt = `Sos un extractor de fichas inmobiliarias argentinas.
Devolvé ÚNICAMENTE JSON válido sin markdown:
{"tipo":"Casa","op":"alquiler","m2":"220","amb":"5","dorm":"4","ban":"3","gar":"2","pool":false,"precio":"450.000","moneda":"$","expensas":"85.000","monedaExp":"$","dir":"Calle 489, Gonnet","badge":"","fotos":[]}

Reglas:
- tipo: Departamento/Casa/Dúplex/Triplex/PH/Local/Oficina/Terreno/Cochera
- op: exactamente "venta" o "alquiler"
- moneda: "$" pesos, "USD" dólares. Alquiler casi siempre "$"
- precio: solo dígitos y puntos. "$ 450.000" → "450.000"
- fotos: URLs absolutas http de fotos (máx 10)
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
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });

    if (!gr.ok) throw new Error(`Groq error ${gr.status}: ${(await gr.text()).substring(0, 150)}`);

    const gd = await gr.json();
    const raw = (gd?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
    if (!raw) throw new Error("Groq no devolvió datos.");

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]+\}/); if (m) parsed = JSON.parse(m[0]); else throw new Error("JSON inválido: " + raw.substring(0, 80)); }

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
