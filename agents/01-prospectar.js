// Agente 1 — Prospecção
// Roda todo dia às 08h via GitHub Actions
// Busca empresas sem site no Google Maps e salva no Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const GOOGLE_KEY   = process.env.GOOGLE_PLACES_API_KEY;

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function buscarProximaFila() {
  const data = await supabase(
    "GET",
    `fila_prospeccao?status=eq.pendente&order=id.asc&limit=1`
  );
  return Array.isArray(data) ? data[0] : null;
}

async function marcarFilaProcessada(id, total) {
  await supabase("PATCH", `fila_prospeccao?id=eq.${id}`, {
    status: "processado",
    processado_em: new Date().toISOString(),
    total_encontrados: total,
  });
}

async function leadJaExiste(nome, cidade) {
  const data = await supabase(
    "GET",
    `leads?nome=eq.${encodeURIComponent(nome)}&cidade=eq.${encodeURIComponent(cidade)}&limit=1`
  );
  return Array.isArray(data) && data.length > 0;
}

async function salvarLeads(leads) {
  if (!leads.length) return 0;
  const result = await supabase("POST", "leads", leads);
  return Array.isArray(result) ? result.length : 0;
}

async function buscarEmpresas(nicho, cidade, estado) {
  const query = `${nicho} em ${cidade} ${estado}`;
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=pt-BR&key=${GOOGLE_KEY}`;
  
  console.log(`  Buscando: "${query}"`);
  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK") {
    console.log(`  API retornou: ${data.status} — ${data.error_message || ""}`);
    return [];
  }

  return data.results || [];
}

async function buscarDetalhes(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website,formatted_address,rating,user_ratings_total&language=pt-BR&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.status === "OK" ? data.result : null;
}

async function main() {
  console.log("=== AGENTE 1 — PROSPECÇÃO ===");
  console.log(`Iniciado em: ${new Date().toISOString()}`);

  const fila = await buscarProximaFila();
  if (!fila) {
    console.log("Fila vazia! Todas as combinações já foram processadas.");
    return;
  }

  console.log(`\nProcessando: ${fila.nicho} em ${fila.cidade} - ${fila.estado}`);

  const resultados = await buscarEmpresas(fila.nicho, fila.cidade, fila.estado);
  console.log(`  ${resultados.length} empresas encontradas no Maps`);

  if (!resultados.length) {
    await marcarFilaProcessada(fila.id, 0);
    return;
  }

  // Busca detalhes em paralelo (máx 20)
  const detalhesPromises = resultados.slice(0, 20).map(p => buscarDetalhes(p.place_id));
  const detalhes = await Promise.all(detalhesPromises);

  // Filtra sem website
  const semSite = detalhes.filter(d => d && !d.website);
  console.log(`  ${semSite.length} sem site`);

  // Prepara para salvar (evita duplicatas)
  const novosLeads = [];
  for (const d of semSite) {
    const existe = await leadJaExiste(d.name, fila.cidade);
    if (!existe) {
      novosLeads.push({
        nome: d.name,
        telefone: d.formatted_phone_number || null,
        endereco: d.formatted_address || null,
        avaliacao: d.rating || null,
        total_avaliacoes: d.user_ratings_total || 0,
        nicho: fila.nicho,
        cidade: fila.cidade,
        estado: fila.estado,
        status: "novo",
      });
    }
  }

  const salvos = await salvarLeads(novosLeads);
  await marcarFilaProcessada(fila.id, salvos);

  console.log(`\n✓ ${salvos} leads novos salvos no Supabase`);
  console.log("=== FIM AGENTE 1 ===");
}

main().catch(err => {
  console.error("ERRO:", err);
  process.exit(1);
});
