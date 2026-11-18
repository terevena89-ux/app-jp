// =========================================================
// JP — ma bibliothèque de jurisprudences
//   1. Réglages de l'appareil   2. Données et synchro (Firebase)
//   3. Filtres                  4. Affichage : barre de côté, frise, liste
//   5. Fiche et formulaire      6. Réglages, thème, notes
//   7. Excel                    8. Démarrage
// =========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, setDoc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { chargerExcelJS, ajouterFeuille, telechargerClasseur, lireClasseur } from "./excel-style.js";
import { JURIDICTIONS, decouper, libelle, dateLongue } from "./reference.js";

const VERSION = "0.1.0";
const NOM_APPLI = "app-jp";
const MODE_DEMO = new URLSearchParams(location.search).has("demo");

const PORTEES = { principe: "Principe", revirement: "Revirement", confirmation: "Confirmation", precision: "Précision / espèce", isole: "Isolé / contraire" };
const IMPORTANCES = { 3: "Majeure", 2: "Utile", 1: "Secondaire" };
const RAYON = { 3: 8, 2: 5.5, 1: 3.5 };

const $ = id => document.getElementById(id);
const echapper = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const simple = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ic = nom => `<svg class="ic"><use href="#i-${nom}"></use></svg>`;
const couleurJur = j => `var(--j-${j || "fond"})`;
const couleurPor = p => `var(--p-${p || "precision"})`;

// ---------- 1. Réglages de l'appareil (pas synchronisés) ----------
let reglages = { theme: "auto", animations: "completes", couleur: "jur" };
try { Object.assign(reglages, JSON.parse(localStorage.getItem("jp-reglages")) || {}); } catch (e) {}
function changerReglage(cle, val) {
  reglages[cle] = val;
  try { localStorage.setItem("jp-reglages", JSON.stringify(reglages)); } catch (e) {}
}
const couleurDe = jp => reglages.couleur === "por" ? couleurPor(jp.portee) : couleurJur(jp.jur);

// ---------- 2. Données et synchro ----------
// Une JP = un document Firestore (users/{uid}/app-jp/donnees/jps/{id}) :
// pas de limite de taille globale, et chaque fiche se synchronise seule (la dernière modif gagne).
let jps = new Map();
let idees = "";
let db = null, auth = null, colJps = null, refDonnees = null;
let metaSynchro = null;

function normaliser(o) {
  return {
    id: String(o.id || nouvelId()),
    ref: String(o.ref || ""),
    jur: JURIDICTIONS[o.jur] ? o.jur : "",
    formation: String(o.formation || ""),
    date: /^\d{4}-\d{2}-\d{2}$/.test(o.date || "") ? o.date : "",
    numero: String(o.numero || ""),
    tags: Array.isArray(o.tags) ? o.tags.map(String).filter(Boolean) : [],
    imp: [1, 2, 3].includes(Number(o.imp)) ? Number(o.imp) : 2,
    portee: PORTEES[o.portee] ? o.portee : "",
    resume: String(o.resume || ""),
    citations: String(o.citations || ""),
    lien: String(o.lien || ""),
    pdf: String(o.pdf || ""),
    modifie: Number(o.modifie) || Date.now()
  };
}

function sauverDemo() {
  try { localStorage.setItem("jp-demo", JSON.stringify({ jps: [...jps.values()], idees })); } catch (e) {}
}

function enregistrerJp(jp) {
  jp = normaliser({ ...jp, modifie: Date.now() });
  jps.set(jp.id, jp);
  if (MODE_DEMO) sauverDemo();
  else setDoc(doc(colJps, jp.id), jp).catch(erreurEcriture);
  dessiner();
  return jp;
}

function supprimerJp(id) {
  jps.delete(id);
  if (MODE_DEMO) sauverDemo();
  else deleteDoc(doc(colJps, id)).catch(erreurEcriture);
  dessiner();
}

function enregistrerIdees(texte) {
  idees = texte;
  if (MODE_DEMO) sauverDemo();
  else setDoc(refDonnees, { idees }, { merge: true }).catch(erreurEcriture);
}

function erreurEcriture(err) { console.error(err); toast("Échec de l'enregistrement"); }

function demarrerFirebase() {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  onAuthStateChanged(auth, user => {
    if (!user) { $("ecran-connexion").hidden = false; $("appli").hidden = true; return; }
    $("ecran-connexion").hidden = true; $("appli").hidden = false;
    $("compte-info").textContent = `Connecté : ${user.displayName || user.email}`;
    refDonnees = doc(db, "users", user.uid, NOM_APPLI, "donnees");
    colJps = collection(refDonnees, "jps");
    onSnapshot(colJps, { includeMetadataChanges: true }, snap => {
      majSynchro(snap.metadata);
      if (snap.metadata.hasPendingWrites && !snap.docChanges().length) return;
      jps = new Map(snap.docs.map(d => { const jp = normaliser(d.data()); return [jp.id, jp]; }));
      dessiner();
      if (couche && couche.nom === "fiche") rafraichirFiche();
    });
    onSnapshot(refDonnees, snap => {
      idees = (snap.exists() && snap.data().idees) || "";
      NotesIdees.maj(idees);
    });
  });
}

