// Demande de l'exemple de cartographie.
// Envoie la notification a KANSO et renvoie le lien du document.
// Sans cle RESEND_API_KEY configuree, la fonction repond en echec propre :
// le site bascule alors sur un courriel pre-redige, aucune demande n'est perdue.

const DEST = process.env.LEAD_TO || 'sebastien.duc@kanso-ops.fr';
const FROM = process.env.LEAD_FROM || 'Site Kanso-Ops <site@kanso-ops.com>';

const esc = (v) => String(v == null ? '' : v)
  .replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
  .slice(0, 300);

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

  const nom = esc(d.nom), societe = esc(d.societe), fonction = esc(d.fonction), email = esc(d.email);
  if (!nom || !societe || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Champs manquants ou courriel invalide' });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(503).json({ ok: false, error: 'Notification non configuree' });

  const quand = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const html = `<div style="font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#3a3550">
    <p style="font:700 17px Arial;color:#140E59;margin:0 0 14px">Une demande d'exemple vient d'arriver</p>
    <table cellpadding="6" style="border-collapse:collapse;font-size:15px">
      <tr><td style="color:#7d7a8c">Nom</td><td><b>${nom}</b></td></tr>
      <tr><td style="color:#7d7a8c">Société</td><td><b>${societe}</b></td></tr>
      <tr><td style="color:#7d7a8c">Fonction</td><td>${fonction || 'non renseignée'}</td></tr>
      <tr><td style="color:#7d7a8c">Courriel</td><td><a href="mailto:${email}">${email}</a></td></tr>
      <tr><td style="color:#7d7a8c">Reçue le</td><td>${quand}</td></tr>
    </table>
    <p style="margin-top:18px;color:#7d7a8c;font-size:13.5px">L'exemple lui a déjà été ouvert automatiquement. Une relance à la main, quelques jours plus tard, vaut mieux qu'une séquence.</p>
  </div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [DEST], reply_to: email,
        subject: `Exemple demandé par ${nom}, ${societe}`, html,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('Resend', r.status, t);
      return res.status(502).json({ ok: false, error: 'Envoi refuse' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Resend', e && e.message);
    return res.status(502).json({ ok: false, error: 'Envoi impossible' });
  }
};
