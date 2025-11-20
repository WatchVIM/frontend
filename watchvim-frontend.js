// ======================
// WatchVIM Frontend Loader
// Connects to CMS Manifest → Catalog
// ======================

const WATCHVIM_CONFIG = {
  MANIFEST_URL:
    "https://hlumlzbtilvrhwxa.public.blob.vercel-storage.com/manifest-hKztYVNCh34OXYsBpUH6xelPgvnyL8.json"
};

const state = {
  catalog: [],
  published: [],
  activeTab: "Movies" // Movies | Series | Shorts | Foreign
};

const TAB_FILTERS = {
  Movies: (t) => t.type === "films" || t.type === "documentaries",
  Series: (t) => t.type === "series",
  Shorts: (t) => t.type === "shorts" || (t.runtimeMins && t.runtimeMins <= 40),
  Foreign: (t) =>
    (t.genre || []).some(g => /foreign|international|world/i.test(g)) ||
    (t.language && !/english/i.test(t.language))
};

function esc(str = "") {
  return str.replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

async function fetchCatalogFromManifest(){
  // cache busters avoid edge/browser stale reads
  const mRes = await fetch(WATCHVIM_CONFIG.MANIFEST_URL + "?t=" + Date.now(), { cache:"no-store" });
  const manifest = await mRes.json();

  const cRes = await fetch(manifest.latestCatalogUrl + "?t=" + Date.now(), { cache:"no-store" });
  return await cRes.json();
}

function getPoster(t){
  return t.posterImageDataUrl || t.poster214x321 || "";
}
function getHero(t){
  return t.heroImageDataUrl || t.heroImage1920x1080 || "";
}

function setHero(title){
  const heroImg = document.getElementById("heroImg");
  const heroTitle = document.getElementById("heroTitle");
  const heroSynopsis = document.getElementById("heroSynopsis");

  if(heroImg) heroImg.src = getHero(title) || getPoster(title);
  if(heroTitle) heroTitle.textContent = title.title || "Untitled";
  if(heroSynopsis) heroSynopsis.textContent = title.synopsis || "";
}

function renderTabs(){
  // wire up your nav buttons if present
  ["Movies","Series","Shorts","Foreign"].forEach(tab=>{
    const btn = document.querySelector(`[data-tab="${tab}"]`);
    if(btn){
      btn.onclick = () => { state.activeTab = tab; renderRows(); };
    }
  });
}

function rowSection(label, titles){
  if(!titles.length) return "";
  return `
    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">${esc(label)}</h2>
        <button class="text-xs text-white/60 hover:text-white">See all</button>
      </div>
      <div class="scroll-row flex gap-3 overflow-x-auto pb-2">
        ${titles.map(posterCard).join("")}
      </div>
    </section>
  `;
}

function posterCard(t){
  return `
    <div class="w-[140px] shrink-0 cursor-pointer group"
         onclick="openTitle('${t.id}')">
      <div class="relative w-full aspect-[2/3] rounded-xl overflow-hidden border border-white/10 bg-white/5">
        <img src="${esc(getPoster(t))}" class="w-full h-full object-cover group-hover:scale-[1.03] transition" />
      </div>
      <div class="mt-2 text-sm font-medium line-clamp-2">${esc(t.title || "Untitled")}</div>
      <div class="text-xs text-white/60">${esc(t.releaseYear || "")}</div>
    </div>
  `;
}

function renderRows(){
  const rowsEl = document.getElementById("rows");
  if(!rowsEl) return;

  const filtered = state.published.filter(TAB_FILTERS[state.activeTab] || (()=>true));

  // group by genre
  const byGenre = {};
  filtered.forEach(t=>{
    (t.genre || ["Uncategorized"]).forEach(g=>{
      byGenre[g] = byGenre[g] || [];
      byGenre[g].push(t);
    });
  });

  // build rows
  const newest = [...filtered].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,12);
  let html = rowSection("New on WatchVIM", newest);

  Object.keys(byGenre).sort().forEach(g=>{
    html += rowSection(g, byGenre[g].slice(0,18));
  });

  rowsEl.innerHTML = html || `<div class="text-white/60">No published titles yet.</div>`;
}

window.openTitle = (id) => {
  // simple detail open (for now)
  const t = state.published.find(x=>x.id===id);
  if(!t) return;

  alert(`${t.title}\n\n${t.synopsis || ""}`);
};

async function boot(){
  try{
    state.catalog = await fetchCatalogFromManifest();
    state.published = state.catalog.filter(x=>x.isPublished);

    if(!state.published.length){
      document.getElementById("rows").innerHTML =
        `<div class="text-white/60">Catalog loaded, but no Published titles.</div>`;
      return;
    }

    // hero = latest updated published title
    const heroTitle = [...state.published].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))[0];
    setHero(heroTitle);

    renderTabs();
    renderRows();
  } catch(e){
    console.error("Catalog load failed:", e);
    const rowsEl = document.getElementById("rows");
    if(rowsEl){
      rowsEl.innerHTML =
        `<div class="text-white/60">Catalog not loading. Check MANIFEST_URL.</div>`;
    }
  }
}

boot();