function demarrerDemo() {
  try {
    const d = JSON.parse(localStorage.getItem("jp-demo")) || {};
    jps = new Map((d.jps || []).map(o => { const jp = normaliser(o); return [jp.id, jp]; }));
    idees = d.idees || "";
  } catch (e) { jps = new Map(); }
  $("ecran-connexion").hidden = true; $("appli").hidden = false;
  $("compte-info").textContent = "Mode démo : données gardées sur cet appareil.";
  majSynchro(null);
  dessiner();
}

async function seConnecter() {
  const fournisseur = new GoogleAuthProvider();
  $("connexion-erreur").hidden = true;
  try { await signInWithPopup(auth, fournisseur); }
  catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") signInWithRedirect(auth, fournisseur);
    else if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
      $("connexion-erreur").textContent = "Connexion impossible : " + err.message;
      $("connexion-erreur").hidden = false;
    }
  }
}

function majSynchro(meta) {
  if (meta !== undefined) metaSynchro = meta;
  let cls = "", texte = "Synchronisé";
  if (MODE_DEMO) { cls = "off"; texte = "Aucune (démo)"; }
  else if (!navigator.onLine) { cls = "off"; texte = "Hors ligne"; }
  else if (metaSynchro && metaSynchro.hasPendingWrites) { cls = "attente"; texte = "En attente"; }
  $("synchro").className = "synchro " + cls;
  $("synchro").querySelector("span").textContent = texte;
}
addEventListener("online", () => majSynchro());
addEventListener("offline", () => majSynchro());

// ---------- 3. Filtres ----------
const filtre = { sujet: "", q: "", jur: new Set(), por: new Set(), imp: new Set() };

function tousLesSujets() {
  const s = new Set();
  jps.forEach(jp => jp.tags.forEach(t => s.add(t)));
  return [...s].sort((a, b) => a.localeCompare(b, "fr"));
}

