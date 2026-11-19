/* instalacion.js — capa compartida de los constructores (páginas, fichas y editor).
 *
 * Carpeta de trabajo esperada (todo junto):
 *   constructor-paginas.html, constructor-fichas.html, constructor-editor.html, instalacion.js, logo.png
 *   images/                imágenes y mascotas (copia de las del sitio)
 *   borradores/paginas/    JSON del constructor de páginas
 *   borradores/fichas/     JSON del constructor de fichas
 *   borradores/editor/     JSON del editor de documentos
 *   publicar/              HTML listos para subir
 *
 * Con Chrome o Edge se da permiso a la carpeta una vez y el navegador lo recuerda
 * (puede pedir un clic de "Reconectar" al abrir). Sin permiso, las imágenes se ven igual
 * por ruta relativa (images/nombre.png) y los archivos se descargan a Descargas.
 *
 * Imágenes: primero se usa la carpeta images/ de la PC; si falta y hay una dirección del sitio
 * configurada, se muestra la del sitio (https://tusitio/images/nombre.png).
 */
(function () {
  'use strict';

  const DB_NAME = 'constructor-instalacion';
  const STORE = 'handles';
  const KEY = 'raiz';
  const SITE_KEY = 'constructor_site_url';
  const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
  const KIND_LABEL = { paginas: 'páginas', fichas: 'fichas', editor: 'editor de documentos' };

  const S = {
    root: null,          // FileSystemDirectoryHandle de la carpeta de trabajo
    pending: null,       // handle recordado que necesita permiso
    imagesDir: null,
    files: new Map(),    // nombre exacto -> { url, size, modified }
    lower: new Map(),    // nombre en minúsculas -> nombre exacto
    logoUrl: '',
    rootName: '',
    listeners: [],
    fallbackMode: false, // carpeta leída con <input webkitdirectory> (solo lectura)
    kind: ''             // 'paginas' | 'fichas' | 'editor'
  };

  const supported = typeof window.showDirectoryPicker === 'function';

  /* Carpeta donde vive este archivo (raíz del proyecto). Sirve para encontrar images/ y logo.png
     aunque el constructor esté en una subcarpeta (paginas/, fichas/, editor/). */
  const BASE = (function () {
    try { const sc = document.currentScript; if (sc && sc.src) return sc.src.replace(/[?#].*$/, '').replace(/[^\/]*$/, ''); } catch (e) { /* sin base */ }
    return '';
  })();
  S.remote = new Map();      // imágenes publicadas en el repositorio / sitio donde está alojado el constructor
  S.remoteLower = new Map();
  S.remoteState = '';        // '' | 'cargando' | 'ok' | 'error'

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function encPath(name) { return String(name || '').split('/').map(encodeURIComponent).join('/'); }
  function baseName(name) { return String(name || '').trim().replace(/^.*[\\/]/, ''); }
  function sanitizeName(name) {
    return baseName(name)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-');
  }
  function emit() { S.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); updateStatusBars(); }
  function onChange(fn) { S.listeners.push(fn); }
  function configure(opts) { if (opts && opts.kind) S.kind = opts.kind; }

  /* ---------- dirección del sitio (respaldo para imágenes) ---------- */
  function getSiteUrl() {
    try { return (localStorage.getItem(SITE_KEY) || '').trim().replace(/\/+$/, ''); } catch (e) { return ''; }
  }
  function setSiteUrl(v) {
    v = String(v || '').trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    try { localStorage.setItem(SITE_KEY, v); } catch (e) { /* sin almacenamiento */ }
    emit();
  }
  function askSiteUrl() {
    const v = prompt('Dirección de tu sitio (ej: https://misitio.com).\nLas imágenes que no estén en tu carpeta images se van a buscar en esa dirección + /images/.\nDejalo vacío para no usarla.', getSiteUrl() || 'https://');
    if (v === null) return;
    setSiteUrl(v.trim() === 'https://' ? '' : v);
  }
  // Si una imagen por ruta relativa no carga y hay sitio configurado, se prueba en el sitio.
  document.addEventListener('error', e => {
    const t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    const site = getSiteUrl();
    if (!site) return;
    const cur = t.getAttribute('src') || '';
    if (cur.indexOf(site + '/') === 0) return;
    const m = cur.match(/^(?:\.\.\/)*images\/([^?#]+)$/) || (BASE && cur.indexOf(BASE + 'images/') === 0 ? [null, cur.slice((BASE + 'images/').length).replace(/[?#].*$/, '')] : null);
    if (m) t.src = site + '/images/' + m[1];
  }, true);

  /* ---------- tipo de documento ---------- */
  function detectKind(text) {
    const t = String(text || '').trim();
    if (t.startsWith('{')) {
      try {
        const d = JSON.parse(t);
        if (d.schema === 'constructor-fichas') return 'fichas';
        if (d.schema === 'editor-doc-privado') return 'editor';
        if (typeof d.version === 'string' && d.version.indexOf('constructor3') === 0) return 'paginas';
      } catch (e) { /* no es JSON válido */ }
      return '';
    }
    if (/id=["']constructor3-state["']/.test(t)) return 'paginas';
    if (/id=["']constructor-fichas-state["']/.test(t)) return 'fichas';
    return '';
  }
  // Comprueba que el archivo sea de este constructor antes de reemplazar el trabajo actual.
  function acceptKind(text, name, expected) {
    expected = expected || S.kind;
    if (!expected) return true;
    const found = detectKind(text);
    const file = name || 'el archivo';
    if (!found) {
      const isHtml = /\.html?$/i.test(file) || /^\s*</.test(String(text));
      if (isHtml && expected === 'fichas') return true; // fichas sabe rescatar páginas viejas
      alert('"' + file + '" no parece un documento del ' + (KIND_LABEL[expected] || 'constructor') + (isHtml ? ' (la página no trae los datos del constructor adentro)' : '') + '. No lo abro para no pisar tu trabajo actual.');
      return false;
    }
    if (found !== expected) {
      alert('"' + file + '" es de ' + KIND_LABEL[found] + ', no de ' + KIND_LABEL[expected] + '. No lo abro para no pisar tu trabajo actual.');
      return false;
    }
    return true;
  }

  /* ---------- IndexedDB (recordar la carpeta) ---------- */
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet() {
    try {
      const db = await idb();
      return await new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get(KEY); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
    } catch (e) { return null; }
  }
  async function idbSet(handle) {
    try {
      const db = await idb();
      await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(handle, KEY); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (e) { console.warn('No se pudo recordar la carpeta', e); }
  }

  /* ---------- conexión con la carpeta ---------- */
  /* Lista las imágenes publicadas junto al constructor (GitHub Pages u otro hosting).
     1) images/lista.json (lo genera la automatización del repositorio)  2) API pública de GitHub */
  async function loadRepoImages() {
    if (!/^https?:$/.test(location.protocol) || !BASE) return;
    S.remoteState = 'cargando'; emit();
    let names = null;
    try {
      const r = await fetch(BASE + 'images/lista.json', { cache: 'no-cache' });
      if (r.ok) { const j = await r.json(); names = Array.isArray(j) ? j : (j.files || j.imagenes || null); }
    } catch (e) { /* sin lista */ }
    if (!names && /\.github\.io$/i.test(location.hostname)) {
      try {
        const owner = location.hostname.split('.')[0];
        const seg = new URL(BASE).pathname.split('/').filter(Boolean)[0];
        const repo = seg || owner + '.github.io';
        const r = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/contents/images');
        if (r.ok) names = (await r.json()).filter(x => x.type === 'file').map(x => x.name);
      } catch (e) { /* sin API */ }
    }
    S.remote.clear(); S.remoteLower.clear();
    if (names) {
      names.filter(n => IMG_RE.test(n)).forEach(n => {
        S.remote.set(n, { url: BASE + 'images/' + encPath(n) });
        S.remoteLower.set(n.toLowerCase(), n);
      });
      S.remoteState = 'ok';
    } else S.remoteState = 'error';
    emit();
  }

  async function init() {
    loadRepoImages();
    if (!supported) { emit(); return; }
    const handle = await idbGet();
    if (handle) {
      try {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') await attach(handle, { silent: true });
        else { S.pending = handle; emit(); }
      } catch (e) { S.pending = null; emit(); }
    } else emit();
  }

  async function getDirIfExists(parent, name) {
    try { return await parent.getDirectoryHandle(name); } catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
  }

  async function attach(handle, opts) {
    opts = opts || {};
    if (!opts.silent && String(handle.name).toLowerCase() === 'images') {
      alert('Elegiste la carpeta "images". Tenés que elegir la carpeta que la CONTIENE (la que tiene adentro los constructores, images, borradores y publicar).');
      return false;
    }
    let images = await getDirIfExists(handle, 'images');
    if (!images) {
      if (opts.silent) { S.pending = handle; emit(); return false; }
      const ok = confirm('La carpeta "' + handle.name + '" no tiene una subcarpeta "images".\n\n¿Crear las carpetas images, borradores y publicar acá?\n(Cancelar para elegir otra carpeta)');
      if (!ok) return false;
      images = await handle.getDirectoryHandle('images', { create: true });
      await handle.getDirectoryHandle('borradores', { create: true });
      await handle.getDirectoryHandle('publicar', { create: true });
    }
    S.root = handle; S.imagesDir = images; S.pending = null; S.rootName = handle.name; S.fallbackMode = false;
    await idbSet(handle);
    await refreshImages(true);
    return true;
  }

  async function connect() {
    if (!supported) { pickFallback(); return false; }
    try {
      if (S.pending) {
        const perm = await S.pending.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') { const ok = await attach(S.pending); if (ok) return true; }
        S.pending = null;
      }
      const handle = await window.showDirectoryPicker({ id: 'constructor-instalacion', mode: 'readwrite' });
      return await attach(handle);
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      console.error(e);
      alert('No se pudo conectar la carpeta: ' + (e && e.message ? e.message : e));
      return false;
    }
  }

  function pickFallback() {
    let input = document.getElementById('inst-fallback-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file'; input.id = 'inst-fallback-input'; input.multiple = true; input.style.display = 'none';
      input.setAttribute('webkitdirectory', '');
      input.addEventListener('change', () => {
        const all = Array.from(input.files || []);
        const imgs = all.filter(f => IMG_RE.test(f.name) && (!f.webkitRelativePath || f.webkitRelativePath.split('/').slice(-2, -1)[0] === 'images' || f.webkitRelativePath.split('/').length === 2));
        loadFileList(imgs, all[0] && all[0].webkitRelativePath ? all[0].webkitRelativePath.split('/')[0] : '');
        input.value = '';
      });
      document.body.appendChild(input);
    }
    input.click();
  }

  function clearImages() {
    S.files.forEach(v => URL.revokeObjectURL(v.url));
    S.files.clear(); S.lower.clear();
    if (S.logoUrl) { URL.revokeObjectURL(S.logoUrl); S.logoUrl = ''; }
  }
  function loadFileList(files, folderName) {
    clearImages();
    files.forEach(f => {
      S.files.set(f.name, { url: URL.createObjectURL(f), size: f.size, modified: f.lastModified });
      S.lower.set(f.name.toLowerCase(), f.name);
    });
    S.root = null; S.imagesDir = null; S.rootName = folderName || 'images'; S.fallbackMode = true;
    emit();
  }

  async function refreshImages() {
    if (!S.imagesDir) { emit(); return; }
    clearImages();
    for await (const [name, h] of S.imagesDir.entries()) {
      if (h.kind !== 'file' || !IMG_RE.test(name)) continue;
      const f = await h.getFile();
      S.files.set(name, { url: URL.createObjectURL(f), size: f.size, modified: f.lastModified });
      S.lower.set(name.toLowerCase(), name);
    }
    try {
      const lh = await S.root.getFileHandle('logo.png');
      S.logoUrl = URL.createObjectURL(await lh.getFile());
    } catch (e) { /* sin logo en la carpeta */ }
    emit();
  }

  /* ---------- imágenes ---------- */
  function exactName(name) {
    const n = baseName(name);
    if (S.files.has(n)) return n;
    return S.lower.get(n.toLowerCase()) || '';
  }
  function remoteName(name) {
    const n = baseName(name);
    if (S.remote.has(n)) return n;
    return S.remoteLower.get(n.toLowerCase()) || '';
  }
  function hasImage(name) { return !!exactName(name) || !!remoteName(name); }
  function imageSrc(name) {
    if (!name) return '';
    const real = exactName(name);
    if (real) return S.files.get(real).url;
    const rn = remoteName(name);
    if (rn) return S.remote.get(rn).url;
    const n = baseName(name);
    const site = getSiteUrl();
    // Si ya conocemos la carpeta local y la imagen no está, probamos directo en el sitio.
    if (site && (S.root || S.fallbackMode)) return site + '/images/' + encPath(n);
    return (BASE || '') + 'images/' + encPath(n);
  }
  function logoSrc() { return S.logoUrl || (BASE || '') + 'logo.png'; }
  function probeSite(name) {
    return new Promise(resolve => {
      const site = getSiteUrl();
      if (!site) return resolve(null);
      const im = new Image();
      const timer = setTimeout(() => resolve(null), 8000);
      im.onload = () => { clearTimeout(timer); resolve(true); };
      im.onerror = () => { clearTimeout(timer); resolve(false); };
      im.src = site + '/images/' + encPath(baseName(name)) + '?t=' + Date.now();
    });
  }

  async function addImage(file, desiredName) {
    if (!S.imagesDir) throw new Error('NO_CONECTADA');
    let name = sanitizeName(desiredName || file.name);
    if (!IMG_RE.test(name)) throw new Error('El archivo no parece una imagen.');
    if (S.files.has(name) || S.lower.has(name.toLowerCase())) {
      if (!confirm('Ya existe "' + name + '" en images.\n¿Reemplazarla con la nueva?')) {
        const m = name.match(/^(.*?)(\.[^.]+)$/);
        const stem = m ? m[1] : name, ext = m ? m[2] : '';
        let i = 2; while (S.files.has(stem + '-' + i + ext)) i++;
        name = stem + '-' + i + ext;
      }
    }
    const fh = await S.imagesDir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(file); await w.close();
    await refreshImages(true);
    return name;
  }

  /* ---------- borradores y publicar ---------- */
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  async function writeFile(dir, filename, text) {
    const fh = await dir.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(text); await w.close();
  }
  async function draftsBase() { return await S.root.getDirectoryHandle('borradores', { create: true }); }
  async function draftsDir() {
    const base = await draftsBase();
    return S.kind ? await base.getDirectoryHandle(S.kind, { create: true }) : base;
  }
  function draftsLabel() { return 'borradores/' + (S.kind ? S.kind + '/' : ''); }

  async function saveDraft(filename, text) {
    if (!S.root) {
      downloadText(filename, text, 'application/json;charset=utf-8');
      toast('⬇️ Descargado en tu carpeta de Descargas (conectá la carpeta para guardar en ' + draftsLabel() + ')');
      return { saved: false, where: 'Descargas' };
    }
    await writeFile(await draftsDir(), filename, text);
    toast('✅ Guardado en ' + draftsLabel() + filename);
    return { saved: true, where: draftsLabel() + filename };
  }
  async function savePublish(filename, html) {
    if (!S.root) {
      downloadText(filename, html, 'text/html;charset=utf-8');
      toast('⬇️ Descargado en tu carpeta de Descargas (conectá la carpeta para guardar en publicar/)');
      return { saved: false, where: 'Descargas' };
    }
    const dir = await S.root.getDirectoryHandle('publicar', { create: true });
    await writeFile(dir, filename, html);
    toast('✅ Guardado en publicar/' + filename);
    return { saved: true, where: 'publicar/' + filename };
  }
  async function listDrafts() {
    if (!S.root) return [];
    const out = [];
    const sub = await draftsDir();
    for await (const [name, h] of sub.entries()) {
      if (h.kind === 'file' && /\.json$/i.test(name)) {
        const f = await h.getFile();
        out.push({ name, modified: f.lastModified, size: f.size, dir: 'sub' });
      }
    }
    if (S.kind) { // archivos viejos sueltos en borradores/ que sean de este constructor
      const base = await draftsBase();
      for await (const [name, h] of base.entries()) {
        if (h.kind === 'file' && /\.json$/i.test(name)) {
          const f = await h.getFile();
          let t = ''; try { t = await f.text(); } catch (e) { /* ilegible */ }
          if (detectKind(t) === S.kind) out.push({ name, modified: f.lastModified, size: f.size, dir: 'root' });
        }
      }
    }
    return out.sort((a, b) => b.modified - a.modified);
  }
  async function dirFor(where) { return where === 'root' ? await draftsBase() : await draftsDir(); }
  async function readDraft(name, where) {
    const f = await (await (await dirFor(where)).getFileHandle(name)).getFile();
    return await f.text();
  }
  async function deleteDraft(name, where) { await (await dirFor(where)).removeEntry(name); }

  /* ---------- estilos y UI ---------- */
  function injectStyles() {
    if (document.getElementById('inst-styles')) return;
    const st = document.createElement('style');
    st.id = 'inst-styles';
    st.textContent = `
.inst-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-family:'Nunito',sans-serif;font-size:.85rem;padding:8px 10px;border-radius:10px;border:1px solid #cfd8dc;background:#f5f8fa;color:#37474f;margin:0 0 10px}
.inst-bar.ok{background:#e8f5e9;border-color:#a5d6a7;color:#1b5e20}
.inst-bar.warn{background:#fff8e1;border-color:#ffe082;color:#6d4c00}
.inst-bar .inst-txt{flex:1;min-width:140px}
.inst-btn{border:0;border-radius:8px;padding:7px 11px;font-weight:800;cursor:pointer;font-family:inherit;font-size:.82rem;background:#2196f3;color:#fff}
.inst-btn.sec{background:#eceff1;color:#263238;border:1px solid #cfd8dc}
.inst-btn.red{background:#d32f2f}
.inst-btn.green{background:#2e7d32}
.inst-overlay{position:fixed;inset:0;background:rgba(8,12,20,.72);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;font-family:'Nunito',sans-serif}
.inst-modal{width:min(900px,100%);max-height:90vh;display:flex;flex-direction:column;background:#fff;color:#263238;border-radius:14px;box-shadow:0 20px 65px rgba(0,0,0,.4);overflow:hidden}
.inst-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:#f5f7fb;border-bottom:1px solid #dde5ee}
.inst-head h3{margin:0;font-size:1.1rem}
.inst-body{padding:16px 18px;overflow:auto}
.inst-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.inst-row input[type=text]{flex:1;min-width:150px;padding:8px 10px;border:1px solid #cdd7e1;border-radius:8px;font:inherit;color:#263238;background:#fff}
.inst-help{font-size:.82rem;color:#607d8b;margin:6px 0}
.inst-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:10px}
.inst-item{border:1px solid #d8e1eb;border-radius:10px;padding:8px;background:#fbfcfe;cursor:pointer;text-align:center;transition:.15s}
.inst-item:hover{transform:translateY(-2px);border-color:#2196f3;box-shadow:0 4px 14px rgba(0,0,0,.1)}
.inst-item img{height:80px;width:100%;object-fit:contain;display:block;margin-bottom:6px}
.inst-item span{font-size:.72rem;color:#586878;word-break:break-all;display:block}
.inst-list-item{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:9px 10px;border:1px solid #dde5ee;border-radius:10px;margin-bottom:8px;background:#fbfcfe}
.inst-list-item small{display:block;color:#78909c}
.inst-tag{font-size:.72rem;font-weight:800;border-radius:6px;padding:2px 7px;white-space:nowrap}
.inst-tag.ok{background:#e8f5e9;color:#1b5e20}.inst-tag.bad{background:#ffebee;color:#b71c1c}.inst-tag.warn{background:#fff3e0;color:#e65100}
.inst-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#263238;color:#fff;padding:11px 18px;border-radius:10px;font-family:'Nunito',sans-serif;font-weight:700;z-index:100000;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:90vw}
`;
    document.head.appendChild(st);
  }

  let toastTimer = null;
  function toast(msg) {
    injectStyles();
    let t = document.getElementById('inst-toast');
    if (!t) { t = document.createElement('div'); t.id = 'inst-toast'; t.className = 'inst-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 4500);
  }

  function siteLabel() {
    const s = getSiteUrl();
    if (!s) return 'Sitio: sin definir';
    try { return 'Sitio: ' + new URL(s).host; } catch (e) { return 'Sitio: ' + s; }
  }
  function repoText() { return S.remote.size ? ' · ' + S.remote.size + ' en el repositorio' : ''; }
  function statusInfo() {
    if (S.root) return { cls: 'ok', text: '📁 Carpeta conectada: ' + S.rootName + ' · ' + S.files.size + ' imagen(es)' + repoText(), btn: 'Actualizar imágenes', act: 'refresh' };
    if (S.fallbackMode) return { cls: 'warn', text: '📁 Imágenes leídas de "' + S.rootName + '" (' + S.files.size + '). Solo lectura: los JSON y HTML se descargan.', btn: 'Elegir otra', act: 'connect' };
    if (S.pending) return { cls: 'warn', text: '📁 Carpeta recordada: "' + S.pending.name + '". Falta tu permiso para usarla.', btn: 'Reconectar (1 clic)', act: 'connect' };
    return { cls: '', text: supported ? '📁 Sin carpeta conectada (para agregar imágenes o guardar archivos, conectala)' + repoText() + '.' : '📁 Este navegador no permite conectar carpetas (usá Chrome o Edge). Las imágenes se buscan en images/ al lado del archivo.', btn: supported ? 'Conectar carpeta' : 'Leer imágenes', act: 'connect' };
  }
  function updateStatusBars() {
    document.querySelectorAll('[data-inst-status]').forEach(el => {
      const i = statusInfo();
      el.className = 'inst-bar ' + i.cls;
      el.innerHTML = '<span class="inst-txt">' + esc(i.text) + ' · ' + esc(siteLabel()) + '</span>' +
        '<button type="button" class="inst-btn" data-act="main">' + esc(i.btn) + '</button>' +
        '<button type="button" class="inst-btn sec" data-act="site" title="Dirección del sitio para ver las imágenes que no estén en tu carpeta">🌐 Sitio</button>';
      el.querySelector('[data-act="main"]').onclick = () => (i.act === 'refresh' ? refreshImages().then(() => toast('Imágenes actualizadas.')) : connect());
      el.querySelector('[data-act="site"]').onclick = askSiteUrl;
    });
  }
  function mountStatus(container) {
    injectStyles();
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return;
    el.setAttribute('data-inst-status', '1');
    updateStatusBars();
  }

  function openOverlay(title, bodyHTML) {
    injectStyles();
    closeOverlay();
    const ov = document.createElement('div');
    ov.className = 'inst-overlay'; ov.id = 'inst-overlay';
    ov.innerHTML = '<div class="inst-modal"><div class="inst-head"><h3>' + esc(title) + '</h3><button type="button" class="inst-btn sec" data-close>✕</button></div><div class="inst-body">' + bodyHTML + '</div></div>';
    ov.addEventListener('mousedown', e => { if (e.target === ov) closeOverlay(); });
    ov.querySelector('[data-close]').onclick = closeOverlay;
    document.body.appendChild(ov);
    return ov;
  }
  function closeOverlay() { const o = document.getElementById('inst-overlay'); if (o) o.remove(); }

  /* ---------- galería ---------- */
  function openGallery(opts) {
    opts = opts || {};
    const ov = openOverlay(opts.title || 'Galería de imágenes',
      '<div class="inst-bar" data-inst-status></div>' +
      '<div class="inst-row">' +
      '<input type="text" id="inst-g-search" placeholder="Buscar por nombre...">' +
      '<select id="inst-g-sort" class="inst-btn sec"><option value="name">Orden: nombre</option><option value="new">Orden: más nuevas</option></select>' +
      '<button type="button" class="inst-btn green" id="inst-g-add">➕ Agregar imagen a la carpeta</button>' +
      '</div>' +
      '<div class="inst-row"><input type="text" id="inst-g-manual" placeholder="o escribí el nombre del archivo (ej: mascota.png)"><button type="button" class="inst-btn sec" id="inst-g-use">Usar nombre</button></div>' +
      '<div class="inst-help" id="inst-g-count"></div><div class="inst-grid" id="inst-g-grid"></div>' +
      '<input type="file" id="inst-g-file" accept="image/*" style="display:none">');
    const grid = ov.querySelector('#inst-g-grid'), count = ov.querySelector('#inst-g-count');
    const search = ov.querySelector('#inst-g-search'), sort = ov.querySelector('#inst-g-sort');
    function pick(name) { closeOverlay(); if (opts.onPick) opts.onPick(name); }
    function draw() {
      if (!document.getElementById('inst-overlay')) return;
      const q = search.value.trim().toLowerCase();
      let items = Array.from(S.files.entries()).map(([name, v]) => ({ name, url: v.url, modified: v.modified, repo: false }));
      S.remote.forEach((v, name) => { if (!S.files.has(name) && !S.lower.has(name.toLowerCase())) items.push({ name, url: v.url, modified: 0, repo: true }); });
      if (q) items = items.filter(i => i.name.toLowerCase().includes(q));
      items.sort(sort.value === 'new' ? (a, b) => b.modified - a.modified : (a, b) => a.name.localeCompare(b.name));
      const total = S.files.size + items.filter(i => i.repo).length;
      count.textContent = total ? items.length + ' de ' + total + ' imagen(es).' + (S.remote.size ? ' Las marcadas 🌐 están en el repositorio y no en tu carpeta.' : '') : 'No hay imágenes cargadas. Conectá la carpeta de trabajo o escribí el nombre a mano.';
      grid.innerHTML = items.map(i => '<div class="inst-item" data-name="' + esc(i.name) + '"><img src="' + i.url + '" alt=""><span>' + (i.repo ? '🌐 ' : '') + esc(i.name) + '</span></div>').join('');
    }
    grid.addEventListener('click', e => { const it = e.target.closest('.inst-item'); if (it) pick(it.dataset.name); });
    search.addEventListener('input', draw); sort.addEventListener('change', draw);
    ov.querySelector('#inst-g-use').onclick = () => { const n = baseName(ov.querySelector('#inst-g-manual').value); if (n) pick(n); };
    ov.querySelector('#inst-g-add').onclick = () => {
      if (!S.imagesDir) { alert('Para copiar imágenes desde acá primero conectá la carpeta de trabajo. También podés pegar la imagen a mano en images/ y tocar "Actualizar imágenes".'); return; }
      ov.querySelector('#inst-g-file').click();
    };
    ov.querySelector('#inst-g-file').onchange = async ev => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return;
      try { const name = await addImage(f); toast('✅ Agregada a images/: ' + name); draw(); } catch (e) { alert('No se pudo agregar la imagen: ' + e.message); }
      ev.target.value = '';
    };
    const redraw = () => draw();
    S.listeners.push(redraw);
    new MutationObserver((m, obs) => { if (!document.getElementById('inst-overlay')) { S.listeners = S.listeners.filter(f => f !== redraw); obs.disconnect(); } }).observe(document.body, { childList: true });
    updateStatusBars(); draw();
  }
  function closeGallery() { closeOverlay(); }

  /* ---------- abrir: comprobación común ---------- */
  function deliver(text, name, opts) {
    opts = opts || {};
    if (!acceptKind(text, name)) return false;
    if (opts.confirmReplace !== false && !confirm('Se reemplazará el trabajo actual con:\n' + name + '\n\n¿Continuar?')) return false;
    closeOverlay();
    if (opts.onOpen) opts.onOpen(text, name);
    return true;
  }

  /* ---------- traer una página publicada por URL ---------- */
  async function importFromURL(opts) {
    opts = opts || {};
    const url = (prompt('Pegá la dirección de la página publicada (ej: https://misitio.com/matematica.html):') || '').trim();
    if (!url) return;
    let text;
    try {
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      text = await res.text();
    } catch (e) {
      const ov = openOverlay('No se pudo traer la página directamente',
        '<p>El navegador no deja leer una página del sitio desde un archivo local (el sitio tiene que permitirlo). Se hace en dos pasos:</p>' +
        '<ol><li>Abrí la página en otra pestaña, tocá <strong>Ctrl+S</strong> y guardala como <strong>"Página web, solo HTML"</strong>.</li>' +
        '<li>Elegí acá ese archivo guardado.</li></ol>' +
        '<div class="inst-row"><button type="button" class="inst-btn" id="inst-u-open">1) Abrir la página en una pestaña nueva</button>' +
        '<button type="button" class="inst-btn green" id="inst-u-file">2) Elegir el archivo guardado…</button></div>' +
        '<div class="inst-help">Para que "Traer de URL" funcione directo, el sitio tiene que enviar el permiso CORS (en Apache: una línea en .htaccess, <code>Header set Access-Control-Allow-Origin "*"</code>). Es opcional.</div>' +
        '<input type="file" id="inst-u-input" accept=".html,.htm,.json" style="display:none">');
      ov.querySelector('#inst-u-open').onclick = () => window.open(url, '_blank');
      ov.querySelector('#inst-u-file').onclick = () => ov.querySelector('#inst-u-input').click();
      ov.querySelector('#inst-u-input').onchange = ev => {
        const f = ev.target.files && ev.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { if (deliver(String(r.result), f.name, opts)) { try { if (!getSiteUrl()) setSiteUrl(new URL(url).origin); } catch (e2) { /* URL rara */ } } };
        r.readAsText(f);
      };
      try { if (!getSiteUrl()) setSiteUrl(new URL(url).origin); } catch (e3) { /* URL rara */ }
      return;
    }
    let name = url.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || 'pagina.html';
    if (!/\.[a-z0-9]+$/i.test(name)) name += '.html';
    if (deliver(text, name, opts) && !getSiteUrl()) {
      try { setSiteUrl(new URL(url).origin); toast('🌐 Las imágenes que falten en tu carpeta se buscarán en ' + new URL(url).origin + '/images/'); } catch (e) { /* URL rara */ }
    }
  }

  /* ---------- borradores ---------- */
  async function openDrafts(opts) {
    opts = opts || {};
    const title = 'Abrir borrador' + (S.kind ? ' — ' + KIND_LABEL[S.kind] : '');
    const ov = openOverlay(title,
      '<div class="inst-bar" data-inst-status></div>' +
      '<div class="inst-row"><button type="button" class="inst-btn sec" id="inst-d-file">📂 Abrir un archivo desde otra ubicación…</button><button type="button" class="inst-btn sec" id="inst-d-url">🌐 Traer una página del sitio (URL)</button><button type="button" class="inst-btn sec" id="inst-d-refresh">↻ Actualizar lista</button></div>' +
      '<div class="inst-help" id="inst-d-status"></div><div id="inst-d-list"></div>' +
      '<input type="file" id="inst-d-input" accept=".json,.html" style="display:none">');
    updateStatusBars();
    const list = ov.querySelector('#inst-d-list'), status = ov.querySelector('#inst-d-status');
    async function draw() {
      if (!document.getElementById('inst-overlay')) return;
      if (!S.root) { status.textContent = 'Conectá la carpeta de trabajo para ver los borradores guardados en ' + draftsLabel() + '.'; list.innerHTML = ''; return; }
      status.textContent = 'Buscando en ' + draftsLabel() + '...';
      try {
        const items = await listDrafts();
        status.textContent = items.length ? items.length + ' borrador(es) de ' + (KIND_LABEL[S.kind] || 'todos los tipos') + '.' : 'Todavía no hay borradores de ' + (KIND_LABEL[S.kind] || 'este tipo') + ' en ' + draftsLabel() + '.';
        list.innerHTML = items.map(i => '<div class="inst-list-item" data-name="' + esc(i.name) + '" data-dir="' + i.dir + '"><div><strong>' + esc(i.name) + '</strong><small>' + new Date(i.modified).toLocaleString() + ' · ' + Math.max(1, Math.round(i.size / 1024)) + ' KB' + (i.dir === 'root' ? ' · en borradores/ (suelto)' : '') + '</small></div><div><button type="button" class="inst-btn green" data-do="open">Abrir</button> <button type="button" class="inst-btn red" data-do="del">Borrar</button></div></div>').join('');
      } catch (e) { status.textContent = 'No se pudo leer ' + draftsLabel() + ': ' + e.message; }
    }
    list.addEventListener('click', async e => {
      const b = e.target.closest('button[data-do]'); if (!b) return;
      const row = b.closest('.inst-list-item');
      const name = row.dataset.name, where = row.dataset.dir;
      if (b.dataset.do === 'open') {
        try { const text = await readDraft(name, where); deliver(text, name, opts); } catch (err) { alert('No se pudo abrir: ' + err.message); }
      } else if (confirm('¿Borrar "' + name + '"?\nNo va a la papelera.')) {
        try { await deleteDraft(name, where); draw(); } catch (err) { alert('No se pudo borrar: ' + err.message); }
      }
    });
    ov.querySelector('#inst-d-refresh').onclick = draw;
    ov.querySelector('#inst-d-url').onclick = () => importFromURL(opts);
    ov.querySelector('#inst-d-file').onclick = () => ov.querySelector('#inst-d-input').click();
    ov.querySelector('#inst-d-input').onchange = ev => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => deliver(String(r.result), f.name, opts);
      r.readAsText(f); ev.target.value = '';
    };
    const redraw = () => draw();
    S.listeners.push(redraw);
    new MutationObserver((m, obs) => { if (!document.getElementById('inst-overlay')) { S.listeners = S.listeners.filter(f => f !== redraw); obs.disconnect(); } }).observe(document.body, { childList: true });
    draw();
  }

  /* ---------- informe de imágenes usadas ---------- */
  function usedImagesFromHTML(html) {
    const names = new Set();
    const d = document.createElement('div'); d.innerHTML = html || '';
    d.querySelectorAll('img[data-img]').forEach(i => { const n = baseName(i.getAttribute('data-img')); if (n) names.add(n); });
    return Array.from(names);
  }
  function openImageReport(names) {
    const list = Array.from(new Set((names || []).map(baseName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const known = S.files.size > 0 || S.remote.size > 0;
    const site = getSiteUrl();
    const rows = list.map(n => {
      const real = exactName(n), inRepo = !real && remoteName(n);
      let tag = '<span class="inst-tag ok">en tu carpeta</span>', note = '';
      if (!known) tag = '<span class="inst-tag warn">sin verificar</span>';
      else if (inRepo) tag = '<span class="inst-tag ok">en el repositorio</span>';
      else if (!real) tag = '<span class="inst-tag bad">no está en tu carpeta</span>';
      else if (real !== n) { tag = '<span class="inst-tag warn">mayúsculas distintas</span>'; note = 'El archivo se llama "' + esc(real) + '". En el sitio (Linux) las mayúsculas importan.'; }
      const odd = /[^A-Za-z0-9._-]/.test(n) ? '<small>Tiene espacios o acentos: mejor renombrarla sin ellos.</small>' : '';
      const mod = real && S.files.get(real) ? '<small>Modificada: ' + new Date(S.files.get(real).modified).toLocaleDateString() + '</small>' : '';
      return '<div class="inst-list-item" data-n="' + esc(n) + '" data-local="' + (real || inRepo ? '1' : '0') + '"><div><strong>' + esc(n) + '</strong>' + (note ? '<small>' + note + '</small>' : '') + odd + mod + '</div><span class="inst-tagbox">' + tag + '</span></div>';
    }).join('');
    const ov = openOverlay('Imágenes usadas en esta página',
      '<div class="inst-help" id="inst-r-sum"></div>' +
      '<div class="inst-help">Antes de publicar, subí a <strong>/images/</strong> del sitio las que todavía no estén, y después el HTML.' + (site ? '' : ' Con el botón "🌐 Sitio" podés indicar tu dirección y comprobar cuáles ya están publicadas.') + '</div>' + rows);
    const sum = ov.querySelector('#inst-r-sum');
    function summary(state) {
      if (!list.length) { sum.textContent = 'Esta página no usa imágenes.'; return; }
      if (!known) { sum.textContent = 'Conectá la carpeta para comprobar si las imágenes existen.'; return; }
      const parts = [];
      if (state.missingBoth) parts.push('⚠️ ' + state.missingBoth + ' no está(n) ni en tu carpeta ni en el sitio.');
      else if (state.missingLocal && state.checked) parts.push('ℹ️ ' + state.missingLocal + ' solo está(n) en el sitio (no en tu carpeta).');
      else if (state.missingLocal) parts.push('⚠️ Faltan ' + state.missingLocal + ' imagen(es) en tu carpeta images/.');
      else parts.push('✅ Todas las imágenes están en tu carpeta.');
      sum.textContent = parts.join(' ');
    }
    const items = Array.from(ov.querySelectorAll('.inst-list-item'));
    const state = { missingLocal: items.filter(i => i.dataset.local === '0').length, missingBoth: 0, checked: false };
    summary(state);
    if (known && site && state.missingLocal) {
      Promise.all(items.filter(i => i.dataset.local === '0').map(async it => {
        const ok = await probeSite(it.dataset.n);
        const box = it.querySelector('.inst-tagbox');
        if (ok === true) box.innerHTML = '<span class="inst-tag warn">solo en el sitio</span>';
        else if (ok === false) { box.innerHTML = '<span class="inst-tag bad">no está en ningún lado</span>'; state.missingBoth++; }
        else box.innerHTML = '<span class="inst-tag bad">no está en tu carpeta</span>';
      })).then(() => { state.checked = true; if (document.getElementById('inst-overlay') === ov) summary(state); });
    }
  }

  window.Instalacion = {
    supported, configure, init, connect, refreshImages, onChange, mountStatus,
    imageSrc, logoSrc, hasImage, exactName, addImage, sanitizeName, baseName,
    getSiteUrl, setSiteUrl, askSiteUrl, probeSite,
    detectKind, acceptKind, remoteName, loadRepoImages,
    saveDraft, savePublish, listDrafts, readDraft, deleteDraft, downloadText,
    openGallery, closeGallery, openDrafts, importFromURL, openImageReport, usedImagesFromHTML, toast,
    get connected() { return !!S.root; }
  };
})();
