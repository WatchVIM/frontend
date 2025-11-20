// ======================
// WatchVIM Frontend Loader
// Connects to CMS Manifest → Catalog
// Loads Supabase Auth config from /config.json
// Adds WatchVIM logo top-left on all pages
// ======================

// ✅ Put your logo in the repo root as vim-logo.png (or change this path)
const LOGO_SRC = "./vim-logo.png";

const WATCHVIM_CONFIG = {
  MANIFEST_URL:
    "https://hlumlzbtilvrhwxa.public.blob.vercel-storage.com/manifest-hKztYVNCh34OXYsBpUH6xelPgvnyL8.json"
};

const LS = {
  lastCatalog: "watchvim_last_catalog",
  progress: "watchvim_progress"
};

const state = {
  catalog: [],
  published: [],
  activeTab: "Movies",
  searchQuery: "",
  heroId: null,
  user: null
};

const TAB_FILTERS = {
  Movies: (t) => t.type === "films" || t.type === "documentaries",
  Series: (t) => t.type === "series",
  Shorts: (t) => t.type === "shorts" || (t.runtimeMins && t.runtimeMins <= 40),
  Foreign: (t) =>
    (t.genre || []).some(g => /foreign|international|world/i.test(g)) ||
    (t.language && !/english/i.test(t.language))
};

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);

