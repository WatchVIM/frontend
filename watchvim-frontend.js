// ======================
// WatchVIM Frontend App (Static SPA)
// - Connects to CMS Stable Manifest -> Stable Catalog
// - Tabs: Movies, Series, Shorts, Foreign
// - Title drilldowns, Series seasons/episodes
// - Mux playback pages
// - Optional Supabase Auth (reads /config.json)
// - Persistent logo top-left across pages
// ======================

(() => {
  // ---------- Config loading ----------
  const DEFAULT_CONFIG = {
    // Point this at the STABLE manifest url your CMS publishes
    // (you can override via /config.json in production).
    MANIFEST_URL:
      "https://hlumlzbtilvrhwxa.public.blob.vercel-storage.com/manifest.json",

    // Put this logo file in the same folder as index.html (or change the path)
    LOGO_URL: "./WatchVIM_New_OTT_Logo.png",

    // Optional – override in /config.json if you wire up auth
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: ""
  };

  let CONFIG = { ...DEFAULT_CONFIG };

  async function loadConfigJSON() {
    try {
      const res = await fetch("/config.json?t=" + Date.now(), {
        cache: "no-store"
      });
      if (!res.ok) return;
      const json = await res.json();
      CONFIG = { ...CONFIG, ...json };
    } catch (_) {
      // optional config, ignore errors
    }
  }

  // ---------- State ----------
  const state = {
    catalog: null,
    titles: [],
    byId: new Map(),
    activeTab: "Movies",
    route: { name: "home", params: {} },
    session: null,
    user: null
  };

  const TAB_FILTERS = {
    Movies: (t) => t.type === "films" || t.type === "documentaries",
    Series: (t) => t.type === "series",
    Shorts: (t) =>
      t.type === "shorts" || (t.runtimeMins && Number(t.runtimeMins) <= 40),
    Foreign: (t) =>
      t.type === "foreign" ||
      (t.genre || []).some((g) => /foreign|international|world/i.test(g)) ||
      (t.language && !/english/i.test(t.language))
  };

  // ---------- Utils ----------
  const $app = () => document.getElementById("app");

  function esc(str = "") {
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m]));
  }

  function toMins(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : "";
  }

  function poster(t) {
    return (
      t.posterUrl ||
      t.appImages?.tvPosterUrl ||
      t.appImages?.mobilePosterUrl ||
      ""
    );
  }

  function hero(t) {
    return (
      t.heroUrl ||
      t.appImages?.tvHeroUrl ||
      t.appImages?.mobileHeroUrl ||
      poster(t) ||
      ""
    );
  }

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const parts = (path || "home").split("/").filter(Boolean);
    const query = Object.fromEntries(new URLSearchParams(qs || ""));

    if (parts[0] === "title" && parts[1]) {
      return { name: "title", params: { id: parts[1] } };
    }
    if (parts[0] === "series" && parts[1]) {
      return { name: "series", params: { id: parts[1] } };
    }
    if (parts[0] === "episode" && parts[1] && parts[2] && parts[3]) {
      // FIXED: preserve ?kind=trailer|content for episodes
      return {
        name: "episode",
        params: {
          seriesId: parts[1],
          seasonIndex: parts[2],
          epIndex: parts[3],
          kind: query.kind || "content"
        }
      };
    }
    if (parts[0] === "watch" && parts[1]) {
      return {
        name: "watch",
        params: { id: parts[1], kind: query.kind || "content" }
      };
    }
    if (parts[0] === "login") return { name: "login", params: {} };
    if (parts[0] === "profile") return { name: "profile", params: {} };

    return { name: "home", params: {} };
  }

  function navTo(hash) {
    // always expect a full hash like "#/home"
    location.hash = hash;
  }

  function setTab(tab) {
    state.activeTab = tab;
    render();
  }

  function readLastWatched() {
    try {
      return JSON.parse(localStorage.getItem("watchvim_last_watched") || "[]");
    } catch {
      return [];
    }
  }

  function saveLastWatched(items) {
    localStorage.setItem(
      "watchvim_last_watched",
      JSON.stringify(items.slice(0, 20))
    );
  }

  function markWatched(titleId, progress = 0) {
    const items = readLastWatched().filter((x) => x.titleId !== titleId);
    items.unshift({ titleId, progress, at: Date.now() });
    saveLastWatched(items);
  }

  function typeLabel(type) {
    const map = {
      films: "Movie",
      documentaries: "Documentary",
      series: "Series",
      shorts: "Short",
      foreign: "Foreign"
    };
    return map[type] || type || "Title";
  }

  // ---------- Data loading ----------
  async function fetchCatalogFromManifest() {
    const mRes = await fetch(CONFIG.MANIFEST_URL + "?t=" + Date.now(), {
      cache: "no-store"
    });
    if (!mRes.ok) throw new Error("Manifest fetch failed");
    const manifest = await mRes.json();

    const catalogUrl = manifest.latestCatalogUrl || manifest.catalogUrl;
    if (!catalogUrl) throw new Error("Manifest missing latestCatalogUrl");

    const cRes = await fetch(catalogUrl + "?t=" + Date.now(), {
      cache: "no-store"
    });
    if (!cRes.ok) throw new Error("Catalog fetch failed");
    return await cRes.json();
  }

  function normalizeCatalog(catalog) {
    const titles = catalog.titles || catalog.publishedTitles || [];
    const byId = new Map();

    titles.forEach((t) => {
      byId.set(t.id, t);
      if (t.type === "series") {
        (t.seasons || []).forEach((s, si) => {
          (s.episodes || []).forEach((ep, ei) => {
            if (!ep.id) ep.id = `${t.id}_s${si + 1}e${ei + 1}`;
            ep.__seriesId = t.id;
            ep.__seasonIndex = si;
            ep.__epIndex = ei;
          });
        });
      }
    });

    return { titles, byId };
  }

  async function loadData() {
    try {
      renderLoading();
      state.catalog = await fetchCatalogFromManifest();
      const norm = normalizeCatalog(state.catalog);
      state.titles = norm.titles;
      state.byId = norm.byId;
      render();
    } catch (err) {
      renderError(err);
    }
  }

  // ---------- Supabase Auth (optional) ----------
  let supabase = null;

  async function initSupabaseIfPossible() {
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return;

    await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    supabase = window.supabase?.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY
    );
    if (!supabase) return;

    const { data } = await supabase.auth.getSession();
    state.session = data.session || null;
    state.user = data.session?.user || null;

    supabase.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      state.user = session?.user || null;
      render();
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function signIn(email, password) {
    if (!supabase) return alert("Auth not configured.");
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) alert(error.message);
  }

  async function signUp(email, password) {
    if (!supabase) return alert("Auth not configured.");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) alert(error.message);
    else alert("Check your email to confirm your account.");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  // ---------- Rendering ----------
  function renderLoading() {
    const app = $app();
    if (!app) return;
    app.innerHTML = `
      <div class="min-h-screen flex flex-col items-center justify-center gap-4 bg-watchBlack">
        <div class="animate-pulse w-16 h-16 rounded-2xl bg-white/10"></div>
        <div class="text-white/70 text-sm">Loading WatchVIM…</div>
      </div>
    `;
  }

  function renderError(err) {
    const app = $app();
    if (!app) return;
    app.innerHTML = `
      <div class="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-watchBlack">
        <div class="text-2xl font-bold text-watchRed">Couldn’t load WatchVIM</div>
        <div class="text-white/70 max-w-xl">
          ${esc(err?.message || err)}
        </div>
        <div class="text-white/50 text-sm">
          Make sure your MANIFEST_URL points to the <b>stable manifest</b> published by the CMS.
        </div>
        <button class="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20" onclick="location.reload()">Retry</button>
      </div>
    `;
  }

  function Header() {
    const loggedIn = !!state.user;
    return `
      <header class="sticky top-0 z-50 bg-watchBlack/95 backdrop-blur border-b border-white/10">
        <div class="px-4 py-3 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 cursor-pointer" onclick="navTo('#/home')">
            <img src="${CONFIG.LOGO_URL}" alt="WatchVIM" class="h-8 w-auto object-contain"/>
          </div>

          <nav class="flex items-center gap-2 text-sm">
            ${["Movies","Series","Shorts","Foreign"]
              .map(
                (tab) => `
              <button
                class="px-3 py-1.5 rounded-full ${
                  state.activeTab === tab
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:bg-white/10"
                }"
                onclick="setTab('${tab}')"
              >
                ${tab}
              </button>`
              )
              .join("")}
          </nav>

          <div class="flex items-center gap-2 text-sm">
            ${
              loggedIn
                ? `
              <button class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20" onclick="navTo('#/profile')">Profile</button>
              <button class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20" onclick="signOut()">Log out</button>
            `
                : `
              <button class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20" onclick="navTo('#/login')">Log in</button>
            `
            }
          </div>
        </div>
      </header>
    `;
  }

  function HeroRow(items) {
    if (!items.length) return "";
    const t = items[0];
    const img = hero(t);
    return `
      <section class="relative w-full overflow-hidden">
        <div class="aspect-video md:aspect-[21/9] bg-black">
          ${
            img
              ? `<img src="${img}" class="w-full h-full object-cover opacity-90"/>`
              : ""
          }
          <div class="absolute inset-0 bg-gradient-to-t from-watchBlack via-watchBlack/40 to-transparent"></div>
        </div>

        <div class="absolute left-0 right-0 bottom-0 p-4 md:p-8">
          <div class="max-w-3xl space-y-2">
            <div class="text-xs uppercase tracking-widest text-watchGold/90">${typeLabel(
              t.type
            )}</div>
            <h1 class="text-2xl md:text-4xl font-black">${esc(
              t.title || "Untitled"
            )}</h1>
            <p class="text-white/80 line-clamp-3">${esc(t.synopsis || "")}</p>
            <div class="flex flex-wrap gap-2 text-xs text-white/70">
              ${
                t.releaseYear
                  ? `<span class="px-2 py-1 rounded bg-white/10">${esc(
                      t.releaseYear
                    )}</span>`
                  : ""
              }
              ${
                toMins(t.runtimeMins)
                  ? `<span class="px-2 py-1 rounded bg-white/10">${toMins(
                      t.runtimeMins
                    )} mins</span>`
                  : ""
              }
              ${(t.genre || [])
                .slice(0, 4)
                .map(
                  (g) =>
                    `<span class="px-2 py-1 rounded bg-white/10">${esc(
                      g
                    )}</span>`
                )
                .join("")}
            </div>

            <div class="pt-2 flex gap-2">
              <button
                class="px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
                onclick="navTo('#/${
                  t.type === "series" ? "series" : "title"
                }/${t.id}')"
              >
                View
              </button>
              ${
                t.trailerPlaybackId
                  ? `
                <button
                  class="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20"
                  onclick="navTo('#/watch/${t.id}?kind=trailer')"
                >
                  Play Trailer
                </button>`
                  : ""
              }
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function Row(title, items, moreHref) {
    if (!items.length) return "";
    return `
      <section class="px-4 md:px-8 space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">${esc(title)}</h2>
          ${
            moreHref
              ? `<button class="text-xs text-white/60 hover:text-white" onclick="navTo('${moreHref}')">See all</button>`
              : ""
          }
        </div>
        <div class="flex gap-3 overflow-x-auto pb-2">
          ${items.map(Card).join("")}
        </div>
      </section>
    `;
  }

  function Card(t) {
    const img = poster(t);
    const href = t.type === "series" ? `#/series/${t.id}` : `#/title/${t.id}`;
    return `
      <div class="min-w-[140px] md:min-w-[170px] cursor-pointer" onclick="navTo('${href}')">
        <div class="aspect-[2/3] rounded-xl overflow-hidden bg-white/5 border border-white/10">
          ${img ? `<img src="${img}" class="w-full h-full object-cover"/>` : ""}
        </div>
        <div class="mt-2 text-sm font-semibold line-clamp-2">
          ${esc(t.title || "Untitled")}
        </div>
        <div class="text-xs text-white/60">${typeLabel(t.type)}</div>
      </div>
    `;
  }

  function HomePage() {
    const filtered =
      state.titles.filter(TAB_FILTERS[state.activeTab] || (() => true)) || [];
    const heroItems = filtered.slice(0, 1);
    const lastWatched = readLastWatched()
      .map((x) => state.byId.get(x.titleId))
      .filter(Boolean);

    const byGenreBuckets = {};
    filtered.forEach((t) => {
      (t.genre || ["Featured"]).forEach((g) => {
        const key = g || "Featured";
        byGenreBuckets[key] = byGenreBuckets[key] || [];
        byGenreBuckets[key].push(t);
      });
    });

    const genreRows = Object.entries(byGenreBuckets)
      .slice(0, 8)
      .map(([g, items]) => Row(g, items.slice(0, 20)))
      .join("");

    return `
      ${HeroRow(heroItems)}
      <div class="py-6 space-y-6">
        ${
          lastWatched.length
            ? Row("Continue Watching", lastWatched.slice(0, 12))
            : ""
        }
        ${Row(`Top ${state.activeTab}`, filtered.slice(0, 20))}
        ${genreRows}
      </div>
    `;
  }

  function TitlePage(id) {
    const t = state.byId.get(id);
    if (!t) return NotFound("Title not found");

    const img = hero(t);
    const monet = t.monetization || {};
    const tvod = monet.tvod || {};
    const accessBadge = [
      monet.svod ? "SVOD" : null,
      monet.avod ? "AVOD" : null,
      tvod.enabled ? "TVOD" : null
    ]
      .filter(Boolean)
      .join(" • ");

    return `
      <section class="relative">
        <div class="aspect-video bg-black">
          ${
            img
              ? `<img src="${img}" class="w-full h-full object-cover opacity-90"/>`
              : ""
          }
          <div class="absolute inset-0 bg-gradient-to-t from-watchBlack via-watchBlack/40 to-transparent"></div>
        </div>
        <div class="p-4 md:p-8 -mt-12 md:-mt-20 relative z-10">
          <div class="max-w-4xl space-y-3">
            <button class="text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>
            <div class="flex flex-wrap gap-2 text-xs text-white/70">
              <span class="px-2 py-1 rounded bg-white/10">${typeLabel(
                t.type
              )}</span>
              ${
                t.releaseYear
                  ? `<span class="px-2 py-1 rounded bg-white/10">${esc(
                      t.releaseYear
                    )}</span>`
                  : ""
              }
              ${
                toMins(t.runtimeMins)
                  ? `<span class="px-2 py-1 rounded bg-white/10">${toMins(
                      t.runtimeMins
                    )} mins</span>`
                  : ""
              }
              ${
                accessBadge
                  ? `<span class="px-2 py-1 rounded bg-watchGold/20 text-watchGold">${accessBadge}</span>`
                  : ""
              }
            </div>
            <h1 class="text-2xl md:text-4xl font-black">${esc(
              t.title || "Untitled"
            )}</h1>
            <p class="text-white/80">${esc(t.synopsis || "")}</p>

            <div class="flex flex-wrap gap-2 pt-2">
              ${
                t.trailerPlaybackId
                  ? `
                <button class="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20"
                        onclick="navTo('#/watch/${t.id}?kind=trailer')">Play Trailer</button>
              `
                  : ""
              }

              ${renderWatchCTA(t)}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderWatchCTA(t) {
    const monet = t.monetization || {};
    const tvod = monet.tvod || {};
    const canWatch = monet.svod || monet.avod || !tvod.enabled;

    if (tvod.enabled && !state.user) {
      return `<button class="px-4 py-2 rounded-lg bg-watchRed font-bold" onclick="navTo('#/login')">Log in to Rent/Buy</button>`;
    }

    if (tvod.enabled && state.user) {
      return `
        <button class="px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
                onclick="alert('TVOD checkout coming next.'); navTo('#/watch/${t.id}?kind=content')">
          Rent / Buy
        </button>
      `;
    }

    if (canWatch) {
      return `
        <button class="px-4 py-2 rounded-lg bg-watchRed font-bold hover:opacity-90"
                onclick="navTo('#/watch/${t.id}?kind=content')">Watch Now</button>
      `;
    }

    return "";
  }

  function SeriesPage(id) {
    const s = state.byId.get(id);
    if (!s || s.type !== "series") return NotFound("Series not found");

    const img = hero(s);

    return `
      <section class="relative">
        <div class="aspect-video bg-black">
          ${
            img
              ? `<img src="${img}" class="w-full h-full object-cover opacity-90"/>`
              : ""
          }
          <div class="absolute inset-0 bg-gradient-to-t from-watchBlack via-watchBlack/40 to-transparent"></div>
        </div>
        <div class="p-4 md:p-8 -mt-12 md:-mt-20 relative z-10">
          <div class="max-w-5xl space-y-3">
            <button class="text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>
            <div class="text-xs uppercase tracking-widest text-watchGold/90">Series</div>
            <h1 class="text-2xl md:text-4xl font-black">${esc(
              s.title || "Untitled"
            )}</h1>
            <p class="text-white/80">${esc(s.synopsis || "")}</p>

            <div class="flex flex-wrap gap-2 pt-2">
              ${
                s.trailerPlaybackId
                  ? `
                <button class="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20"
                        onclick="navTo('#/watch/${s.id}?kind=trailer')">Play Trailer</button>
              `
                  : ""
              }
            </div>

            <div class="pt-6 space-y-5">
              ${
                (s.seasons || [])
                  .map((season, si) => SeasonBlock(s, season, si))
                  .join("") ||
                `<div class="text-white/60 text-sm">No seasons published yet.</div>`
              }
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function SeasonBlock(series, season, seasonIndex) {
    const episodes = season.episodes || [];
    return `
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">Season ${
            season.seasonNumber || seasonIndex + 1
          }</h2>
          <div class="text-xs text-white/60">${episodes.length} episodes</div>
        </div>
        <div class="space-y-2">
          ${episodes
            .map((ep, ei) =>
              EpisodeRow(series, season, ep, seasonIndex, ei)
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function EpisodeRow(series, _season, ep, seasonIndex, epIndex) {
    const img = ep.thumbnailUrl || series.posterUrl || "";
    return `
      <div class="flex gap-3 p-2 rounded-lg bg-white/5 border border-white/10">
        <img src="${img}" class="w-20 h-28 object-cover rounded-md bg-black/40"/>
        <div class="flex-1 space-y-1">
          <div class="text-sm font-semibold">
            E${ep.episodeNumber || epIndex + 1} — ${esc(ep.title || "Untitled")}
          </div>
          <div class="text-xs text-white/60 line-clamp-2">${esc(
            ep.synopsis || ""
          )}</div>
          <div class="text-xs text-white/60">
            ${
              toMins(ep.runtimeMins)
                ? `${toMins(ep.runtimeMins)} mins`
                : ""
            }
          </div>
          <div class="flex gap-2 pt-1">
            ${
              ep.trailerPlaybackId
                ? `
              <button class="px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/20"
                      onclick="navTo('#/episode/${series.id}/${seasonIndex}/${epIndex}?kind=trailer')">Trailer</button>
            `
                : ""
            }
            <button class="px-3 py-1.5 text-xs rounded bg-watchRed font-bold"
                    onclick="navTo('#/episode/${series.id}/${seasonIndex}/${epIndex}?kind=content')">Watch</button>
          </div>
        </div>
      </div>
    `;
  }

  function EpisodeWatchPage(seriesId, seasonIndex, epIndex, kind = "content") {
    const s = state.byId.get(seriesId);
    const season = s?.seasons?.[Number(seasonIndex)];
    const ep = season?.episodes?.[Number(epIndex)];
    if (!s || !ep) return NotFound("Episode not found");

    const playbackId =
      kind === "trailer" ? ep.trailerPlaybackId : ep.contentPlaybackId;

    if (!playbackId) {
      return `
        <div class="p-6 space-y-3">
          <button class="text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>
          <div class="text-white/70">No ${kind} playback ID set for this episode.</div>
        </div>
      `;
    }

    setTimeout(() => markWatched(seriesId, 0), 0);

    return `
      <div class="p-4 md:p-8 space-y-4">
        <button class="text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>
        <div class="text-xl font-bold">
          ${esc(s.title)} — S${season.seasonNumber || Number(seasonIndex) + 1}E${
      ep.episodeNumber || Number(epIndex) + 1
    }
        </div>

        <div class="aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
          <mux-player
            stream-type="on-demand"
            playback-id="${esc(playbackId)}"
            class="w-full h-full"
            muted="false"
            controls
            autoplay
          ></mux-player>
        </div>
      </div>
    `;
  }

  function WatchPage(id, kind = "content") {
    const t = state.byId.get(id);
    if (!t) return NotFound("Title not found");

    if (t.type === "series") {
      const pb =
        kind === "trailer" ? t.trailerPlaybackId : t.contentPlaybackId;
      if (!pb) return NotFound("No playback ID for series.");
      setTimeout(() => markWatched(id, 0), 0);
      return `
        <div class="p-4 md:p-8 space-y-4">
          <button class="text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>
          <div class="text-xl font-bold">${esc(t.title)}</div>
          <div class="aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
            <mux-player
              stream-type="on-demand"
              playback-id="${esc(pb)}"
              class="w-full h-full"
              controls
              autoplay
            ></mux-player>
          </div>
        </div>
      `;
    }

    const pb =
      kind === "trailer" ? t.trailerPlaybackId : t.contentPlaybackId;
    if (!pb) {
      return `
        <div class="p-6 space-y-3">
          <button class="text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>
          <div class="text-white/70">No ${kind} playback ID set for this title.</div>
        </div>
      `;
    }

    setTimeout(() => markWatched(id, 0), 0);

    return `
      <div class="p-4 md:p-8 space-y-4">
        <button class="text-xs text-white/70 hover:text-white" onclick="history.back()">← Back</button>
        <div class="text-xl font-bold">${esc(t.title)}</div>

        <div class="aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
          <mux-player
            stream-type="on-demand"
            playback-id="${esc(pb)}"
            class="w-full h-full"
            muted="false"
            controls
            autoplay
          ></mux-player>
        </div>
      </div>
    `;
  }

  function LoginPage() {
    if (!supabase) {
      return `
        <div class="p-6 max-w-md mx-auto space-y-3">
          <div class="text-2xl font-bold">Login</div>
          <div class="text-white/70 text-sm">
            Supabase isn’t configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to /config.json.
          </div>
        </div>
      `;
    }

    return `
      <div class="p-6 max-w-md mx-auto space-y-4">
        <div class="text-2xl font-bold">Log in to WatchVIM</div>

        <div class="space-y-2">
          <div class="text-xs text-white/60">Email</div>
          <input id="loginEmail" class="w-full px-3 py-2 rounded bg-white/5 border border-white/10" placeholder="you@email.com"/>
        </div>
        <div class="space-y-2">
          <div class="text-xs text-white/60">Password</div>
          <input id="loginPass" type="password" class="w-full px-3 py-2 rounded bg-white/5 border border-white/10" placeholder="••••••••"/>
        </div>

        <div class="flex gap-2">
          <button class="flex-1 px-4 py-2 rounded bg-watchRed font-bold" onclick="handleSignIn()">Log in</button>
          <button class="flex-1 px-4 py-2 rounded bg-white/10 hover:bg-white/20" onclick="handleSignUp()">Sign up</button>
        </div>

        <div class="text-xs text-white/60">
          Sign up creates an account. You may need to confirm via email.
        </div>
      </div>
    `;
  }

  function ProfilePage() {
    if (!supabase) return NotFound("Auth not configured.");
    if (!state.user) {
      return `
        <div class="p-6 max-w-md mx-auto space-y-3">
          <div class="text-2xl font-bold">Profile</div>
          <div class="text-white/70">You’re not logged in.</div>
          <button class="px-4 py-2 rounded bg-watchRed font-bold" onclick="navTo('#/login')">Log in</button>
        </div>
      `;
    }

    const lastWatched = readLastWatched()
      .map((x) => state.byId.get(x.titleId))
      .filter(Boolean);

    return `
      <div class="p-6 max-w-3xl mx-auto space-y-4">
        <div class="text-2xl font-bold">Your Profile</div>
        <div class="card bg-white/5 border border-white/10 rounded-xl p-4">
          <div class="text-sm text-white/60">Email</div>
          <div class="font-semibold">${esc(state.user.email)}</div>
        </div>

        ${
          lastWatched.length
            ? `
          <div class="space-y-2">
            <div class="text-lg font-bold">Continue Watching</div>
            <div class="flex gap-3 overflow-x-auto pb-2">
              ${lastWatched.slice(0, 12).map(Card).join("")}
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;
  }

  function NotFound(msg = "Not found") {
    return `
      <div class="p-6 text-center space-y-2">
        <div class="text-xl font-bold">${esc(msg)}</div>
        <button class="px-4 py-2 rounded bg-white/10 hover:bg-white/20" onclick="navTo('#/home')">Go Home</button>
      </div>
    `;
  }

  function render() {
    const app = $app();
    if (!app) return;

    state.route = parseHash();
    const r = state.route;

    let page = "";
    if (r.name === "home") page = HomePage();
    else if (r.name === "title") page = TitlePage(r.params.id);
    else if (r.name === "series") page = SeriesPage(r.params.id);
    else if (r.name === "episode")
      page = EpisodeWatchPage(
        r.params.seriesId,
        r.params.seasonIndex,
        r.params.epIndex,
        r.params.kind || "content"
      );
    else if (r.name === "watch") page = WatchPage(r.params.id, r.params.kind);
    else if (r.name === "login") page = LoginPage();
    else if (r.name === "profile") page = ProfilePage();
    else page = HomePage();

    app.innerHTML = `
      ${Header()}
      <div class="min-h-[calc(100vh-64px)] bg-watchBlack">
        ${page}
      </div>
      <footer class="px-4 md:px-8 py-6 text-xs text-white/50 border-t border-white/10">
        © WatchVIM — Powered by VIM Media
      </footer>
    `;
  }

  // expose handlers for inline onclick
  window.setTab = setTab;
  window.navTo = navTo;
  window.signOut = signOut;

  window.handleSignIn = () => {
    const email = document.getElementById("loginEmail")?.value.trim();
    const password = document.getElementById("loginPass")?.value.trim();
    if (!email || !password) return alert("Enter email + password.");
    signIn(email, password);
  };
  window.handleSignUp = () => {
    const email = document.getElementById("loginEmail")?.value.trim();
    const password = document.getElementById("loginPass")?.value.trim();
    if (!email || !password) return alert("Enter email + password.");
    signUp(email, password);
  };

  // ---------- Boot ----------
  async function boot() {
    await loadConfigJSON();
    await initSupabaseIfPossible();
    await loadData();
    window.addEventListener("hashchange", render);
  }

  boot();
})();