function jpsFiltrees() {
  const q = simple(filtre.q).trim();
  return [...jps.values()].filter(jp =>
    (!filtre.sujet || jp.tags.includes(filtre.sujet)) &&
    (!filtre.jur.size || filtre.jur.has(jp.jur)) &&
    (!filtre.por.size || filtre.por.has(jp.portee)) &&
    (!filtre.imp.size || filtre.imp.has(String(jp.imp))) &&
    (!q || simple([libelle(jp), jp.ref, jp.tags.join(" "), jp.resume, jp.citations, PORTEES[jp.portee]].join(" ")).includes(q))
  ).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

function basculer(ensemble, val) { ensemble.has(val) ? ensemble.delete(val) : ensemble.add(val); dessiner(); }

// ---------- 4. Affichage ----------
function dessiner() {
  const liste = jpsFiltrees();
  dessinerCote();
  dessinerPucesTel();
  dessinerListe(liste);   // la liste d'abord : sa hauteur fait apparaître la barre de défilement,
  dessinerFrise(liste);   // et la frise se mesure ensuite sur la bonne largeur
  $("titre-vue").textContent = filtre.sujet || "Toutes les JP";
  document.querySelectorAll("#seg-couleur button").forEach(b => b.setAttribute("aria-pressed", b.dataset.couleur === reglages.couleur));
}

function ligneCote(attrs, pt, nom, actif) {
  return `<button class="cote-ligne" type="button" ${attrs} aria-pressed="${actif}">${pt ? `<i class="pt" style="background:${pt}"></i>` : ""}<span class="nom">${echapper(nom)}</span>${ic("coche").replace('class="ic"', 'class="ic coche"')}</button>`;
}

function dessinerCote() {
  document.querySelector('#cote [data-sujet=""]').setAttribute("aria-pressed", !filtre.sujet);
  $("cote-sujets").innerHTML = tousLesSujets().map(t => ligneCote(`data-sujet="${echapper(t)}"`, "", t, filtre.sujet === t)).join("");
  $("cote-jur").innerHTML = Object.entries(JURIDICTIONS).map(([k, v]) => ligneCote(`data-jur="${k}"`, couleurJur(k), v, filtre.jur.has(k))).join("");
  $("cote-por").innerHTML = Object.entries(PORTEES).map(([k, v]) => ligneCote(`data-por="${k}"`, couleurPor(k), v, filtre.por.has(k))).join("");
  $("cote-imp").innerHTML = Object.entries(IMPORTANCES).reverse().map(([k, v]) => ligneCote(`data-imp="${k}"`, "", v, filtre.imp.has(k))).join("");
}

function dessinerPucesTel() {
  const nbFiltres = filtre.jur.size + filtre.por.size + filtre.imp.size;
  $("puces-tel").innerHTML =
    `<button type="button" data-ouvrir="filtres" aria-pressed="${nbFiltres > 0}">${ic("filtre")}Filtres${nbFiltres ? " · " + nbFiltres : ""}</button>` +
    `<button type="button" data-sujet="" aria-pressed="${!filtre.sujet}">Tous</button>` +
    tousLesSujets().map(t => `<button type="button" data-sujet="${echapper(t)}" aria-pressed="${filtre.sujet === t}">${echapper(t)}</button>`).join("");
  const puce = (attr, k, v, coul, actif) => `<button type="button" ${attr}="${k}" aria-pressed="${actif}">${coul ? `<i style="background:${coul}"></i>` : ""}${v}</button>`;
  $("tir-jur").innerHTML = Object.entries(JURIDICTIONS).map(([k, v]) => puce("data-jur", k, v, couleurJur(k), filtre.jur.has(k))).join("");
  $("tir-por").innerHTML = Object.entries(PORTEES).map(([k, v]) => puce("data-por", k, v, couleurPor(k), filtre.por.has(k))).join("");
  $("tir-imp").innerHTML = Object.entries(IMPORTANCES).reverse().map(([k, v]) => puce("data-imp", k, v, "", filtre.imp.has(k))).join("");
  ["tir-jur", "tir-por", "tir-imp"].forEach(id => $(id).classList.add("puces-choix"));
}

// Frise : une ligne par sujet, le temps de gauche à droite
function anneeDecimale(iso) {
  const [a, m, j] = iso.split("-").map(Number);
  return a + ((m - 1) * 30.5 + j) / 367;
}

function dessinerFrise(liste) {
  const zone = $("frise");
  const datees = liste.filter(jp => jp.date);
  const rangs = filtre.sujet ? [filtre.sujet] : tousLesSujets().filter(t => datees.some(jp => jp.tags.includes(t)));
  if (datees.some(jp => !jp.tags.length) && !filtre.sujet) rangs.push("");
  dessinerLegende();
  if (!datees.length) { zone.innerHTML = `<div class="frise-vide">Aucune décision datée à afficher.</div>`; $("frise-noms").innerHTML = ""; return; }

  let debut = Math.floor(Math.min(...datees.map(jp => anneeDecimale(jp.date))));
  let fin = Math.floor(Math.max(...datees.map(jp => anneeDecimale(jp.date)))) + 1;
  if (fin - debut < 4) { debut -= 1; fin = debut + 5; }
  const annees = fin - debut;
  const marge = 30;
  const large = zone.clientWidth || 600;
  // Téléphone : 64 px par an (on fait glisser) ; PC : tout tient dans la largeur si possible
  const L = Math.max(large, annees * (large < 600 ? 64 : 36) + marge * 2);
  const xDe = iso => marge + (anneeDecimale(iso) - debut) / annees * (L - marge * 2);
  const hRang = 50, haut = 6, H = haut + rangs.length * hRang + 26;
  const pas = annees > 40 ? 10 : annees > 20 ? 5 : annees > 10 ? 2 : 1;

  let s = `<svg width="${L}" height="${H}" viewBox="0 0 ${L} ${H}" role="img" aria-label="Frise des décisions">`;
  for (let a = debut; a <= fin; a++) {
    const x = marge + (a - debut) / annees * (L - marge * 2);
    s += `<line x1="${x}" y1="${haut}" x2="${x}" y2="${H - 22}" stroke="var(--grille)"/>`;
    if ((a - debut) % pas === 0) s += `<text x="${x}" y="${H - 7}" text-anchor="middle">${a}</text>`;
  }
  // Noms des lignes en HTML par-dessus la frise : ils restent visibles quand on la fait glisser
  let noms = "";
  rangs.forEach((t, i) => {
    const y = haut + i * hRang + 34;
    noms += `<span style="top:${y - 27}px">${echapper(t || "Sans sujet")}</span>`;
    s += `<line x1="${marge}" y1="${y}" x2="${L - marge}" y2="${y}" stroke="var(--trait)"/>`;
    // Les gros points d'abord : les petits restent visibles par-dessus
    datees.filter(jp => t ? jp.tags.includes(t) : !jp.tags.length)
      .sort((a, b) => b.imp - a.imp)
      .forEach(jp => {
        const choisi = couche && couche.id === jp.id ? " choisi" : "";
        s += `<circle class="pt${choisi}" data-id="${jp.id}" cx="${xDe(jp.date).toFixed(1)}" cy="${y}" r="${RAYON[jp.imp]}" fill="${couleurDe(jp)}"><title>${echapper(libelle(jp))}${jp.portee ? " · " + PORTEES[jp.portee] : ""}</title></circle>`;
      });
  });
  zone.innerHTML = s + "</svg>";
  $("frise-noms").innerHTML = noms;
  // Sur téléphone, la frise commence sur les décisions récentes
  if (!dessinerFrise.dejaPlace) { zone.scrollLeft = zone.scrollWidth; dessinerFrise.dejaPlace = true; }
}

function dessinerLegende() {
  const src = reglages.couleur === "por" ? PORTEES : JURIDICTIONS;
  const coul = reglages.couleur === "por" ? couleurPor : couleurJur;
  $("legende-cles").innerHTML = Object.entries(src).map(([k, v]) => `<span><i style="background:${coul(k)}"></i>${v}</span>`).join("");
}

function dessinerListe(liste) {
  if (!jps.size) {
    $("liste").innerHTML = `<div class="liste-vide">Ajoute ta première décision avec « Nouvelle JP » : colle sa référence, l'appli la découpe.</div>`;
    return;
  }
  if (!liste.length) { $("liste").innerHTML = `<div class="liste-vide">Aucune JP ne correspond.</div>`; return; }
  $("liste").innerHTML = liste.map(jp => `
    <button class="ligne-jp${couche && couche.id === jp.id ? " choisi" : ""}" type="button" data-id="${jp.id}">
      <i class="pt i${jp.imp}" style="background:${couleurDe(jp)}"></i>
      <span class="ref">${echapper(libelle(jp))}</span>
      ${jp.portee ? `<span class="portee" style="--pc:${couleurPor(jp.portee)}">${PORTEES[jp.portee]}</span>` : "<span></span>"}
      ${jp.resume ? `<span class="resume">${echapper(jp.resume.split("\n")[0])}</span>` : ""}
      ${jp.tags.length ? `<span class="tags">${jp.tags.map(t => `<span class="etiq">${echapper(t)}</span>`).join("")}</span>` : ""}
    </button>`).join("");
}

// ---------- Couches (panneau, tiroir, écrans) et bouton Retour d'Android ----------
// Chaque couche ouverte ajoute une étape à l'historique : le geste Retour la ferme.
let couche = null;           // couche du panneau : { nom: "fiche"|"form", id }
const pile = [];             // fonctions de fermeture, de la plus ancienne à la plus récente
let rechargerApres = false;  // nouvelle version arrivée pendant qu'une fiche était ouverte

function empiler(fermer) { pile.push(fermer); history.pushState({ jp: pile.length }, ""); }
function depiler() { history.back(); }
addEventListener("popstate", () => {
  const f = pile.pop();
  if (f) f();
  if (!pile.length && rechargerApres) location.reload();
});

function montrer(el, voile) { el.hidden = false; if (voile) $(voile).hidden = false; }
function cacher(el, voile) { el.hidden = true; if (voile) $(voile).hidden = true; }

// ---------- 5. Fiche et formulaire ----------
function ouvrirPanneau(contenu) {
  const p = $("panneau");
  const dejaOuvert = !p.hidden;
  p.innerHTML = contenu;
  if (!dejaOuvert) {
    montrer(p, "voile-panneau");
    empiler(() => { cacher(p, "voile-panneau"); couche = null; fermerMenu(); dessiner(); });
  }
}

function ouvrirFiche(id) {
  if (!jps.has(id)) return;
  couche = { nom: "fiche", id };
  ouvrirPanneau(htmlFiche(jps.get(id)));
  dessiner();
}
function rafraichirFiche() {
  if (!jps.has(couche.id)) { depiler(); return; }
  $("panneau").innerHTML = htmlFiche(jps.get(couche.id));
}

function htmlFiche(jp) {
  const ligne = (titre, val) => val ? `<dt>${titre}</dt><dd>${val}</dd>` : "";
  return `
    <div class="panneau-tete">
      <h2>Décision</h2>
      <button class="btn-icone" type="button" data-action="menu" aria-label="Plus d'actions">${ic("plus-actions")}</button>
      <button class="btn-icone" type="button" data-action="fermer" aria-label="Fermer">${ic("fermer")}</button>
    </div>
    <div class="panneau-corps">
      <p class="fiche-ref">${echapper(libelle(jp))}</p>
      <dl class="fiche-meta">
        ${ligne("Juridiction", jp.jur ? `<span class="etiq" style="color:${couleurJur(jp.jur)}">${JURIDICTIONS[jp.jur]}</span>` : "")}
        ${ligne("Portée", jp.portee ? `<span class="portee" style="--pc:${couleurPor(jp.portee)}">${PORTEES[jp.portee]}</span>` : "")}
        ${ligne("Importance", IMPORTANCES[jp.imp])}
        ${ligne("Sujets", jp.tags.map(t => `<span class="etiq">${echapper(t)}</span>`).join(""))}
      </dl>
      ${jp.resume ? `<div class="fiche-bloc"><h3>Portée en bref</h3><p>${echapper(jp.resume)}</p></div>` : ""}
      ${jp.citations ? `<div class="fiche-bloc"><h3>Citations</h3><p class="citation">${echapper(jp.citations)}</p></div>` : ""}
      ${jp.lien || jp.pdf ? `<div class="fiche-liens">
        ${jp.lien ? `<a class="btn btn-grand" href="${echapper(jp.lien)}" target="_blank" rel="noopener">${ic("lien")}Ouvrir en ligne</a>` : ""}
        ${jp.pdf ? `<a class="btn btn-grand" href="${echapper(jp.pdf)}" target="_blank" rel="noopener">${ic("pdf")}PDF</a>` : ""}
      </div>` : ""}
    </div>`;
}

let menuOuvert = null;
function fermerMenu() { if (menuOuvert) { menuOuvert.remove(); menuOuvert = null; } }
function ouvrirMenu(bouton) {
  fermerMenu();
  const m = document.createElement("div");
  m.className = "menu";
  m.innerHTML = `<button type="button" data-action="modifier">Modifier</button><button type="button" class="danger" data-action="supprimer">Supprimer</button>`;
  $("panneau").appendChild(m);
  const r = bouton.getBoundingClientRect(), p = $("panneau").getBoundingClientRect();
  m.style.top = (r.bottom - p.top + 4) + "px";
  m.style.right = (p.right - r.right) + "px";
  menuOuvert = m;
}

// Formulaire : brouillon en mémoire, recopié dans la JP à l'enregistrement
let brouillon = null;

function ouvrirFormulaire(id) {
  const existante = id && jps.get(id);
  brouillon = existante ? structuredClone(existante) : normaliser({ tags: filtre.sujet ? [filtre.sujet] : [] });
  couche = { nom: "form", id: existante ? id : null };
  ouvrirPanneau(htmlFormulaire(!!existante));
  dessinerTags();
  dessinerPucesForm();
  if (!existante) setTimeout(() => $("f-ref").focus(), 50);
}

function htmlFormulaire(modif) {
  const b = brouillon;
  return `
    <div class="panneau-tete">
      <h2>${modif ? "Modifier" : "Nouvelle JP"}</h2>
      <button class="btn-icone" type="button" data-action="fermer" aria-label="Fermer">${ic("fermer")}</button>
    </div>
    <form class="panneau-corps" id="formulaire" novalidate>
      <label class="champ champ-ref"><span>Référence</span>
        <textarea id="f-ref" rows="2" placeholder="Cass. civ. 1re, 30 mars 2022, n° 19-17.996">${echapper(b.ref || (modif ? libelle(b) : ""))}</textarea>
      </label>
      <div class="decoupe">
        <label class="champ"><span>Juridiction</span>
          <select id="f-jur"><option value="">—</option>${Object.entries(JURIDICTIONS).map(([k, v]) => `<option value="${k}"${b.jur === k ? " selected" : ""}>${v}</option>`).join("")}</select>
        </label>
        <label class="champ"><span>Formation</span><input id="f-formation" value="${echapper(b.formation)}" placeholder="Cass. civ. 1re"></label>
        <label class="champ"><span>Date</span><input id="f-date" type="date" value="${b.date}"></label>
        <label class="champ"><span>Numéro</span><input id="f-numero" value="${echapper(b.numero)}" placeholder="19-17.996"></label>
      </div>
      <div class="champ"><span>Sujets</span>
        <div class="tags-saisie" id="f-tags"><input id="f-tag" placeholder="CHF, clauses abusives…" aria-label="Ajouter un sujet"></div>
        <div class="suggestions" id="f-sugg"></div>
      </div>
      <div class="champ"><span>Importance</span><div class="puces-choix" id="f-imp"></div></div>
      <div class="champ"><span>Portée</span><div class="puces-choix" id="f-por"></div></div>
      <label class="champ"><span>Portée en bref</span><textarea id="f-resume" rows="3">${echapper(b.resume)}</textarea></label>
      <label class="champ"><span>Citations</span><textarea id="f-citations" rows="3">${echapper(b.citations)}</textarea></label>
      <div class="rang-champs">
        <label class="champ"><span>Lien en ligne</span><input id="f-lien" type="url" value="${echapper(b.lien)}" placeholder="https://"></label>
        <label class="champ"><span>Lien PDF</span><input id="f-pdf" type="url" value="${echapper(b.pdf)}" placeholder="https://"></label>
      </div>
      <p class="erreur" id="f-erreur" hidden></p>
    </form>
    <div class="panneau-pied">
      <button class="btn" type="button" data-action="fermer">Annuler</button>
      <button class="btn btn-accent" type="button" data-action="enregistrer">Enregistrer</button>
    </div>`;
}

function dessinerTags() {
  const zone = $("f-tags"), saisie = $("f-tag");
  zone.querySelectorAll(".tag-x").forEach(e => e.remove());
  brouillon.tags.forEach(t => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "tag-x"; b.dataset.retirer = t;
    b.innerHTML = `${echapper(t)}${ic("fermer")}`;
    b.setAttribute("aria-label", "Retirer " + t);
    zone.insertBefore(b, saisie);
  });
  const q = simple(saisie.value);
  $("f-sugg").innerHTML = tousLesSujets()
    .filter(t => !brouillon.tags.includes(t) && (!q || simple(t).includes(q)))
    .slice(0, 12).map(t => `<button type="button" data-ajouter="${echapper(t)}">${echapper(t)}</button>`).join("");
}