function esc(str = "") {
  return String(str).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function safeParse(s, fallback){
  try { return JSON.parse(s); } catch { return fallback; }
}

function getPoster(t){
  return t.posterImageDataUrl || t.poster214x321 || t.posterUrl || "";
}
function getHero(t){
  return t.heroImageDataUrl || t.heroImage1920x1080 || t.heroUrl || getPoster(t);
}

function findTrailerPlaybackId(t){
  return (
    t.trailerPlaybackId ||
    t.trailerMuxPlaybackId ||
    t.trailerPlaybackID ||
    t.trailer_playback_id ||
    ""
  );
}
function findContentPlaybackId(t){
  return (
    t.contentPlaybackId ||
    t.muxPlaybackId ||
    t.playbackId ||
    t.content_playback_id ||
    ""
  );
}

// ---------- LOGO INJECTION (anchored header) ----------
function ensureLogoInHeader(){
  const header = document.querySelector("header");
  if(!header) return;

  // Finds your existing brand node
  const brandNode =
    header.querySelector(".text-watchGold") ||
    [...header.querySelectorAll("div,span,a")].find(el =>
      (el.textContent || "").trim().toLowerCase() === "watchvim"
    );

  if(!brandNode) return;
  if(brandNode.dataset.logoInjected === "1") return;

  brandNode.innerHTML = `
    <a href="#/home" class="flex items-center">
      <img src="${LOGO_SRC}" alt="WatchVIM Logo"
           class="h-9 w-auto object-contain"/>
    </a>
  `;
  brandNode.dataset.logoInjected = "1";
}

// ---------- PUBLIC CONFIG + SUPABASE ----------
async function loadPublicConfig() {
  const res = await fetch("/config.json?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("Missing /config.json in frontend root");
  return await res.json();
}

let supabaseClient = null;

async function initSupabase() {
  const cfg = await loadPublicConfig();

  const SUPABASE_URL = cfg.SUPABASE_URL;
  const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("config.json missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }

  // supabase-js loaded via CDN in index.html
  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
}

// ---------- Supabase Auth ----------
async function initAuth(){
  if(!supabaseClient) return;

  const { data } = await supabaseClient.auth.getSession();
  state.user = data?.session?.user ?? null;
  renderAuthUI();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user ?? null;
    renderAuthUI();
    renderRows();
  });
}

async function loginWithPassword(email, password){
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if(error) return alert(error.message);
  closeAuthModal();
}

async function signupWithPassword(email, password){
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if(error) return alert(error.message);
  alert("Check your email to confirm your account.");
  closeAuthModal();
}

async function logout(){
  await supabaseClient.auth.signOut();
}

function requireLogin(){
  if(state.user) return true;
  openAuthModal("login");
  return false;
}

// ---------- AUTH MODAL UI ----------
function openAuthModal(mode="login"){
  let root = document.getElementById("authModalRoot");
  if(!root){
    root = document.createElement("div");
    root.id = "authModalRoot";
    document.body.appendChild(root);
  }

  root.innerHTML = `
    <div class="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
         onclick="closeAuthModal()">
      <div class="w-full max-w-md bg-[#0d0d0d] border border-white/10 rounded-2xl p-5 space-y-4"
           onclick="event.stopPropagation()">

        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold">${mode==="login" ? "Log In" : "Sign Up"}</h3>
          <button class="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
                  onclick="closeAuthModal()">Close</button>
        </div>

        <div class="space-y-2">
          <label class="text-xs text-white/70">Email</label>
          <input id="authEmail"
            class="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none"/>
        </div>

        <div class="space-y-2">
          <label class="text-xs text-white/70">Password</label>
          <input id="authPass" type="password"
            class="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none"/>
        </div>

        <button class="w-full px-4 py-2 rounded-xl bg-watchRed font-semibold hover:bg-red-500"
                onclick="${mode==="login" ? "submitLogin()" : "submitSignup()"}">
          ${mode==="login" ? "Log In" : "Create Account"}
        </button>

        <div class="text-center text-sm text-white/70">
          ${mode==="login"
            ? `No account? <button class="underline" onclick="openAuthModal('signup')">Sign up</button>`
            : `Already have an account? <button class="underline" onclick="openAuthModal('login')">Log in</button>`
          }
        </div>
      </div>
    </div>
  `;
}

function closeAuthModal(){
  const root = document.getElementById("authModalRoot");
  if(root) root.innerHTML = "";
}

function submitLogin(){
  const email = document.getElementById("authEmail").value.trim();
  const pass = document.getElementById("authPass").value.trim();
  loginWithPassword(email, pass);
}

function submitSignup(){
  const email = document.getElementById("authEmail").value.trim();
  const pass = document.getElementById("authPass").value.trim();
  signupWithPassword(email, pass);
}

function renderAuthUI(){
  const header = document.querySelector("header");
  if(!header) return;

  const authZone = header.querySelector(".flex.items-center.gap-2:last-child");
  if(!authZone) return;

  if(!state.user){
    authZone.innerHTML = `
      <button class="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
              onclick="openAuthModal('login')">Log In</button>
      <button class="px-3 py-2 rounded-lg bg-watchRed hover:bg-red-500 text-sm font-semibold"
              onclick="openAuthModal('signup')">Sign Up</button>
    `;
    ensureLogoInHeader();
    return;
  }

  const initials =
    (state.user.email || "U").split("@")[0].slice(0,2).toUpperCase();

  authZone.innerHTML = `
    <div class="hidden md:flex items-center gap-2 ml-2 pl-2 border-l border-white/10">
      <div class="w-8 h-8 rounded-full bg-white/10 grid place-items-center text-xs">${initials}</div>
      <div class="text-sm text-white/80 truncate max-w-[140px]">${esc(state.user.email)}</div>
      <button class="px-2 py-1 rounded-md hover:bg-white/5 text-xs text-white/70"
              onclick="openProfile()">My Profile</button>
      <button class="px-2 py-1 rounded-md hover:bg-white/5 text-xs text-white/70"
              onclick="logout()">Log Out</button>
    </div>
  `;
  ensureLogoInHeader();
}

function openProfile(){
  alert("Profile page coming next — we’ll add #/profile with watch history + settings.");
}

// ---------- Data fetch (CMS → Manifest → Catalog) ----------
async function fetchCatalogFromManifest(){
  const mRes = await fetch(
    WATCHVIM_CONFIG.MANIFEST_URL + "?t=" + Date.now(),
    { cache:"no-store" }
  );
  const manifest = await mRes.json();

  if(!manifest.latestCatalogUrl){
    throw new Error("Manifest missing latestCatalogUrl");
  }

  const cRes = await fetch(
    manifest.latestCatalogUrl + "?t=" + Date.now(),
    { cache:"no-store" }
  );
  return await cRes.json();
}

// ---------- Hero ----------
function setHero(title){
  state.heroId = title.id;

  const heroImg = $("#heroImg");
  const heroTitle = $("#heroTitle");
  const heroSynopsis = $("#heroSynopsis");
  const heroMeta = $("#heroMeta");
  const detailsBtn = $("#heroDetailsBtn");
  const trailerBtn = $("#heroTrailerBtn");

  if(heroImg) heroImg.src = getHero(title);
  if(heroTitle) heroTitle.textContent = title.title || "Untitled";
  if(heroSynopsis) heroSynopsis.textContent = title.synopsis || "";

  const metaParts = [];
  if(title.type) metaParts.push(String(title.type).toUpperCase());
  const g = (title.genre || []).slice(0,2).join(" • ");
  if(g) metaParts.push(g);
  if(title.releaseYear) metaParts.push(title.releaseYear);
  if(heroMeta) heroMeta.textContent = metaParts.join(" • ");

  if(detailsBtn){
    detailsBtn.onclick = () => navigateToTitle(title.id);
  }

  const trailerPlaybackId = findTrailerPlaybackId(title);
  if(trailerBtn){
    trailerBtn.disabled = !trailerPlaybackId;
    trailerBtn.classList.toggle("opacity-50", !trailerPlaybackId);
    trailerBtn.onclick = () => trailerPlaybackId && openTrailerModal(title);
  }
}

// ---------- Tabs + search ----------
function wireTabs(){
  ["Movies","Series","Shorts","Foreign"].forEach(tab=>{
    document.querySelectorAll(`[data-tab="${tab}"]`).forEach(btn=>{
      btn.onclick = () => {
        state.activeTab = tab;
        renderRows();
      };
    });
  });
}

function wireSearch(){
  document.querySelectorAll(`input[placeholder^="Search"]`).forEach(inp=>{
    inp.addEventListener("input", (e)=>{
      state.searchQuery = e.target.value.trim().toLowerCase();
      renderRows();
    });
  });
}

// ---------- Rows ----------
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
         onclick="window.WatchVIM.navigateToTitle('${t.id}')">
      <div class="relative w-full aspect-[2/3] rounded-xl overflow-hidden border border-white/10 bg-white/5">
        <img src="${esc(getPoster(t))}"
             class="w-full h-full object-cover group-hover:scale-[1.03] transition" />
      </div>
      <div class="mt-2 text-sm font-medium line-clamp-2">${esc(t.title || "Untitled")}</div>
      <div class="text-xs text-white/60">${esc(t.releaseYear || "")}</div>
    </div>
  `;
}

function renderRows(){
  const rowsEl = $("#rows");
  if(!rowsEl) return;

  const tabFilter = TAB_FILTERS[state.activeTab] || (()=>true);
  let filtered = state.published.filter(tabFilter);

  if(state.searchQuery){
    filtered = filtered.filter(t=>{
      const hay = [
        t.title, t.synopsis, ...(t.genre||[]), t.type, t.language
      ].join(" ").toLowerCase();
      return hay.includes(state.searchQuery);
    });
  }

  const newest = [...filtered]
    .sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0))
    .slice(0,12);

  const byGenre = {};
  filtered.forEach(t=>{
    (t.genre || ["Uncategorized"]).forEach(g=>{
      byGenre[g] = byGenre[g] || [];
      byGenre[g].push(t);
    });
  });

  let html = rowSection("New on WatchVIM", newest);
  Object.keys(byGenre).sort().forEach(g=>{
    html += rowSection(g, byGenre[g].slice(0,18));
  });

  rowsEl.innerHTML = html || `<div class="text-white/60">No published titles yet.</div>`;
}

// ---------- Trailer Modal ----------
function openTrailerModal(title){
  let root = document.getElementById("trailerModalRoot");
  if(!root){
    root = document.createElement("div");
    root.id = "trailerModalRoot";
    document.body.appendChild(root);
  }

  const playbackId = findTrailerPlaybackId(title);
  if(!playbackId){
    alert("No trailer playback ID set for this title yet.");
    return;
  }

  root.innerHTML = `
    <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
         onclick="closeTrailerModal()">
      <div class="w-full max-w-4xl bg-black border border-white/10 rounded-2xl overflow-hidden"
           onclick="event.stopPropagation()">
        <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div class="font-semibold">${esc(title.title)} — Trailer</div>
          <button class="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
                  onclick="closeTrailerModal()">Close</button>
        </div>
        <div class="aspect-video bg-black">
          <mux-player
            stream-type="on-demand"
            playback-id="${esc(playbackId)}"
            autoplay
            controls
            style="width:100%;height:100%;"
          ></mux-player>
        </div>
      </div>
    </div>
  `;
}

function closeTrailerModal(){
  const root = document.getElementById("trailerModalRoot");
  if(root) root.innerHTML = "";
}

// ---------- Routing ----------
function navigateToHome(){
  location.hash = "#/home";
}

function navigateToTitle(id){
  location.hash = `#/title/${id}`;
}

