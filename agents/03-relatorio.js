// Agente 3 — Relatório Diário
// Roda todo dia às 10h via GitHub Actions
// Envia lista de leads + sites por WhatsApp e Email

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SECRET_KEY;
const RESEND_KEY      = process.env.RESEND_API_KEY;
const CALLMEBOT_PHONE = process.env.CALLMEBOT_PHONE;
const CALLMEBOT_APIKEY = process.env.CALLMEBOT_APIKEY;
const EMAIL_DESTINO   = process.env.EMAIL_DESTINO;

async function supabase(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    },
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return []; }
}

async function buscarSitesDoDia() {
  // Leads com site gerado hoje
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  return await supabase(
    `leads?status=eq.site_gerado&criado_em=gte.${hoje.toISOString()}&order=id.desc&limit=50`
  );
}

async function enviarWhatsApp(mensagem) {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${CALLMEBOT_PHONE}&text=${encodeURIComponent(mensagem)}&apikey=${CALLMEBOT_APIKEY}`;
  const res = await fetch(url);
  const text = await res.text();
  console.log(`  WhatsApp: ${res.status} — ${text.substring(0, 100)}`);
  return res.ok;
}

async function enviarEmail(assunto, htmlBody, textoBody) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Agência de Sites <onboarding@resend.dev>",
      to: [EMAIL_DESTINO],
      subject: assunto,
      html: htmlBody,
      text: textoBody,
    }),
  });

  const data = await res.json();
  console.log(`  Email: ${res.status} — ${data.id || data.message || ""}`);
  return res.ok;
}

function formatarMensagemWhatsApp(leads, data) {
  const dataStr = data.toLocaleDateString("pt-BR");
  let msg = `📋 *Agência de Sites — ${dataStr}*\n`;
  msg += `✅ ${leads.length} site${leads.length > 1 ? "s" : ""} gerado${leads.length > 1 ? "s" : ""} hoje\n\n`;

  leads.forEach((lead, i) => {
    msg += `*${i + 1}. ${lead.nome}*\n`;
    msg += `📍 ${lead.cidade} — ${lead.nicho}\n`;
    msg += `📞 ${lead.telefone || "Sem telefone"}\n`;
    msg += `🌐 ${lead.site_url}\n\n`;
  });

  msg += `_Copie o link e o telefone para disparar no WhatsApp._`;
  return msg;
}

function formatarEmailHTML(leads, data) {
  const dataStr = data.toLocaleDateString("pt-BR");
  
  const linhas = leads.map((lead, i) => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:12px;font-weight:600">${i + 1}. ${lead.nome}</td>
      <td style="padding:12px">${lead.nicho}</td>
      <td style="padding:12px">${lead.cidade}</td>
      <td style="padding:12px">${lead.telefone || "—"}</td>
      <td style="padding:12px">
        <a href="${lead.site_url}" target="_blank" 
           style="background:#5b6af5;color:white;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:12px">
          Ver site
        </a>
      </td>
    </tr>
  `).join("");

  return `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#5b6af5;color:white;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:22px">📋 Leads do dia — ${dataStr}</h1>
        <p style="margin:8px 0 0;opacity:0.8">${leads.length} site${leads.length > 1 ? "s" : ""} gerado${leads.length > 1 ? "s" : ""} e no ar</p>
      </div>
      <table style="width:100%;border-collapse:collapse;background:white">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:12px;text-align:left">Empresa</th>
            <th style="padding:12px;text-align:left">Nicho</th>
            <th style="padding:12px;text-align:left">Cidade</th>
            <th style="padding:12px;text-align:left">Telefone</th>
            <th style="padding:12px;text-align:left">Site</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <div style="background:#f9f9f9;padding:16px;border-radius:0 0 8px 8px;font-size:13px;color:#666">
        Sites ficam no ar por 7 dias. Feche o cliente antes de expirar.
      </div>
    </div>
  `;
}

async function main() {
  console.log("=== AGENTE 3 — RELATÓRIO ===");
  console.log(`Iniciado em: ${new Date().toISOString()}`);

  const hoje = new Date();
  const leads = await buscarSitesDoDia();

  if (!Array.isArray(leads) || !leads.length) {
    console.log("Nenhum site gerado hoje para reportar.");

    // Envia aviso mesmo assim
    await enviarWhatsApp(`📋 Agência de Sites — ${hoje.toLocaleDateString("pt-BR")}\n\nNenhum site gerado hoje. Verifique os logs do GitHub Actions.`);
    return;
  }

  console.log(`\n${leads.length} leads para reportar`);

  // WhatsApp — manda em blocos de 10 (limite de chars)
  const blocos = [];
  for (let i = 0; i < leads.length; i += 10) {
    blocos.push(leads.slice(i, i + 10));
  }

  for (let i = 0; i < blocos.length; i++) {
    const msg = formatarMensagemWhatsApp(blocos[i], hoje);
    if (blocos.length > 1) {
      await enviarWhatsApp(`📋 Parte ${i + 1}/${blocos.length}\n\n${msg}`);
    } else {
      await enviarWhatsApp(msg);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Email
  const htmlEmail = formatarEmailHTML(leads, hoje);
  const textoEmail = formatarMensagemWhatsApp(leads, hoje).replace(/\*/g, "");
  await enviarEmail(
    `📋 ${leads.length} sites gerados — ${hoje.toLocaleDateString("pt-BR")}`,
    htmlEmail,
    textoEmail
  );

  console.log(`\n✓ Relatório enviado — ${leads.length} leads`);
  console.log("=== FIM AGENTE 3 ===");
}

main().catch(err => {
  console.error("ERRO:", err);
  process.exit(1);
});
Concluído
4. Clica em "Commit changes..." e confirma.

Me avisa quando feito!