function ajouterTag(t) {
  t = t.replace(/[,;]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return;
  // Même sujet écrit autrement (majuscules, accents) : on garde l'existant
  const existant = tousLesSujets().find(x => simple(x) === simple(t));
  t = existant || t;
  if (!brouillon.tags.includes(t)) brouillon.tags.push(t);
  $("f-tag").value = "";
  dessinerTags();
}

function dessinerPucesForm() {
  $("f-imp").innerHTML = Object.entries(IMPORTANCES).reverse().map(([k, v]) => `<button type="button" data-imp-f="${k}" aria-pressed="${brouillon.imp === Number(k)}">${v}</button>`).join("");
  $("f-por").innerHTML = Object.entries(PORTEES).map(([k, v]) => `<button type="button" data-por-f="${k}" aria-pressed="${brouillon.portee === k}"><i style="background:${couleurPor(k)}"></i>${v}</button>`).join("");
}

function lireFormulaire() {
  Object.assign(brouillon, {
    ref: $("f-ref").value.trim(), jur: $("f-jur").value, formation: $("f-formation").value.trim(),
    date: $("f-date").value, numero: $("f-numero").value.trim(),
    resume: $("f-resume").value.trim(), citations: $("f-citations").value.trim(),
    lien: $("f-lien").value.trim(), pdf: $("f-pdf").value.trim()
  });
  if ($("f-tag").value.trim()) ajouterTag($("f-tag").value);
}

function validerFormulaire() {
  lireFormulaire();
  const err = $("f-erreur");
  if (!brouillon.formation && !brouillon.numero) { err.textContent = "Indique au moins la formation ou le numéro."; err.hidden = false; return; }
  if (!brouillon.date) { err.textContent = "Indique la date de la décision (elle place la JP sur la frise)."; err.hidden = false; return; }
  const jp = enregistrerJp(brouillon);
  ouvrirFiche(jp.id);
}

// ---------- Message « Annuler » ----------
let minuteurToast = null;
function toast(texte, bouton, action) {
  $("toast-texte").textContent = texte;
  $("toast-btn").hidden = !bouton;
  $("toast-btn").textContent = bouton || "";
  $("toast-btn").onclick = () => { $("toast").hidden = true; action && action(); };
  $("toast").hidden = false;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => { $("toast").hidden = true; }, 5000);
}

