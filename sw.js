/* Service worker do FVS Essence: deixa o app abrir sem internet.
   Não guarda nada do Apps Script (dados e login sempre vão ao servidor). */
const VERSAO_SW = 'fvs-v1.5.0';
const ESSENCIAIS = ['./', './index.html', './assets/logo-absoluta.png', './assets/capa-fundo.jpg'];
const EXTERNOS = ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO_SW).then(async c => {
    await Promise.all(ESSENCIAIS.map(u => c.add(u).catch(() => {})));
    await Promise.all(EXTERNOS.map(u => c.add(new Request(u, { mode: 'no-cors' })).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO_SW).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.indexOf('google.com') >= 0 || url.hostname.indexOf('googleusercontent.com') >= 0) return; // Apps Script: nunca interceptar
  const ehPagina = req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
  if (ehPagina && url.origin === location.origin) {
    // Página: tenta a rede (para pegar versão nova); se demorar ou falhar, usa a guardada
    e.respondWith(new Promise(resolve => {
      let respondeu = false;
      const guardada = () => caches.match('./index.html').then(r => r || caches.match('./'));
      const t = setTimeout(() => { guardada().then(r => { if (r && !respondeu) { respondeu = true; resolve(r); } }); }, 4000);
      fetch(req).then(r => {
        clearTimeout(t);
        if (r && r.ok) { const c = r.clone(); caches.open(VERSAO_SW).then(ch => ch.put('./index.html', c)); }
        if (!respondeu) { respondeu = true; resolve(r); }
      }).catch(() => { clearTimeout(t); guardada().then(r => { if (!respondeu) { respondeu = true; resolve(r || Response.error()); } }); });
    }));
    return;
  }
  // Demais arquivos (imagens, bibliotecas): usa o guardado e atualiza em segundo plano
  e.respondWith(caches.match(req).then(g => {
    const rede = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) { const c = r.clone(); caches.open(VERSAO_SW).then(ch => ch.put(req, c)); } return r; }).catch(() => g);
    return g || rede;
  }));
});
