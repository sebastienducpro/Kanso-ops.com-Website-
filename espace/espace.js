// Espace prive : dechiffre l'outil dans le navigateur.
// Le depot du site est public, donc seul le chiffre y est publie (pilotage.enc.json).
// Ce n'est pas une « porte dans le navigateur » : sans le mot de passe, il n'existe aucun
// moyen de lire le contenu, ni ici ni sur GitHub. Algorithme identique au script de
// chiffrement : PBKDF2-SHA256 600 000 iterations, puis AES-256-GCM.
(function () {
  "use strict";
  var FICHIER = "pilotage.enc.json";
  var MEMO = "espace-cle-v1";
  var f = document.getElementById("f"), mdp = document.getElementById("mdp"),
      garder = document.getElementById("garder"), ok = document.getElementById("ok"),
      etat = document.getElementById("etat");

  function deb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64(buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function dire(t, err) { etat.textContent = t; etat.className = err ? "err" : ""; }
  function lireMemo() { try { return localStorage.getItem(MEMO); } catch (e) { return null; } }
  function ecrireMemo(v) { try { if (v) localStorage.setItem(MEMO, v); else localStorage.removeItem(MEMO); } catch (e) {} }

  if (/[?&]oublier\b/.test(location.search)) { ecrireMemo(null); dire("Cet appareil est oublié."); }

  if (!window.crypto || !crypto.subtle) {
    dire("Ce navigateur ne sait pas déchiffrer. Ouvre la page en https, dans un navigateur récent.", true);
    ok.disabled = true; return;
  }

  var paquet = null;
  function charger() {
    if (paquet) return Promise.resolve(paquet);
    return fetch(FICHIER, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("fichier");
      return r.json();
    }).then(function (p) { paquet = p; return p; });
  }

  function deriver(motDePasse, p) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(motDePasse), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: deb64(p.sel), iterations: p.iter },
          base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
      });
  }

  function ouvrir(cle, p) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: deb64(p.iv) }, cle, deb64(p.donnees)).then(function (clair) {
      var html = new TextDecoder().decode(clair);
      document.open(); document.write(html); document.close();
    });
  }

  // Appareil memorise : la cle derivee (pas le mot de passe) est gardee pour ce sel.
  var memo = lireMemo();
  if (memo) {
    dire("Ouverture…");
    charger().then(function (p) {
      var m = JSON.parse(memo);
      if (m.sel !== p.sel) throw new Error("perime");
      return crypto.subtle.importKey("raw", deb64(m.cle), { name: "AES-GCM" }, false, ["decrypt"]).then(function (k) { return ouvrir(k, p); });
    }).catch(function () { ecrireMemo(null); dire(""); });
  }

  f.addEventListener("submit", function (e) {
    e.preventDefault();
    var motDePasse = mdp.value;
    if (!motDePasse) return;
    ok.disabled = true; dire("Déchiffrement…");
    charger().then(function (p) {
      return deriver(motDePasse, p).then(function (k) {
        return ouvrir(k, p).then(function () { return k; }, function () { throw new Error("mdp"); });
      }).then(function (k) {
        if (!garder.checked) return;
        return crypto.subtle.exportKey("raw", k).then(function (raw) { ecrireMemo(JSON.stringify({ sel: p.sel, cle: b64(raw) })); });
      });
    }).catch(function (err) {
      ok.disabled = false; mdp.select();
      dire(err && err.message === "fichier" ? "Le contenu est introuvable. Réessaie dans un instant." : "Mot de passe incorrect.", true);
    });
  });
})();