// ---------- 6. Réglages, thème, notes ----------
function ouvrirEcran(id) {
  const e = $(id);
  montrer(e);
  empiler(() => cacher(e));
  majReglages();
}
function majReglages() {
  $("val-theme").textContent = { auto: "Auto", clair: "Clair", sombre: "Sombre" }[reglages.theme];
  document.querySelectorAll("[data-theme-choix]").forEach(b => b.setAttribute("aria-pressed", b.dataset.themeChoix === reglages.theme));
  document.querySelectorAll("[data-anim]").forEach(b => b.setAttribute("aria-pressed", b.dataset.anim === reglages.animations));
}

// ---------- 7. Excel ----------
const COLONNES = [
  { header: "Date", key: "date", width: 12 },
  { header: "Juridiction", key: "jur", width: 18 },
  { header: "Formation", key: "formation", width: 20 },
  { header: "Numéro", key: "numero", width: 14 },
  { header: "Sujets", key: "tags", width: 26 },
  { header: "Importance", key: "imp", width: 12 },
  { header: "Portée", key: "portee", width: 18 },
  { header: "Portée en bref", key: "resume", width: 60 },
  { header: "Citations", key: "citations", width: 60 },
  { header: "Lien en ligne", key: "lien", width: 30 },
  { header: "Lien PDF", key: "pdf", width: 30 },
  { header: "Id", key: "id", width: 12 }
];

