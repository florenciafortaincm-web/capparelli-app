exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const key = process.env.GEMINI_API_KEY;
  if (!key) return {
    statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({ error: "GEMINI_API_KEY no configurada." })
  };

  try {
    const body = JSON.parse(event.body || "{}");
    let text = "";

    if (body.url) {
      // Fetch the page server-side (no CORS issues)
      const r = await fetch(body.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`No se pudo acceder a la pagina (${r.status})`);
      const html = await r.text();

      // Extract image URLs
      const imgs = [];
      const rx = /(?:src|data-src)=["'](https?[^"']*\.(?:jpe?g|png|webp)[^"']*)/gi;
      let m;
      while ((m = rx.exec(html)) !== null) {
        if (!imgs.includes(m[1]) && !/logo|icon|sprite/i.test(m[1])) imgs.push(m[1]);
      }

      // Clean HTML to text
      text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .substring(0, 18000);

      if (imgs.length) text += "\n\nURLs de imagenes:\n" + imgs.slice(0, 12).join("\n");

    } else if (body.text) {
      text = body.text.substring(0, 18000);
    } else {
      throw new Error("Envia 'url' o 'text'.");
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

    const gr = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        }),
      }
    );

    if (!gr.ok) throw new Error(`Gemini error ${gr.status}: ${(await gr.text()).substring(0, 150)}`);

    const gd = await gr.json();
    const raw = (gd?.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/```json|```/g, "").trim();
    if (!raw) throw new Error("Gemini no devolvió datos.");

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
