// Agente 2 — Geração de Sites + Deploy no Vercel
// Roda todo dia às 09h via GitHub Actions
// Pega leads novos, gera HTML via Claude API, deploya no Vercel

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SECRET_KEY;
const CLAUDE_KEY    = process.env.CLAUDE_API_KEY;
const VERCEL_TOKEN  = process.env.VERCEL_TOKEN;

const MAX_SITES_POR_DIA = 20; // controla custo

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

async function buscarLeadsNovos() {
  return await supabase(
    "GET",
    `leads?status=eq.novo&site_gerado=eq.false&order=id.asc&limit=${MAX_SITES_POR_DIA}`
  );
}

async function atualizarLead(id, dados) {
  await supabase("PATCH", `leads?id=eq.${id}`, dados);
}

async function gerarHTML(lead) {
  const wpp = lead.telefone ? lead.telefone.replace(/\D/g, '') : '';

  const prompt = `Crie um site HTML completo para: ${lead.nome} (${lead.nicho} em ${lead.cidade}).
Tel: ${lead.telefone || ""}. Endereço: ${lead.endereco || ""}. ${lead.avaliacao ? `Avaliação: ${lead.avaliacao}★ (${lead.total_avaliacoes} avaliações).` : ""}

REGRAS:
- HTML+CSS+JS em um único arquivo
- Design moderno e responsivo para o nicho ${lead.nicho}
- Seções: hero com CTA, serviços (3 cards), contato e footer
- Botão WhatsApp flutuante: https://wa.me/55${wpp}
- CSS simples e direto, sem animações complexas
- Fontes do Google Fonts adequadas ao nicho
- Use o nome real da empresa em todo o site
- Meta tags SEO com nome e cidade
- IMPORTANTE: o HTML deve ser curto e completo, terminando com </html>
- RETORNE APENAS O CÓDIGO HTML, sem markdown, sem backticks`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
     model: "claude-sonnet-4-6",
max_tokens: 6000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Erro Claude API");

  let html = data.content?.[0]?.text || "";
  html = html.replace(/^```html\n?/i, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim();

  if (!html.includes("<html") && !html.includes("<!DOCTYPE")) {
    throw new Error("HTML inválido gerado");
  }

  return html;
}

function slugify(nome) {
  return nome
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .substring(0, 50);
}

async function deployVercel(nome, html) {
  const projectName = `agencia-${slugify(nome)}-${Date.now()}`;

  const res = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: projectName,
      files: [{
        file: "index.html",
        data: html,
      }],
      projectSettings: {
        framework: null,
      },
      target: "production",
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || "Erro Vercel API");
  }

  // Aguarda deploy ficar pronto (máx 30s)
  const deployId = data.id;
  let url = data.url;
  let tentativas = 0;

  while (tentativas < 10) {
    await new Promise(r => setTimeout(r, 3000));
    const check = await fetch(`https://api.vercel.com/v13/deployments/${deployId}`, {
      headers: { "Authorization": `Bearer ${VERCEL_TOKEN}` },
    });
    const checkData = await check.json();
    if (checkData.readyState === "READY") {
      url = checkData.url;
      break;
    }
    tentativas++;
  }

  return { url: `https://${url}`, deployId };
}

async function deletarSitesExpirados() {
  // Busca leads expirados com site no Vercel
  const expirados = await supabase(
    "GET",
    `leads?status=eq.novo&site_gerado=eq.true&expira_em=lt.${new Date().toISOString()}&limit=50`
  );

  if (!Array.isArray(expirados) || !expirados.length) return;

  console.log(`\nLimpando ${expirados.length} sites expirados...`);

  for (const lead of expirados) {
    if (lead.site_vercel_id) {
      try {
        await fetch(`https://api.vercel.com/v13/deployments/${lead.site_vercel_id}`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${VERCEL_TOKEN}` },
        });
      } catch (e) {
        console.log(`  Erro ao deletar ${lead.nome}: ${e.message}`);
      }
    }
    await atualizarLead(lead.id, { status: "expirado" });
  }

  console.log(`  ${expirados.length} sites deletados do Vercel`);
}

async function main() {
  console.log("=== AGENTE 2 — GERAÇÃO DE SITES ===");
  console.log(`Iniciado em: ${new Date().toISOString()}`);

  // Limpa sites expirados primeiro
  await deletarSitesExpirados();

  // Busca leads novos
  const leads = await buscarLeadsNovos();
  if (!Array.isArray(leads) || !leads.length) {
    console.log("\nNenhum lead novo para processar hoje.");
    return;
  }

  console.log(`\n${leads.length} leads para gerar sites`);
  const resultados = [];

  for (const lead of leads) {
    console.log(`\nProcessando: ${lead.nome} (${lead.nicho} - ${lead.cidade})`);

    try {
      // Gera HTML
      console.log("  Gerando HTML via Claude...");
      const html = await gerarHTML(lead);
      console.log(`  HTML gerado (${html.length} chars)`);

      // Deploya no Vercel
      console.log("  Deployando no Vercel...");
      const { url, deployId } = await deployVercel(lead.nome, html);
      console.log(`  ✓ Site no ar: ${url}`);

      // Atualiza Supabase
      await atualizarLead(lead.id, {
        site_gerado: true,
        site_url: url,
        site_vercel_id: deployId,
        status: "site_gerado",
        expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });

      resultados.push({
        nome: lead.nome,
        telefone: lead.telefone || "Não informado",
        nicho: lead.nicho,
        cidade: lead.cidade,
        url,
      });

      // Pausa entre gerações para não sobrecarregar
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.log(`  ✗ Erro: ${err.message}`);
      await atualizarLead(lead.id, { status: "erro_geracao" });
    }
  }

  console.log(`\n✓ ${resultados.length} sites gerados e no ar`);

  // Salva resumo do dia para o agente 3
  const fs = await import("fs");
  fs.writeFileSync("/tmp/sites-do-dia.json", JSON.stringify(resultados, null, 2));
  console.log("Resumo salvo para relatório");
  console.log("=== FIM AGENTE 2 ===");
}

main().catch(err => {
  console.error("ERRO:", err);
  process.exit(1);
});