async function exporter() {
  try {
    const ExcelJS = await chargerExcelJS();
    const classeur = new ExcelJS.Workbook();
    const lignes = [...jps.values()].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(jp => ({
      // Vraie date Excel : filtrable par année / mois dans Excel
      date: jp.date ? new Date(Date.UTC(...jp.date.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)))) : null,
      jur: JURIDICTIONS[jp.jur] || "", formation: jp.formation, numero: jp.numero,
      tags: jp.tags.join(" ; "), imp: IMPORTANCES[jp.imp], portee: PORTEES[jp.portee] || "",
      resume: jp.resume, citations: jp.citations,
      lien: jp.lien ? { text: jp.lien, hyperlink: jp.lien } : "",
      pdf: jp.pdf ? { text: jp.pdf, hyperlink: jp.pdf } : "",
      id: jp.id
    }));
    const ws = ajouterFeuille(classeur, "JP", COLONNES, lignes);
    ws.getColumn("date").numFmt = "dd/mm/yyyy";
    ["resume", "citations"].forEach(k => ws.getColumn(k).eachCell((c, n) => { if (n > 1) c.alignment = { vertical: "top", wrapText: true }; }));
    await telechargerClasseur(classeur, NOM_APPLI);
  } catch (e) { console.error(e); toast("Export impossible : " + e.message); }
}

