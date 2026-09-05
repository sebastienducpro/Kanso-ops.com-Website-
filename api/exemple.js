// Demande de l'exemple de cartographie.
// Envoie la notification a KANSO et renvoie le lien du document.
// Sans cle RESEND_API_KEY configuree, la fonction repond en echec propre :
// le site bascule alors sur un courriel pre-redige, aucune demande n'est perdue.

const DEST = process.env.LEAD_TO || 'sebastien.duc@kanso-ops.fr';
const FROM = process.env.LEAD_FROM || 'Site Kanso-Ops <site@kanso-ops.com>';

// On borne AVANT d'echapper : couper apres decoupait une entite en plein milieu,
// et un « &am » orphelin dans le courriel de notification fait desordre.
const esc = (v) => String(v == null ? '' : v)
  .slice(0, 300)
  .replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Methode non autorisee' });
  }

  let d = req.body;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
  d = d || {};

  // champ leurre : rempli seulement par un robot
  if (d.site) return res.status(200).json({ ok: true, skipped: true });

  const nom = esc(d.nom), societe = esc(d.societe), fonction = esc(d.fonction), email = esc(d.email), tel = esc(d.tel);
  const telNum = tel.replace(/[^0-9+]/g, '');
  if (!nom || !societe || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || telNum.length < 9) {
    return res.status(400).json({ ok: false, error: 'Champs manquants, courriel ou telephone invalide' });
  }

  // Passe par le workflow n8n dedie SITE - Exemple cartographie (actif) :
  // il repond au site, envoie le lien au prospect et la notification a la boite pro.
  // L ancien defaut pointait contact-kanso, un workflow dormant : rien ne partait.
  const hook = process.env.LEAD_WEBHOOK_URL || 'https://demo-n8n-kanso-u62809.vm.elestio.app/webhook/site-exemple';
  const key = process.env.RESEND_API_KEY;      // envoi direct, en secours
  if (!hook && !key) return res.status(503).json({ ok: false, error: 'Notification non configuree' });

  const quand = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const html = `<div style="font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#3a3550">
    <p style="font:700 17px Arial;color:#140E59;margin:0 0 14px">Une demande d'exemple vient d'arriver</p>
    <table cellpadding="6" style="border-collapse:collapse;font-size:15px">
      <tr><td style="color:#7d7a8c">Nom</td><td><b>${nom}</b></td></tr>
      <tr><td style="color:#7d7a8c">Société</td><td><b>${societe}</b></td></tr>
      <tr><td style="color:#7d7a8c">Fonction</td><td>${fonction || 'non renseignée'}</td></tr>
      <tr><td style="color:#7d7a8c">Courriel</td><td><a href="mailto:${email}"><b>${email}</b></a></td></tr>
      <tr><td style="color:#7d7a8c">Téléphone</td><td><a href="tel:${telNum}"><b>${tel}</b></a></td></tr>
      <tr><td style="color:#7d7a8c">Reçue le</td><td>${quand}</td></tr>
    </table>
    <p style="margin-top:18px;color:#7d7a8c;font-size:13.5px">L'exemple lui a déjà été ouvert automatiquement. Un appel deux ou trois jours plus tard vaut mieux qu'une relance écrite.</p>
  </div>`;

  // 1 · le webhook n8n
  if (hook) {
    try {
      const r = await fetch(hook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // ⚠️ le workflow lit l'origine, le referer et l'agent dans les EN-TETES,
          // pas dans le corps. Sans eux, le controle anti-robots refuse en missing_origin.
          Origin: req.headers['origin'] || 'https://kanso-ops.com',
          Referer: req.headers['referer'] || 'https://kanso-ops.com/',
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (site kanso-ops.com)',
          'X-Forwarded-For': (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '',
          ...(process.env.LEAD_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.LEAD_WEBHOOK_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          // noms de champs lus par le workflow SITE - Exemple cartographie
          nom,
          societe,
          fonction,
          email,
          tel,
          site: '',
          request_origin: req.headers['origin'] || 'https://kanso-ops.com',
          user_agent: req.headers['user-agent'] || 'kanso-ops-site',
        }),
      });
      if (r.ok) return res.status(200).json({ ok: true, via: 'n8n' });
      console.error('n8n', r.status, await r.text());
      if (!key) return res.status(502).json({ ok: false, error: 'Notification refusee' });
    } catch (e) {
      console.error('n8n', e && e.message);
      if (!key) return res.status(502).json({ ok: false, error: 'Notification impossible' });
    }
  }

  // 2 · envoi direct, en secours
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [DEST], reply_to: email,
        subject: `Exemple demandé par ${nom}, ${societe} · ${tel}`, html,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('Resend', r.status, t);
      return res.status(502).json({ ok: false, error: 'Envoi refuse' });
    }
    return res.status(200).json({ ok: true, via: 'resend' });
  } catch (e) {
    console.error('Resend', e && e.message);
    return res.status(502).json({ ok: false, error: 'Envoi impossible' });
  }
};
