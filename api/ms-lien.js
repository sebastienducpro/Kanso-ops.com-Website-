// Premiere etape du consentement asynchrone.
// La cliente ouvre ce lien quand elle veut, elle est renvoyee chez Microsoft.
const crypto = require('crypto');

const CLIENT_ID = process.env.MS_CLIENT_ID || '6db44042-86d6-4782-bd17-af0ba72cf549';
const AUTHORITY = 'https://login.microsoftonline.com/organizations';
const SCOPES = 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Contacts.Read https://graph.microsoft.com/Calendars.Read offline_access';
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

module.exports = async (req, res) => {
  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'kanso-ops.com'}`;
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(18));
  // Le dossier permet de savoir, au retour, de quelle mission il s'agit.
  const dossier = String((req.query && req.query.d) || '').replace(/[^\w.-]/g, '').slice(0, 40);

  const cookie = (n, v) => `${n}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1800`;
  res.setHeader('Set-Cookie', [cookie('kv', verifier), cookie('ks', state), cookie('kd', dossier)]);

  const u = new URL(AUTHORITY + '/oauth2/v2.0/authorize');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', origin + '/api/ms-retour');
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');

  res.writeHead(302, { Location: u.toString() });
  res.end();
};