// Lecture « brute » : garde les vraies dates et les liens (la lecture commune ne garde que le texte)
function valeurCellule(v) {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  if (typeof v === "object") return v.hyperlink || v.text || (v.richText ? v.richText.map(r => r.text).join("") : "") || (v.result != null ? String(v.result) : "");
  return String(v).trim();
}
const dateDepuisTexte = t => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
};
const cleDe = (objet, libelleCherche) => Object.keys(objet).find(k => simple(objet[k]) === simple(libelleCherche)) || "";

async function importer(fichier) {
  try {
    const classeur = await lireClasseur(fichier);
    const ws = classeur.getWorksheet("JP") || classeur.worksheets[0];
    const entetes = [];
    ws.getRow(1).eachCell((c, i) => { entetes[i] = String(c.text).trim(); });
    const col = h => entetes.findIndex(x => x && simple(x) === simple(h));
    const nouvelles = [];
    ws.eachRow((rang, n) => {
      if (n === 1) return;
      const lire = h => { const i = col(h); return i > 0 ? valeurCellule(rang.getCell(i).value) : ""; };
      if (!lire("Formation") && !lire("Numéro")) return;
      nouvelles.push(normaliser({
        id: lire("Id") || nouvelId(), date: dateDepuisTexte(lire("Date")),
        jur: cleDe(JURIDICTIONS, lire("Juridiction")), formation: lire("Formation"), numero: lire("Numéro"),
        tags: lire("Sujets").split(/[;,]/).map(t => t.trim()).filter(Boolean),
        imp: cleDe(IMPORTANCES, lire("Importance")) || 2, portee: cleDe(PORTEES, lire("Portée")),
        resume: lire("Portée en bref"), citations: lire("Citations"), lien: lire("Lien en ligne"), pdf: lire("Lien PDF")
      }));
    });
    // Fusion : les JP du fichier remplacent celles de même Id, les autres restent
    nouvelles.forEach(jp => jps.set(jp.id, jp));
    if (MODE_DEMO) sauverDemo();
    else for (let i = 0; i < nouvelles.length; i += 400) {
      const lot = writeBatch(db);
      nouvelles.slice(i, i + 400).forEach(jp => lot.set(doc(colJps, jp.id), jp));
      await lot.commit().catch(erreurEcriture);
    }
    dessiner();
    toast(`${nouvelles.length} JP importée${nouvelles.length > 1 ? "s" : ""}`);
  } catch (e) { console.error(e); toast("Import impossible : " + e.message); }
}