function parseHash(){
  const h = location.hash.replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  return parts.length ? parts : ["home"];
}

function router(){
  ensureLogoInHeader();

  const main = document.querySelector("main");
  if(!main) return;

  const [route, param] = parseHash();

  if(route === "title" && param){
    renderTitlePage(param);
    return;
  }

  renderHomePage();
}

function renderHomePage(){
  ensureLogoInHeader();

  if(!state.published.length){
    $("#rows").innerHTML = `<div class="text-white/60">No published titles yet.</div>`;
    return;
  }

  const tabFilter = TAB_FILTERS[state.activeTab] || (()=>true);
  const heroTitle = [...state.published]
    .filter(tabFilter)
    .sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0))[0]
    || state.published[0];

  setHero(heroTitle);
  renderRows();
}

function renderTitlePage(id){
  ensureLogoInHeader();

  const main = document.querySelector("main");
  const t = state.published.find(x=>x.id===id) || state.catalog.find(x=>x.id===id);
  if(!t){
    main.innerHTML = `
      <div class="p-6 text-white/70">Title not found.</div>
      <div class="p-6">
        <button class="px-4 py-2 rounded-xl bg-white/10" onclick="window.WatchVIM.navigateToHome()">Back Home</button>
      </div>
    `;
    return;
  }

  const trailerPlaybackId = findTrailerPlaybackId(t);
  const contentPlaybackId = findContentPlaybackId(t);

  main.innerHTML = `
    <section class="border border-white/10 rounded-2xl p-5 bg-white/5 space-y-4">
      <div class="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div>
          <div class="aspect-[2/3] rounded-2xl overflow-hidden border border-white/10 bg-white/5">
            <img src="${esc(getPoster(t))}" class="w-full h-full object-cover"/>
          </div>
        </div>
        <div class="space-y-3">
          <div class="text-xs text-yellow-300/80 uppercase tracking-widest">${esc(t.type || "")}</div>
          <h1 class="text-3xl font-bold">${esc(t.title || "Untitled")}</h1>
          <div class="text-sm text-white/70">
            ${esc(t.releaseYear || "")}
            ${t.runtimeMins ? ` • ${esc(t.runtimeMins)} mins` : ""}
            ${t.monetization ? ` • ${esc(t.monetization)}` : ""}
          </div>
          <p class="text-white/80">${esc(t.synopsis || "")}</p>

          <div class="flex flex-wrap items-center gap-2 pt-2">
            <button class="px-4 py-2 rounded-xl bg-watchRed font-semibold hover:bg-red-500"
                    ${contentPlaybackId ? "" : "disabled"}
                    onclick="window.WatchVIM.playContent('${esc(contentPlaybackId)}')">
              Play
            </button>

            <button class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20"
                    ${trailerPlaybackId ? "" : "disabled"}
                    onclick="window.WatchVIM.openTrailerById('${t.id}')">
              Trailer
            </button>

            <button class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20"
                    onclick="window.WatchVIM.navigateToHome()">
              Back
            </button>
          </div>

          <div class="rounded-2xl overflow-hidden border border-white/10 bg-black mt-3 aspect-video">
            ${
              trailerPlaybackId
                ? `<mux-player stream-type="on-demand" playback-id="${esc(trailerPlaybackId)}" controls style="width:100%;height:100%;"></mux-player>`
                : `<div class="w-full h-full grid place-items-center text-white/60 text-sm">Trailer not available yet.</div>`
            }
          </div>
        </div>
      </div>
    </section>
  `;
}

