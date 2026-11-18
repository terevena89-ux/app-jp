// Découpe d'une référence collée : « Cass. civ. 1re, 30 mars 2022, n° 19-17.996 »
// → { jur: "cass", formation: "Cass. civ. 1re", date: "2022-03-30", numero: "19-17.996" }

export const JURIDICTIONS = {
  cass: "Cour de cassation",
  fond: "CA et tribunaux",
  europe: "CJUE / CEDH",
  admin: "CE / Cons. const."
};

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juill.", "août", "sept.", "oct.", "nov.", "déc."];

// Sans accents ni majuscules, pour comparer plus facilement
const simple = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function moisDe(mot) {
  const m = simple(mot).replace(/\./g, "");
  if (m.startsWith("juin")) return 6;
  if (m.startsWith("juil")) return 7;
  const debuts = ["jan", "fev", "mar", "avr", "mai", "jun", "jul", "aou", "sep", "oct", "nov", "dec"];
  const i = debuts.findIndex(d => m.startsWith(d));
  return i >= 0 ? i + 1 : 0;
}

const deux = n => String(n).padStart(2, "0");

function trouverDate(t) {
  let m = t.match(/(\d{1,2})(?:er)?\s+([a-zéèûô]{3,9})\.?\s+(\d{4})/i);
  if (m && moisDe(m[2])) return `${m[3]}-${deux(moisDe(m[2]))}-${deux(m[1])}`;
  m = t.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\b/);
  if (m) return `${m[3]}-${deux(m[2])}-${deux(m[1])}`;
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return m[0];
  return "";
}

function trouverNumero(t) {
  const essais = [
    /\b\d{2}-\d{2}\.\d{3}\b/,                 // Cass. : 19-17.996
    /\bC-\d+\/\d{2}\b/i,                      // CJUE : C-260/18
    /\b\d{4}-\d+\s*(?:QPC|DC|L|LP|I)\b/,      // Cons. const. : 2023-1050 QPC
    /\b\d{2}\/\d{4,6}\b/,                     // CA (RG) : 18/12345
    /\b\d{4,6}\/\d{2}\b/                      // CEDH : 12345/12
  ];
  for (const r of essais) { const m = t.match(r); if (m) return m[0].replace(/\s+/g, " "); }
  const m = t.match(/n[°o]\s*([^\s,;]+)/i);
  return m ? m[1].replace(/[.)]+$/, "") : "";
}

function trouverCassation(s) {
  const chiffre = s.match(/(\d)\s*(?:re|ere|e|eme)?\s*civ|civ\.?\s*(\d)/);
  if (chiffre) { const n = chiffre[1] || chiffre[2]; return "Cass. civ. " + (n === "1" ? "1re" : n + "e"); }
  if (/ass\.?\s*plen/.test(s)) return "Cass. ass. plén.";
  if (/ch\.?\s*mixte/.test(s)) return "Cass. ch. mixte";
  if (/\bcom/.test(s)) return "Cass. com.";
  if (/\bsoc/.test(s)) return "Cass. soc.";
  if (/\bcrim/.test(s)) return "Cass. crim.";
  if (/\bavis/.test(s)) return "Cass. avis";
  return "Cass.";
}

export function decouper(texte) {
  const t = String(texte || "").replace(/\s+/g, " ").trim();
  const r = { jur: "", formation: "", date: trouverDate(t), numero: trouverNumero(t) };
  if (!t) return r;
  const s = simple(t);
  const premier = t.split(",")[0].replace(/\s+\d{1,2}(er)?\s+[a-zéèûô.]+\s+\d{4}.*$/i, "").trim();

  if (/^(cjue|cjce|trib\.?\s*ue|tpiue)\b/.test(s)) { r.jur = "europe"; r.formation = /^cjce/.test(s) ? "CJCE" : /^trib/.test(s) ? "Trib. UE" : "CJUE"; }
  else if (/^(cedh|cour edh|cour europeenne)/.test(s)) { r.jur = "europe"; r.formation = "CEDH"; }
  else if (/^(cons\.?\s*const|conseil constit|cc\b)/.test(s)) { r.jur = "admin"; r.formation = "Cons. const."; }
  else if (/^(ce\b|cons\.?\s*d'?\s*etat|conseil d'?\s*etat)/.test(s)) { r.jur = "admin"; r.formation = /^ce\s*,?\s*ass\b/.test(s) ? "CE, ass." : /^ce\s*,?\s*sect/.test(s) ? "CE, sect." : "CE"; }
  else if (/^(caa|ta)\b/.test(s)) { r.jur = "admin"; r.formation = premier; }
  else if (/^(cass|civ|com\b|com\.|soc|crim|ass\.?\s*plen|ch\.?\s*mixte|\d\s*(re|e|ere|eme)?\s*civ)/.test(s)) { r.jur = "cass"; r.formation = trouverCassation(s); }
  else if (/^cour d'?\s*appel/.test(s)) { r.jur = "fond"; r.formation = "CA " + premier.replace(/^cour d'?\s*appel\s*(de\s+|d'\s*)?/i, ""); }
  else if (/^(ca|tj|tgi|ti|t\.?\s*com|tc|trib|cph|jex|cons\.?\s*prud)/.test(s)) { r.jur = "fond"; r.formation = premier; }
  else r.formation = premier;
  return r;
}

// « 2022-03-30 » → « 30 mars 2022 » (« 1er » pour le premier du mois)
export function dateLongue(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || "";
  const j = Number(m[3]);
  return `${j === 1 ? "1er" : j} ${MOIS_COURTS[Number(m[2]) - 1]} ${m[1]}`;
}

// Référence affichée, recomposée depuis les champs
export function libelle(jp) {
  const morceaux = [jp.formation || JURIDICTIONS[jp.jur] || "Décision"];
  if (jp.date) morceaux.push(dateLongue(jp.date));
  if (jp.numero) morceaux.push(/^C-/i.test(jp.numero) ? "aff. " + jp.numero : "n° " + jp.numero);
  return morceaux.join(", ");
}
