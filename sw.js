// Service worker : garde une copie des fichiers pour ouvrir l'appli sans réseau.
// À CHAQUE NOUVELLE VERSION : changer le numéro ci-dessous.
const CACHE = "jp-v0.1.0";

const FICHIERS = [
  "./", "index.html", "style.css", "app.js", "reference.js", "champs-mobile.js", "notes-idees.js",
  "excel-style.js", "firebase-config.js", "manifest.json",
  "icones/icone.svg", "icones/icone-192.png"
];

// « reload » : GitHub laisse le tel garder un fichier 10 min sans revérifier ;
// sans ça on rangerait l'ancienne version sous l'étiquette de la nouvelle.
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FICHIERS.map(f => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(noms => Promise.all(noms.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Bibliothèques à version fixe (Firebase, ExcelJS) : la copie suffit
  if (url.hostname === "www.gstatic.com" || url.hostname === "cdnjs.cloudflare.com") {
    e.respondWith(caches.match(req).then(copie => copie || fetch(req).then(rep => {
      const clone = rep.clone();
      caches.open(CACHE).then(c => c.put(req, clone));
      return rep;
    })));
    return;
  }

  // Fichiers de l'appli : réseau d'abord (dernière version), copie si hors ligne.
  // req.url et pas req : le navigateur refuse de modifier une demande d'ouverture de page.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req.url, { cache: "no-cache" }).then(rep => {
        const clone = rep.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
        return rep;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  }
});