function playContent(playbackId){
  if(!requireLogin()) return;

  if(!playbackId){
    alert("No content playback ID set for this title yet.");
    return;
  }

  alert("Play content with Mux Playback ID: " + playbackId);
}

// ---------- Boot ----------
async function boot(){
  try{
    ensureLogoInHeader();

    await initSupabase();
    await initAuth();

    state.catalog = await fetchCatalogFromManifest();
    localStorage.setItem(LS.lastCatalog, JSON.stringify(state.catalog));

    state.published = state.catalog.filter(x => x.isPublished);

    wireTabs();
    wireSearch();

    router();
    window.addEventListener("hashchange", router);

  } catch(e){
    console.error("Startup failed:", e);

    const cached = safeParse(localStorage.getItem(LS.lastCatalog), []);
    state.catalog = cached;
    state.published = cached.filter(x=>x.isPublished);

    const rowsEl = $("#rows");
    if(rowsEl){
      rowsEl.innerHTML =
        `<div class="text-white/60">Startup failed: ${esc(e.message)}</div>`;
    }
  }
}

// Expose handlers for onclick
window.WatchVIM = {
  navigateToHome,
  navigateToTitle,
  openTrailerById: (id)=>{
    const t = state.published.find(x=>x.id===id);
    if(t) openTrailerModal(t);
  },
  openAuthModal,
  closeAuthModal,
  playContent
};

boot();