// ---------- Clics ----------
document.addEventListener("click", e => {
  const c = e.target.closest("button, circle.pt, a");
  if (!c) { if (menuOuvert && !e.target.closest(".menu")) fermerMenu(); return; }
  const d = c.dataset;
  if (menuOuvert && !c.closest(".menu") && d.action !== "menu") fermerMenu();

  if (d.sujet !== undefined) { filtre.sujet = d.sujet; dessiner(); return; }
  if (d.jur) return basculer(filtre.jur, d.jur);
  if (d.por) return basculer(filtre.por, d.por);
  if (d.imp) return basculer(filtre.imp, d.imp);
  if (d.couleur) { changerReglage("couleur", d.couleur); dessiner(); return; }
  if (d.id) { ouvrirFiche(d.id); return; }

  if (d.ouvrir === "nouvelle") return ouvrirFormulaire(null);
  if (d.ouvrir === "reglages") return ouvrirEcran("ecran-reglages");
  if (d.ouvrir === "theme") return ouvrirEcran("ecran-theme");
  if (d.ouvrir === "notes") { NotesIdees.ouvrir(idees, enregistrerIdees); return; }
  if (d.ouvrir === "filtres") { montrer($("tiroir-filtres"), "voile-filtres"); empiler(() => cacher($("tiroir-filtres"), "voile-filtres")); return; }
  if (c.hasAttribute("data-fermer")) return depiler();
  if (c.id === "btn-filtres-zero") { filtre.jur.clear(); filtre.por.clear(); filtre.imp.clear(); dessiner(); return; }

  if (d.themeChoix) { changerReglage("theme", d.themeChoix); window.appliquerTheme(d.themeChoix); majReglages(); return; }
  if (d.anim) { changerReglage("animations", d.anim); document.documentElement.classList.toggle("anim-simples", d.anim === "simples"); majReglages(); return; }

  // Panneau
  if (d.action === "fermer") return depiler();
  if (d.action === "menu") { menuOuvert ? fermerMenu() : ouvrirMenu(c); return; }
  if (d.action === "modifier") { fermerMenu(); ouvrirFormulaire(couche.id); return; }
  if (d.action === "supprimer") {
    const jp = jps.get(couche.id);
    fermerMenu(); depiler(); supprimerJp(jp.id);
    toast("JP supprimée", "Annuler", () => enregistrerJp(jp));
    return;
  }
  if (d.action === "enregistrer") return validerFormulaire();
  if (d.retirer) { brouillon.tags = brouillon.tags.filter(t => t !== d.retirer); dessinerTags(); return; }
  if (d.ajouter) { ajouterTag(d.ajouter); $("f-tag").focus(); return; }
  if (d.impF) { brouillon.imp = Number(d.impF); dessinerPucesForm(); return; }
  if (d.porF) { brouillon.portee = brouillon.portee === d.porF ? "" : d.porF; dessinerPucesForm(); return; }
});

$("voile-panneau").addEventListener("click", depiler);
$("voile-filtres").addEventListener("click", depiler);
$("recherche").addEventListener("input", e => { filtre.q = e.target.value; dessiner(); });
$("btn-connexion").addEventListener("click", seConnecter);
$("btn-deconnexion").addEventListener("click", () => { if (auth) signOut(auth); depiler(); });
$("btn-export").addEventListener("click", exporter);
$("btn-import").addEventListener("click", () => $("fichier-import").click());
$("fichier-import").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importer(f); });

// Saisie dans le formulaire : découpe de la référence, sujets
document.addEventListener("input", e => {
  if (e.target.id === "f-ref") {
    const r = decouper(e.target.value);
    if (r.jur) $("f-jur").value = r.jur;
    if (r.formation) $("f-formation").value = r.formation;
    if (r.date) $("f-date").value = r.date;
    if (r.numero) $("f-numero").value = r.numero;
  }
  if (e.target.id === "f-tag") {
    if (/[,;]/.test(e.target.value)) ajouterTag(e.target.value);
    else dessinerTags();
  }
});
document.addEventListener("keydown", e => {
  if (e.target.id === "f-tag") {
    if (e.key === "Enter") { e.preventDefault(); ajouterTag(e.target.value); }
    if (e.key === "Backspace" && !e.target.value && brouillon.tags.length) { brouillon.tags.pop(); dessinerTags(); }
    return;
  }
  if (e.key === "Escape" && pile.length) { e.preventDefault(); depiler(); }
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && couche && couche.nom === "form") validerFormulaire();
  // Raccourci PC : N = nouvelle JP
  if (e.key === "n" && !pile.length && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); ouvrirFormulaire(null); }
});

// Redessine la frise quand sa largeur change (fenêtre, ou barre de défilement qui apparaît)
let minuteurTaille = null, largeurFrise = 0;
new ResizeObserver(([e]) => {
  const l = Math.round(e.contentRect.width);
  if (l === largeurFrise) return;
  largeurFrise = l;
  clearTimeout(minuteurTaille);
  minuteurTaille = setTimeout(() => dessinerFrise(jpsFiltrees()), 60);
}).observe($("frise"));

// ---------- 8. Démarrage ----------
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  let dejaRecharge = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!avaitUneVersion || dejaRecharge) return;
    dejaRecharge = true;
    // Pas de rechargement pendant une saisie : on attend que tout soit fermé
    if (pile.length) rechargerApres = true; else location.reload();
  });
}

$("version").textContent = VERSION;
if (MODE_DEMO) demarrerDemo(); else demarrerFirebase();
