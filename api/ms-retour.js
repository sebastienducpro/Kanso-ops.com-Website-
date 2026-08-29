// Retour de Microsoft apres consentement.
// Le jeton de renouvellement n'est JAMAIS stocke en clair ici : il est chiffre
// avec la cle publique ci-dessous, et seule la cle privee, qui reste sur la
// machine de Sebastien, peut le rouvrir. Le site n'a donc jamais acces a la boite.
const crypto = require('crypto');

const CLIENT_ID = process.env.MS_CLIENT_ID || '6db44042-86d6-4782-bd17-af0ba72cf549';
const AUTHORITY = 'https://login.microsoftonline.com/organizations';
const SCOPES = 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Contacts.Read https://graph.microsoft.com/Calendars.Read offline_access';
const HOOK = process.env.LEAD_WEBHOOK_URL || 'https://demo-n8n-kanso-u62809.vm.elestio.app/webhook/contact-kanso';

const PUBLIQUE = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA1KEasPaRF1JWWXlQLkoj
Y0Qw9aCOrW8Re17PCdogsEslo2tp1pWeP6WbxhoIGEgmQSOHNvWOTHNlpr5nwCFr
KvEiIvFnKSzn4XVUe0OeIC6D7Q/YMCCbU9OILaldxUEpgaR8yIeCdtmCs1OM5Xar
Y1NVncchwYIMaY02u2/yoh+gNRkG3UyIf/NHnXQscAoXIkxG4KWHTOJWnHMNepBG
gMjpZqOP8lNeiahIpVvzAd/SCyJVIZGb4cn2ZM4LuWkvGJ7J0Cl201sQ/FcgelkQ
BwCcM0K6OF5dqgLUN+ccvjBPKfn8e0nAD746hV+/mGGsL/YOx2IoVfxzTNty+r+5
SEsVtqJLmQSIMoH2j/WtAwym0XD9Qw+YIAk2fUZQs9nN3sMEf6yVlwEc31J3VJpv
QGoD+9eRI9P6DGFxaxZocpG3ZZgnQslJHmMATBXxoPM90qUA3Ea2LIg069NHfR6b
wiVYvoJCCUQ61695H28Cqeae6dSiJLOtfk3Rxnro2wCFAgMBAAE=
-----END PUBLIC KEY-----`;

// Chiffrement en enveloppe : une cle AES tiree au hasard protege le jeton,
// et la cle publique protege la cle AES. RSA seul ne suffirait pas, un jeton
// Microsoft depassant largement ce qu'une cle de 3072 bits peut chiffrer.
function chiffrer(texte) {
  const cle = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cle, iv);
  const corps = Buffer.concat([c.update(texte, 'utf8'), c.final()]);
  const scelle = crypto.publicEncrypt(
    { key: PUBLIQUE, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, cle);
  return {
    v: 1,
    cle: scelle.toString('base64'),
    iv: iv.toString('base64'),
    corps: corps.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
  };
}

const page = (titre, texte, ok) => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titre}</title>
<link href="https://fonts.googleapis.com/css2?family=Lato:wght@900&family=Open+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Open Sans',sans-serif;background:#140E59;color:#cfcbe6;
display:flex;align-items:center;justify-content:center;min-height:100vh;padding:26px;line-height:1.65}
.b{max-width:560px}.p{width:56px;height:56px;border-radius:50%;background:${ok ? '#148F44' : '#c0392b'};
display:flex;align-items:center;justify-content:center;font-size:30px;color:#fff;margin-bottom:24px}
h1{font-family:Lato,sans-serif;font-weight:900;color:#fff;font-size:29px;line-height:1.24;margin-bottom:16px}
p{margin-bottom:12px}a{color:#EF7D53}</style></head>
<body><div class="b"><div class="p">${ok ? '&#10003;' : '!'}</div><h1>${titre}</h1>${texte}</div></body></html>`;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const fin = (code, titre, texte, ok) => { res.statusCode = code; res.end(page(titre, texte, ok)); };

  const q = req.query || {};
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';')
    .map((c) => c.trim().split('=')).filter((p) => p.length === 2));
  // On efface les cookies quoi qu'il arrive.
  res.setHeader('Set-Cookie', ['kv', 'ks', 'kd'].map((n) => `${n}=; Path=/; Max-Age=0`));

  if (q.error) return fin(400, "L'autorisation n'a pas abouti",
    `<p>Microsoft a renvoyé : ${String(q.error_description || q.error).slice(0, 300)}</p>
     <p>Si votre informatique doit valider, prévenez votre interlocuteur chez Kanso-Ops, la démarche est prévue.</p>`, false);

  if (!q.code || !q.state || !cookies.ks || q.state !== cookies.ks || !cookies.kv) {
    return fin(400, 'Lien expiré', "<p>La page a été ouverte trop tard ou dans un autre navigateur. Redemandez simplement le lien, il se régénère en une seconde.</p>", false);
  }

  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  try {
    const r = await fetch(AUTHORITY + '/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID, grant_type: 'authorization_code', code: String(q.code),
        redirect_uri: origin + '/api/ms-retour', code_verifier: cookies.kv, scope: SCOPES,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) {
      console.error('token', r.status, JSON.stringify(j).slice(0, 400));
      return fin(502, "L'autorisation n'a pas abouti",
        '<p>Microsoft a bien reçu votre accord, mais la dernière étape a échoué. Prévenez votre interlocuteur, rien n\'est perdu.</p>', false);
    }

    let qui = '';
    try {
      const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName',
        { headers: { Authorization: 'Bearer ' + j.access_token } });
      const m = await me.json();
      qui = m.mail || m.userPrincipalName || '';
    } catch (e) { /* sans importance */ }

    const paquet = chiffrer(JSON.stringify({ refresh_token: j.refresh_token, boite: qui, scope: j.scope }));

    await fetch(HOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://kanso-ops.com', Referer: 'https://kanso-ops.com/',
        'User-Agent': 'Mozilla/5.0 (autorisation kanso-ops.com)',
      },
      body: JSON.stringify({
        prenom: '', nom: 'Autorisation de boîte accordée', email: qui || 'inconnu@kanso-ops.fr',
        entreprise: cookies.kd || 'dossier non précisé', telephone: '',
        sujet: 'AUTORISATION · accès boîte accordé' + (qui ? ' par ' + qui : ''),
        message: "Accord donné. Le jeton est chiffré ci-dessous, seul le poste de Sébastien peut l'ouvrir.\n\n"
          + JSON.stringify(paquet),
        source: 'kanso-ops.com, consentement Microsoft', honeypot: '',
      }),
    }).catch((e) => console.error('hook', e && e.message));

    return fin(200, "C'est fait, merci",
      `<p>Votre accord est enregistré${qui ? ', pour la boîte <b style="color:#fff">' + qui + '</b>' : ''}. Vous pouvez fermer cette page.</p>
       <p>L'accès est en <b style="color:#fff">lecture seule</b> : ni envoi, ni réponse, ni modification, ni suppression.</p>
       <p>Vous pouvez le retirer à tout moment, sans prévenir personne, depuis <a href="https://myapps.microsoft.com" target="_blank" rel="noopener">myapps.microsoft.com</a> : cliquez sur Kanso Extraction, puis sur Gérer votre application et Révoquer les autorisations.</p>`, true);
  } catch (e) {
    console.error('retour', e && e.message);
    return fin(500, 'Une erreur est survenue', '<p>Prévenez votre interlocuteur chez Kanso-Ops, la démarche est simplement à refaire.</p>', false);
  }
};
