/* ============================================================
   STELLAR // Simulation Observatory
   ------------------------------------------------------------
   Vanilla JS application. No dependencies.
   Responsibilities:
     - Load /data/files.json
     - Parse simulation PNG filenames into structured metadata
     - Render filters, navigation (N → d → gallery), gallery, modals
     - Comparison tray + comparison modal
     - Lightbox with zoom / pan / keyboard navigation
     - Background canvas effects (starfield, comets, cursor trail,
       black-hole easter egg, hidden constellations)
   ============================================================ */

(() => {
  'use strict';

  /* ================================================================
     1. CONSTANTS & STATE
     ================================================================ */

  // Regex parses filenames of the form:
  //   d_03_N_12_tau_09_rinit_15000R_T_100bil_count_384.png
  // Each captured group is a string so we preserve the original
  // formatting (e.g. "15000R", "100bil"). Numeric comparisons use
  // parsed numeric portions.
  const FILENAME_REGEX =
    /^d_(\d+)_N_(\d+)_tau_([^_]+)_rinit_([^_]+)_T_([^_]+)_count_(\d+)\.png$/i;

  const IMAGE_BASE_PATH = 'images/';
  const DATA_PATH       = 'data/files.json';

  /**
   * Global application state. Rendered views are a pure function
   * of this object. Any mutation should go through `setState()`.
   */
  const state = {
    files: [],                  // parsed file objects { raw, d, N, tau, rinit, T, count, dNum, NNum, countNum, rinitNum, TNum }
    loaded: false,
    error: null,

    // Active filter sets -- empty Set means "no restriction"
    filters: {
      N:     new Set(),
      d:     new Set(),
      tau:   new Set(),
      rinit: new Set(),
      T:     new Set(),
      count: new Set(),
    },
    sort: 'N_asc_d_asc',

    // Selected item names for comparison (uses raw filename as key)
    comparison: new Set(),
  };

  /* ================================================================
     2. FILENAME PARSING
     ================================================================ */

  /**
   * Parse a single filename. Returns null on malformed input so the
   * caller can filter them out and report gracefully.
   * @param {string} filename
   */
  function parseFilename(filename) {
    if (typeof filename !== 'string') return null;
    const match = filename.match(FILENAME_REGEX);
    if (!match) return null;

    const [, d, N, tau, rinit, T, count] = match;

    // Best-effort numeric parsing of components that may contain units.
    // e.g. "100bil" -> 100e9, "1trillion" -> 1e12, "15000R" -> 15000
    const NNum     = parseInt(N, 10);
    const dNum     = parseInt(d, 10);
    const countNum = parseInt(count, 10);
    const rinitNum = parseFloat(rinit) || 0;
    const TNum     = parseTimeHorizon(T);
    const tauNum   = parseFloat(tau);

    if (Number.isNaN(NNum) || Number.isNaN(dNum) || Number.isNaN(countNum)) {
      return null;
    }

    return {
      raw: filename,
      d, N, tau, rinit, T, count,          // display strings (preserved as written)
      dNum, NNum, countNum, rinitNum, TNum, tauNum
    };
  }

  /**
   * Convert "100bil" / "1trillion" / "10bil" style time horizon tokens
   * into a numeric value for sorting / comparison. Falls back to 0.
   */
  function parseTimeHorizon(s) {
    if (!s) return 0;
    const m = String(s).toLowerCase().match(/^([\d.]+)\s*([a-z]*)$/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    if (Number.isNaN(n)) return 0;
    const unit = m[2];
    const mult =
      unit.startsWith('tril') ? 1e12 :
      unit.startsWith('bil')  ? 1e9  :
      unit.startsWith('mil')  ? 1e6  :
      unit.startsWith('k')    ? 1e3  : 1;
    return n * mult;
  }

  /* ================================================================
     3. DATA LOAD
     ================================================================ */

  async function loadData() {
    try {
      const resp = await fetch(DATA_PATH, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const raw = await resp.json();
      if (!Array.isArray(raw)) throw new Error('files.json is not an array');

      const parsed = [];
      const malformed = [];
      for (const f of raw) {
        const p = parseFilename(f);
        if (p) parsed.push(p);
        else malformed.push(f);
      }

      if (malformed.length) {
        console.warn(`[Stellar] Skipped ${malformed.length} malformed filename(s):`, malformed);
      }

      state.files = parsed;
      state.loaded = true;
      state.error = null;
      renderAll();
    } catch (err) {
      console.error('[Stellar] Failed to load data:', err);
      state.error = err.message || String(err);
      state.loaded = true;
      renderAll();
    }
  }

  /* ================================================================
     4. STATE HELPERS
     ================================================================ */

  function setState(patch) {
    Object.assign(state, patch);
    renderAll();
  }

  function toggleFilter(key, value) {
    const set = state.filters[key];
    if (!set) return;
    if (set.has(value)) set.delete(value);
    else set.add(value);
    renderAll();
  }

  function clearFilter(key) {
    state.filters[key]?.clear();
    renderAll();
  }

  function clearAllFilters() {
    for (const k of Object.keys(state.filters)) state.filters[k].clear();
    renderAll();
  }

  /* ================================================================
     5. FILTERING + SORTING
     ================================================================ */

  /**
   * Return a list of files matching the active filters.
   * An empty filter set for a key means "all values allowed".
   */
  function getFilteredFiles() {
    const { filters } = state;
    return state.files.filter((f) =>
      (filters.N.size     === 0 || filters.N.has(f.N))         &&
      (filters.d.size     === 0 || filters.d.has(f.d))         &&
      (filters.tau.size   === 0 || filters.tau.has(f.tau))     &&
      (filters.rinit.size === 0 || filters.rinit.has(f.rinit)) &&
      (filters.T.size     === 0 || filters.T.has(f.T))         &&
      (filters.count.size === 0 || filters.count.has(f.count))
    );
  }

  /**
   * Sort files according to the current sort key.
   */
  function sortFiles(files) {
    const list = files.slice();
    const by = {
      N_asc_d_asc:  (a, b) => a.NNum - b.NNum || a.dNum - b.dNum || a.countNum - b.countNum,
      N_desc_d_asc: (a, b) => b.NNum - a.NNum || a.dNum - b.dNum,
      d_asc_N_asc:  (a, b) => a.dNum - b.dNum || a.NNum - b.NNum,
      count_desc:   (a, b) => b.countNum - a.countNum || a.NNum - b.NNum,
    };
    list.sort(by[state.sort] || by.N_asc_d_asc);
    return list;
  }

  /* ================================================================
     6. DOM HELPERS
     ================================================================ */

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /**
   * Minimal HTML templating helper. Returns a string safe for innerHTML
   * usage when values are escaped.
   */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  /* ================================================================
     7. RENDER: ROOT
     ================================================================ */

  function renderAll() {
    renderTelemetry();
    renderFilters();
    renderBreadcrumb();
    renderMain();
    renderCompareTray();
  }

  function renderTelemetry() {
    const totalEl = $('[data-stat="total"]');
    const dimsEl  = $('[data-stat="dims"]');
    const nsEl    = $('[data-stat="ns"]');
    const shownEl = $('[data-stat="shown"]');

    if (!state.loaded || state.error) {
      totalEl.textContent = '—';
      dimsEl.textContent  = '—';
      nsEl.textContent    = '—';
      shownEl.textContent = '—';
      return;
    }

    const dims = new Set(state.files.map((f) => f.d));
    const ns   = new Set(state.files.map((f) => f.N));
    totalEl.textContent = state.files.length.toString().padStart(3, '0');
    dimsEl.textContent  = dims.size.toString().padStart(2, '0');
    nsEl.textContent    = ns.size.toString().padStart(2, '0');
    shownEl.textContent = getFilteredFiles().length.toString().padStart(3, '0');
  }

  /* ================================================================
     8. RENDER: FILTERS
     ================================================================ */

  /**
   * For each filter group, inject chips for every unique value in the
   * dataset. This is dynamic -- we never hardcode any N / d values.
   */
  function renderFilters() {
    const groups = [
      { key: 'N',     sortFn: numericSort('NNum',    'N')     },
      { key: 'd',     sortFn: numericSort('dNum',    'd')     },
      { key: 'tau',   sortFn: alphaSort('tau')                },
      { key: 'rinit', sortFn: numericSort('rinitNum','rinit') },
      { key: 'T',     sortFn: numericSort('TNum',    'T')     },
      { key: 'count', sortFn: numericSort('countNum','count') },
    ];

    for (const { key, sortFn } of groups) {
      const container = $(`[data-filter-group="${key}"]`);
      if (!container) continue;

      // Collect unique values + their numeric/alpha sort keys
      const seen = new Map(); // displayValue -> any file
      for (const f of state.files) {
        if (!seen.has(f[key])) seen.set(f[key], f);
      }
      const values = Array.from(seen.values()).sort(sortFn).map((f) => f[key]);

      container.innerHTML = values.map((v) => {
        const on = state.filters[key].has(v);
        return `<button class="chip" data-filter="${esc(key)}" data-value="${esc(v)}" aria-pressed="${on}">${esc(formatFilterLabel(key, v))}</button>`;
      }).join('');
    }

    // Sort chips
    $$('#sort-chips .chip').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.sort === state.sort));
    });
  }

  function formatFilterLabel(key, v) {
    if (key === 'N') return 'N = ' + parseInt(v, 10);
    if (key === 'd') return 'd = ' + parseInt(v, 10);
    if (key === 'tau') return 'τ = ' + v;
    if (key === 'rinit') return v;
    if (key === 'T') return v;
    if (key === 'count') return v;
    return v;
  }

  function numericSort(numKey) {
    return (a, b) => a[numKey] - b[numKey];
  }
  function alphaSort(key) {
    return (a, b) => String(a[key]).localeCompare(String(b[key]), undefined, { numeric: true });
  }

  /* ================================================================
     9. RENDER: BREADCRUMB
     ================================================================ */

  function renderBreadcrumb() {
    const el = $('#breadcrumb');
    if (!el) return;

    const crumbs = [];
    crumbs.push(`<span class="crumb link" data-crumb="root">ALL</span>`);

    const nVals = Array.from(state.filters.N).sort((a, b) => parseInt(a) - parseInt(b));
    const dVals = Array.from(state.filters.d).sort((a, b) => parseInt(a) - parseInt(b));

    if (nVals.length) {
      crumbs.push(`<span class="crumb-sep">›</span>`);
      crumbs.push(`<span class="crumb active">N = ${nVals.map((n) => parseInt(n)).join(', ')}</span>`);
    }
    if (dVals.length) {
      crumbs.push(`<span class="crumb-sep">›</span>`);
      crumbs.push(`<span class="crumb active">d = ${dVals.map((d) => parseInt(d)).join(', ')}</span>`);
    }

    el.innerHTML = crumbs.join('');
  }

  /* ================================================================
     10. RENDER: MAIN STAGE
     ================================================================ */

  function renderMain() {
    const stage = $('#main-stage');
    if (!stage) return;

    if (!state.loaded) {
      // keep default loading state markup
      return;
    }

    if (state.error) {
      stage.innerHTML = `
        <div class="error-state">
          <div class="icon">⚠</div>
          <h3>SIGNAL LOST</h3>
          <p>Could not reach <code>${esc(DATA_PATH)}</code>.<br/>
             <span style="color: var(--ink-3)">${esc(state.error)}</span></p>
          <button id="retry-btn" class="btn primary">RE-ESTABLISH LINK</button>
        </div>`;
      $('#retry-btn')?.addEventListener('click', () => {
        state.loaded = false;
        state.error  = null;
        stage.innerHTML = defaultLoadingHTML();
        loadData();
      });
      return;
    }

    if (state.files.length === 0) {
      stage.innerHTML = `
        <div class="empty-state">
          <div class="icon">∅</div>
          <h3>NO TRANSMISSIONS</h3>
          <p>The data manifest is empty. Add PNG filenames to <code>data/files.json</code> and reload.</p>
        </div>`;
      return;
    }

    // Decide which view to show based on filter state
    const hasN = state.filters.N.size > 0;
    const hasD = state.filters.d.size > 0;

    if (!hasN) {
      renderNSelector(stage);
    } else if (!hasD) {
      renderDSelector(stage);
    } else {
      renderGallery(stage);
    }
  }

  function defaultLoadingHTML() {
    return `
      <div class="loading-state">
        <div class="orbit-loader" aria-hidden="true"><span></span><span></span><span></span></div>
        <p class="loading-text">ACQUIRING SIGNAL…</p>
      </div>`;
  }

  /* ---- N selector (level 1) --------------------------------------- */
  function renderNSelector(stage) {
    const base = getFilesWithoutFilter('N');
    const byN  = new Map();
    for (const f of base) {
      if (!byN.has(f.N)) byN.set(f.N, []);
      byN.get(f.N).push(f);
    }
    const entries = Array.from(byN.entries())
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    if (!entries.length) {
      stage.innerHTML = emptyFilteredHTML();
      return;
    }

    const cards = entries.map(([n, files]) => {
      const dims = new Set(files.map((f) => f.d));
      const tags = Array.from(dims).sort((a, b) => parseInt(a) - parseInt(b))
        .map((d) => `<span class="tag">d=${parseInt(d)}</span>`).join('');
      return `
        <button class="nav-card" data-select-n="${esc(n)}">
          ${particleConstellationSVG(parseInt(n), 2)}
          <div class="nav-card-top">PARTICLE COUNT</div>
          <div class="nav-card-value">${parseInt(n)}<span class="unit">bodies</span></div>
          <div class="nav-card-meta">
            <span class="tag">${files.length} runs</span>${tags}
          </div>
        </button>`;
    }).join('');

    stage.innerHTML = `
      <div class="section-head">
        <h2><span class="hl">//</span> PARTICLE COUNT <span class="sub">N — SELECT PRIMARY AXIS</span></h2>
        <span class="sub">${entries.length} value${entries.length === 1 ? '' : 's'}</span>
      </div>
      <p class="section-intro">Choose an N to drill into available simulation dimensions. Cards report the run count and which dimensions d are available for that particle count.</p>
      <div class="card-grid">${cards}</div>
    `;
  }

  /* ---- d selector (level 2) --------------------------------------- */
  function renderDSelector(stage) {
    const nList = Array.from(state.filters.N);
    const filesInN = state.files.filter((f) => nList.includes(f.N));

    const base = filesInN.filter((f) => passesAllExcept(f, ['d']));
    const byD  = new Map();
    for (const f of base) {
      if (!byD.has(f.d)) byD.set(f.d, []);
      byD.get(f.d).push(f);
    }
    const entries = Array.from(byD.entries())
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    const nLabel = nList.map((n) => parseInt(n)).sort((a, b) => a - b).join(', ');

    if (!entries.length) {
      stage.innerHTML = `
        ${sectionHeadD(nLabel, 0)}
        ${emptyFilteredHTML()}
      `;
      return;
    }

    const cards = entries.map(([d, files]) => `
      <button class="nav-card" data-select-d="${esc(d)}">
        ${particleConstellationSVG(parseInt(files[0].N), parseInt(d))}
        <div class="nav-card-top">DIMENSION</div>
        <div class="nav-card-value">d = ${parseInt(d)}<span class="unit">space</span></div>
        <div class="nav-card-meta">
          <span class="tag">${files.length} run${files.length === 1 ? '' : 's'}</span>
          <span class="tag">N = ${nLabel}</span>
        </div>
      </button>`).join('');

    stage.innerHTML = `
      ${sectionHeadD(nLabel, entries.length)}
      <p class="section-intro">Showing dimensions available for the selected particle count. Click a card to inspect the matching PNG samples.</p>
      <div class="card-grid">${cards}</div>
    `;
  }

  function sectionHeadD(nLabel, count) {
    return `
      <div class="section-head">
        <h2><span class="hl">//</span> DIMENSION <span class="sub">d — FOR N = ${esc(nLabel)}</span></h2>
        <span class="sub">${count} value${count === 1 ? '' : 's'}</span>
      </div>`;
  }

  /* ---- Gallery (level 3) ------------------------------------------ */
  function renderGallery(stage) {
    const files = sortFiles(getFilteredFiles());
    const nLabel = Array.from(state.filters.N).map((n) => parseInt(n)).sort((a, b) => a - b).join(', ');
    const dLabel = Array.from(state.filters.d).map((d) => parseInt(d)).sort((a, b) => a - b).join(', ');

    if (!files.length) {
      stage.innerHTML = `
        <div class="section-head">
          <h2><span class="hl">//</span> SAMPLES <span class="sub">N = ${esc(nLabel)} · d = ${esc(dLabel)}</span></h2>
        </div>
        ${emptyFilteredHTML()}`;
      return;
    }

    const cards = files.map((f) => imageCardHTML(f)).join('');

    stage.innerHTML = `
      <div class="section-head">
        <h2><span class="hl">//</span> SAMPLES <span class="sub">N = ${esc(nLabel)} · d = ${esc(dLabel)}</span></h2>
        <span class="sub">${files.length} file${files.length === 1 ? '' : 's'}</span>
      </div>
      <p class="section-intro">Click any tile to inspect at full resolution with pan + zoom. Use ◎ to queue items for side-by-side comparison.</p>
      <div class="gallery">${cards}</div>
    `;
  }

  function emptyFilteredHTML() {
    return `
      <div class="empty-state">
        <div class="icon">◌</div>
        <h3>NO MATCHING TRANSMISSIONS</h3>
        <p>The current filter combination produced zero results. Loosen a filter or reset to continue exploring.</p>
        <button class="btn primary" id="reset-from-empty">RESET FILTERS</button>
      </div>`;
  }

  /**
   * Returns the list of files passing every filter except the ones
   * listed in `ignored`. Used for the cascading N / d selectors so
   * e.g. the N grid shows all possible N even if d is set.
   */
  function passesAllExcept(f, ignored) {
    const keys = ['N', 'd', 'tau', 'rinit', 'T', 'count'].filter((k) => !ignored.includes(k));
    return keys.every((k) => {
      const s = state.filters[k];
      return s.size === 0 || s.has(f[k]);
    });
  }
  function getFilesWithoutFilter(ignoredKey) {
    return state.files.filter((f) => passesAllExcept(f, [ignoredKey]));
  }

  /* ================================================================
     11. RENDER: IMAGE CARD
     ================================================================ */

  function imageCardHTML(f) {
    const isSelected = state.comparison.has(f.raw);
    return `
      <article class="img-card" data-raw="${esc(f.raw)}">
        <div class="img-thumb" data-open-lightbox="${esc(f.raw)}">
          ${imageOrFallback(f)}
          <button class="compare-check ${isSelected ? 'on' : ''}"
                  data-toggle-compare="${esc(f.raw)}"
                  title="${isSelected ? 'Remove from comparison' : 'Add to comparison'}"
                  aria-label="${isSelected ? 'Remove from comparison' : 'Add to comparison'}">✓</button>
          <button class="expand-btn"
                  data-open-lightbox="${esc(f.raw)}"
                  title="Open in inspector" aria-label="Open in inspector">⤢</button>
        </div>
        <div class="img-meta">
          <div class="meta-row highlight"><span class="meta-label">N</span><span class="meta-value">${parseInt(f.N)}</span></div>
          <div class="meta-row highlight"><span class="meta-label">d</span><span class="meta-value">${parseInt(f.d)}</span></div>
          <div class="meta-row"><span class="meta-label">τ</span><span class="meta-value">${esc(f.tau)}</span></div>
          <div class="meta-row"><span class="meta-label">r<sub>init</sub></span><span class="meta-value">${esc(f.rinit)}</span></div>
          <div class="meta-row"><span class="meta-label">T</span><span class="meta-value">${esc(f.T)}</span></div>
          <div class="meta-row"><span class="meta-label">count</span><span class="meta-value">${parseInt(f.count)}</span></div>
        </div>
      </article>
    `;
  }

  /**
   * Wraps the image in a try-real-image + SVG-fallback strategy. The
   * <img> onerror handler swaps in the procedural SVG so the gallery
   * still looks meaningful when images are missing.
   */
  function imageOrFallback(f) {
    const src = IMAGE_BASE_PATH + encodeURIComponent(f.raw);
    const svg = particleConstellationSVG(f.NNum, f.dNum, { full: true });
    return `
      <img src="${esc(src)}"
           alt="Simulation d=${parseInt(f.d)} N=${parseInt(f.N)}"
           loading="lazy"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
      <div class="fallback-wrap" style="display:none; width:100%; height:100%;">${svg}</div>
    `;
  }

  /**
   * Procedural SVG that visualises a simulation signature. N points
   * arranged in a ring / layered pattern, with orbital rings for d.
   * Purely decorative but keeps the UI informative when PNGs are missing.
   */
  function particleConstellationSVG(N, d, opts = {}) {
    const full = !!opts.full;
    const size = full ? 100 : 52;     // viewBox
    const cx = size / 2, cy = size / 2;
    const Nclamp = Math.max(3, Math.min(64, N || 8));
    const dclamp = Math.max(1, Math.min(8, d || 3));

    // Orbital rings for dimension
    let rings = '';
    for (let i = 0; i < dclamp; i++) {
      const r = (size * 0.15) + i * (size * 0.12);
      rings += `<circle cx="${cx}" cy="${cy}" r="${r}"
                 fill="none"
                 stroke="rgba(0,229,255,${0.15 + i * 0.05})"
                 stroke-width="0.5"
                 stroke-dasharray="2 3"/>`;
    }

    // Particle dots distributed in phyllotaxis for organic look
    let dots = '';
    const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
    const rMax = size * 0.42;
    for (let i = 0; i < Nclamp; i++) {
      const t = (i + 0.5) / Nclamp;
      const r = Math.sqrt(t) * rMax;
      const theta = i * phi + (dclamp * 0.5);
      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r;
      const op = 0.5 + 0.5 * (1 - t);
      dots += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(full ? 1.2 : 0.9)}" fill="rgb(179,136,255)" opacity="${op.toFixed(2)}"/>`;
    }
    // Central marker
    dots += `<circle cx="${cx}" cy="${cy}" r="${full ? 1.8 : 1.2}" fill="#fff" opacity="0.95"/>`;

    const cls = full ? 'fallback' : 'nav-card-viz';
    return `<svg class="${cls}" viewBox="0 0 ${size} ${size}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      ${rings}${dots}
    </svg>`;
  }

  /* ================================================================
     12. COMPARE TRAY
     ================================================================ */

  function renderCompareTray() {
    const tray    = $('#compare-tray');
    const thumbs  = $('#compare-thumbs');
    const countEl = $('#compare-count');
    if (!tray) return;

    const selected = Array.from(state.comparison)
      .map((raw) => state.files.find((f) => f.raw === raw))
      .filter(Boolean);

    countEl.textContent = String(selected.length).padStart(2, '0');

    if (selected.length === 0) {
      tray.classList.remove('visible');
      thumbs.innerHTML = '';
      return;
    }
    tray.classList.add('visible');

    thumbs.innerHTML = selected.map((f) => `
      <div class="compare-thumb" data-raw="${esc(f.raw)}" title="N=${parseInt(f.N)} d=${parseInt(f.d)}">
        ${imageOrFallback(f)}
        <span class="tag-n">N${parseInt(f.N)} · d${parseInt(f.d)}</span>
        <button class="remove" data-toggle-compare="${esc(f.raw)}" aria-label="Remove">✕</button>
      </div>
    `).join('');
  }

  /* ================================================================
     13. COMPARISON MODAL
     ================================================================ */

  function openCompareModal() {
    const modal = $('#compare-modal');
    const grid  = $('#compare-grid');
    if (!modal || !grid) return;

    const items = Array.from(state.comparison)
      .map((raw) => state.files.find((f) => f.raw === raw))
      .filter(Boolean);

    if (!items.length) return;

    grid.innerHTML = items.map((f) => `
      <div class="compare-tile" data-raw="${esc(f.raw)}">
        <div class="thumb" data-open-lightbox="${esc(f.raw)}">${imageOrFallback(f)}</div>
        <div class="meta">
          <div class="meta-row highlight"><span class="meta-label">N</span><span class="meta-value">${parseInt(f.N)}</span></div>
          <div class="meta-row highlight"><span class="meta-label">d</span><span class="meta-value">${parseInt(f.d)}</span></div>
          <div class="meta-row"><span class="meta-label">τ</span><span class="meta-value">${esc(f.tau)}</span></div>
          <div class="meta-row"><span class="meta-label">r<sub>init</sub></span><span class="meta-value">${esc(f.rinit)}</span></div>
          <div class="meta-row"><span class="meta-label">T</span><span class="meta-value">${esc(f.T)}</span></div>
          <div class="meta-row"><span class="meta-label">count</span><span class="meta-value">${parseInt(f.count)}</span></div>
        </div>
      </div>`).join('');

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeCompareModal() {
    $('#compare-modal').hidden = true;
    document.body.style.overflow = '';
  }

  /* ================================================================
     14. LIGHTBOX (with zoom + pan)
     ================================================================ */

  const lightbox = {
    open: false,
    filesInGroup: [],
    index: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    dragStart: { x: 0, y: 0, panX: 0, panY: 0 },
  };

  /**
   * Open the lightbox for a filename. The navigation group is the
   * currently-sorted + filtered file list so prev/next feels natural.
   */
  function openLightbox(rawFilename) {
    const filesInView = sortFiles(getFilteredFiles());
    const group = filesInView.length ? filesInView : state.files;
    const idx = group.findIndex((f) => f.raw === rawFilename);
    if (idx < 0) return;

    lightbox.open = true;
    lightbox.filesInGroup = group;
    lightbox.index = idx;
    resetLightboxTransform();

    const modal = $('#lightbox');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    renderLightbox();
  }

  function closeLightbox() {
    lightbox.open = false;
    $('#lightbox').hidden = true;
    document.body.style.overflow = '';
  }

  function renderLightbox() {
    const f = lightbox.filesInGroup[lightbox.index];
    if (!f) return closeLightbox();

    const img    = $('#lightbox-image');
    const canvas = $('#lightbox-canvas');
    const title  = $('#lightbox-title');
    const footer = $('#lightbox-footer');

    // Swap to fallback if image fails
    const src = IMAGE_BASE_PATH + encodeURIComponent(f.raw);
    img.style.display = '';
    img.src = src;
    // Remove any prior fallback
    const oldFallback = canvas.querySelector('.fallback-wrap');
    if (oldFallback) oldFallback.remove();

    img.onerror = () => {
      img.style.display = 'none';
      const wrap = document.createElement('div');
      wrap.className = 'fallback-wrap';
      wrap.style.width = '80%';
      wrap.style.maxWidth = '600px';
      wrap.innerHTML = particleConstellationSVG(f.NNum, f.dNum, { full: true });
      canvas.appendChild(wrap);
    };

    title.textContent = `${f.raw}  [${lightbox.index + 1} / ${lightbox.filesInGroup.length}]`;

    footer.innerHTML = [
      ['N',      parseInt(f.N)],
      ['d',      parseInt(f.d)],
      ['τ',      f.tau],
      ['r_init', f.rinit],
      ['T',      f.T],
      ['count',  parseInt(f.count)],
    ].map(([k, v]) => `<span class="footer-chip"><b>${esc(k)}</b><span>${esc(v)}</span></span>`).join('');

    // Reflect compare state on toggle button
    const btn = $('#compare-toggle-btn');
    btn.classList.toggle('active', state.comparison.has(f.raw));
    btn.title = state.comparison.has(f.raw) ? 'Remove from comparison' : 'Add to comparison';

    applyLightboxTransform();
  }

  function applyLightboxTransform() {
    const el = $('#lightbox-image');
    const wrap = $('#lightbox-canvas .fallback-wrap');
    const t = `translate(${lightbox.panX}px, ${lightbox.panY}px) scale(${lightbox.zoom})`;
    if (el) el.style.transform = t;
    if (wrap) wrap.style.transform = t;
    $('#zoom-readout').textContent = Math.round(lightbox.zoom * 100) + '%';
  }

  function resetLightboxTransform() {
    lightbox.zoom = 1;
    lightbox.panX = 0;
    lightbox.panY = 0;
    applyLightboxTransform();
  }

  function lightboxZoom(delta, center) {
    const prev = lightbox.zoom;
    const next = Math.max(0.25, Math.min(6, prev * delta));
    // Zoom around cursor position relative to canvas center
    if (center) {
      const canvas = $('#lightbox-canvas');
      const rect   = canvas.getBoundingClientRect();
      const cx = center.x - rect.left - rect.width  / 2;
      const cy = center.y - rect.top  - rect.height / 2;
      const ratio = next / prev;
      lightbox.panX = cx - (cx - lightbox.panX) * ratio;
      lightbox.panY = cy - (cy - lightbox.panY) * ratio;
    }
    lightbox.zoom = next;
    applyLightboxTransform();
  }

  function lightboxNext(step) {
    lightbox.index = (lightbox.index + step + lightbox.filesInGroup.length) % lightbox.filesInGroup.length;
    resetLightboxTransform();
    renderLightbox();
  }

  /* ================================================================
     15. EVENT WIRING
     ================================================================ */

  function wireEvents() {
    // Delegated click handler for the whole document
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      // Filter chip
      const chip = t.closest('.chip[data-filter]');
      if (chip) {
        toggleFilter(chip.dataset.filter, chip.dataset.value);
        return;
      }

      // Sort chip
      const sortBtn = t.closest('#sort-chips .chip');
      if (sortBtn) {
        setState({ sort: sortBtn.dataset.sort });
        return;
      }

      // Clear one filter
      const clr = t.closest('.clear-btn');
      if (clr) { clearFilter(clr.dataset.clear); return; }

      // Clear all
      if (t.closest('#clear-all-btn')) { clearAllFilters(); return; }
      if (t.id === 'reset-from-empty') { clearAllFilters(); return; }

      // N selection card
      const nCard = t.closest('[data-select-n]');
      if (nCard) {
        state.filters.N.clear();
        state.filters.N.add(nCard.dataset.selectN);
        renderAll();
        return;
      }

      // d selection card
      const dCard = t.closest('[data-select-d]');
      if (dCard) {
        state.filters.d.clear();
        state.filters.d.add(dCard.dataset.selectD);
        renderAll();
        return;
      }

      // Breadcrumb root -> clear drill-down filters
      if (t.closest('[data-crumb="root"]')) {
        state.filters.N.clear();
        state.filters.d.clear();
        renderAll();
        return;
      }

      // Toggle compare (from gallery card or tray)
      const cmp = t.closest('[data-toggle-compare]');
      if (cmp) {
        e.stopPropagation();
        const raw = cmp.dataset.toggleCompare;
        if (state.comparison.has(raw)) state.comparison.delete(raw);
        else state.comparison.add(raw);
        renderAll();
        // Also refresh lightbox button if open
        if (lightbox.open) renderLightbox();
        return;
      }

      // Open lightbox
      const open = t.closest('[data-open-lightbox]');
      if (open) {
        openLightbox(open.dataset.openLightbox);
        return;
      }

      // Close lightbox / compare
      if (t.closest('[data-close-lightbox]')) { closeLightbox(); return; }
      if (t.closest('[data-close-compare]'))  { closeCompareModal(); return; }

      // Lightbox controls
      if (t.closest('#zoom-in-btn'))    { lightboxZoom(1.25); return; }
      if (t.closest('#zoom-out-btn'))   { lightboxZoom(0.8);  return; }
      if (t.closest('#zoom-reset-btn')) { resetLightboxTransform(); return; }
      if (t.closest('#lightbox-prev'))  { lightboxNext(-1); return; }
      if (t.closest('#lightbox-next'))  { lightboxNext(1);  return; }
      if (t.closest('#compare-toggle-btn')) {
        const f = lightbox.filesInGroup[lightbox.index];
        if (!f) return;
        if (state.comparison.has(f.raw)) state.comparison.delete(f.raw);
        else state.comparison.add(f.raw);
        renderAll();
        renderLightbox();
        return;
      }

      // Compare tray actions
      if (t.closest('#open-compare-btn'))  { openCompareModal(); return; }
      if (t.closest('#clear-compare-btn')) { state.comparison.clear(); renderAll(); return; }

      // Filter panel toggle (mobile)
      if (t.closest('#toggle-filters')) {
        $('#filter-panel').classList.toggle('open');
        return;
      }
    });

    // Keyboard nav
    document.addEventListener('keydown', (e) => {
      if (lightbox.open) {
        if (e.key === 'Escape')     { closeLightbox(); e.preventDefault(); }
        if (e.key === 'ArrowLeft')  { lightboxNext(-1); e.preventDefault(); }
        if (e.key === 'ArrowRight') { lightboxNext(1);  e.preventDefault(); }
        if (e.key === '+' || e.key === '=') { lightboxZoom(1.25); e.preventDefault(); }
        if (e.key === '-' || e.key === '_') { lightboxZoom(0.8);  e.preventDefault(); }
        if (e.key === '0')          { resetLightboxTransform(); e.preventDefault(); }
      } else if (!$('#compare-modal').hidden && e.key === 'Escape') {
        closeCompareModal();
      }
    });

    // Lightbox zoom/pan via wheel & pointer
    const canvas = $('#lightbox-canvas');

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      lightboxZoom(factor, { x: e.clientX, y: e.clientY });
    }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
      lightbox.dragging = true;
      lightbox.dragStart = {
        x: e.clientX,
        y: e.clientY,
        panX: lightbox.panX,
        panY: lightbox.panY
      };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!lightbox.dragging) return;
      lightbox.panX = lightbox.dragStart.panX + (e.clientX - lightbox.dragStart.x);
      lightbox.panY = lightbox.dragStart.panY + (e.clientY - lightbox.dragStart.y);
      applyLightboxTransform();
    });
    const endDrag = (e) => {
      lightbox.dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // Pinch zoom (two-finger) for touch devices
    let pinchDistance = 0;
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pinchDistance = touchDist(e.touches);
      }
    });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinchDistance > 0) {
        e.preventDefault();
        const d = touchDist(e.touches);
        const factor = d / pinchDistance;
        pinchDistance = d;
        lightboxZoom(factor);
      }
    }, { passive: false });
    function touchDist(touches) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    }
  }

  /* ================================================================
     16. CANVAS EFFECTS
        - Nebula backdrop (soft, slow-drifting gradients)
        - Starfield (twinkle + cursor reactivity + black hole)
        - Cursor trail
        - Comet streaks (DOM-animated, CSS)
        - Constellation easter egg
     ================================================================ */

  function setupNebula() {
    const c = document.getElementById('nebula-canvas');
    const ctx = c.getContext('2d');

    let clouds = [];
    function resize() {
      c.width  = window.innerWidth  * devicePixelRatio;
      c.height = window.innerHeight * devicePixelRatio;
      c.style.width  = '100%';
      c.style.height = '100%';
      clouds = [
        { x: c.width * 0.2, y: c.height * 0.25, r: c.height * 0.55, color: 'rgba(0, 60, 120, 0.35)',  vx: 0.00004, vy: 0.00002 },
        { x: c.width * 0.8, y: c.height * 0.6,  r: c.height * 0.65, color: 'rgba(70, 20, 130, 0.28)', vx: -0.00003, vy: 0.00001 },
        { x: c.width * 0.5, y: c.height * 1.0,  r: c.height * 0.8,  color: 'rgba(10, 30, 80, 0.35)',  vx: 0.00002, vy: -0.00001 },
      ];
      paint();
    }
    function paint() {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#04050c';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = 'lighter';
      for (const cl of clouds) {
        const g = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.r);
        g.addColorStop(0, cl.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.width, c.height);
      }
    }
    // Animate very slowly -- 1fps is enough, and saves CPU
    setInterval(() => {
      for (const cl of clouds) {
        cl.x += cl.vx * c.width;
        cl.y += cl.vy * c.height;
      }
      paint();
    }, 1000);

    window.addEventListener('resize', resize);
    resize();
  }

  function setupStarfield() {
    const c = document.getElementById('star-canvas');
    const ctx = c.getContext('2d');

    // Cursor state (in CSS pixels -- we scale when drawing)
    const cursor = { x: -9999, y: -9999, inside: false, blackhole: false };

    // Stars
    let stars = [];

    function resize() {
      const dpr = devicePixelRatio || 1;
      c.width  = window.innerWidth  * dpr;
      c.height = window.innerHeight * dpr;
      c.style.width  = '100%';
      c.style.height = '100%';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const area = window.innerWidth * window.innerHeight;
      const count = Math.min(520, Math.max(160, Math.round(area / 3800)));
      stars = Array.from({ length: count }, () => makeStar());
    }

    function makeStar() {
      return {
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        ox: 0, oy: 0,         // offset for cursor distortion
        r: Math.random() * 1.2 + 0.2,
        base: 0.25 + Math.random() * 0.75,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 1.8,
        z: Math.random(),     // depth for parallax
        color: Math.random() < 0.08 ? '#b388ff' : '#ffffff',
      };
    }

    let lastT = performance.now();
    function frame(t) {
      const dt = (t - lastT) / 1000;
      lastT = t;
      ctx.clearRect(0, 0, c.width, c.height);

      for (const s of stars) {
        // Twinkle
        const tw = 0.75 + 0.25 * Math.sin(t / 600 * s.speed + s.phase);

        // Cursor distortion -- gentle gravitational pull / push
        if (cursor.inside) {
          const dx = cursor.x - s.x;
          const dy = cursor.y - s.y;
          const dist2 = dx * dx + dy * dy;
          const reach = cursor.blackhole ? 360 * 360 : 140 * 140;
          if (dist2 < reach && dist2 > 4) {
            const dist = Math.sqrt(dist2);
            const pull = cursor.blackhole
              ? Math.min(1, 160 / dist) * 40
              : Math.min(1, 60 / dist) * 6;
            s.ox += (dx / dist) * pull * dt * (cursor.blackhole ? 1 : 0.5);
            s.oy += (dy / dist) * pull * dt * (cursor.blackhole ? 1 : 0.5);
          }
        }
        // Spring back
        s.ox *= 0.9;
        s.oy *= 0.9;

        // Parallax drift
        const px = s.x + s.ox + (s.z - 0.5) * 0.2;
        const py = s.y + s.oy + (s.z - 0.5) * 0.2;

        const alpha = s.base * tw * (cursor.blackhole ? 0.6 : 1);
        ctx.beginPath();
        ctx.arc(px, py, s.r * (cursor.blackhole ? 0.7 : 1), 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(s.color, alpha);
        ctx.fill();

        // Wider star bloom for brighter ones
        if (s.r > 0.9) {
          ctx.beginPath();
          ctx.arc(px, py, s.r * 3, 0, Math.PI * 2);
          ctx.fillStyle = withAlpha(s.color, alpha * 0.18);
          ctx.fill();
        }
      }

      // Black hole visual: dark disk + accretion ring
      if (cursor.blackhole && cursor.inside) {
        const grad = ctx.createRadialGradient(cursor.x, cursor.y, 0, cursor.x, cursor.y, 90);
        grad.addColorStop(0,   'rgba(0,0,0,1)');
        grad.addColorStop(0.55,'rgba(0,0,0,0.9)');
        grad.addColorStop(0.7, 'rgba(255,120,0,0.35)');
        grad.addColorStop(0.85,'rgba(179,136,255,0.5)');
        grad.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cursor.x - 100, cursor.y - 100, 200, 200);
      }

      requestAnimationFrame(frame);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', (e) => {
      cursor.x = e.clientX;
      cursor.y = e.clientY;
      cursor.inside = true;
    });
    window.addEventListener('mouseleave', () => {
      cursor.inside = false;
    });

    // Black hole easter egg: hover the period in STELLAR.
    const dot = document.querySelector('[data-blackhole="true"]');
    if (dot) {
      dot.addEventListener('mouseenter', () => { cursor.blackhole = true; });
      dot.addEventListener('mouseleave', () => { cursor.blackhole = false; });
    }

    resize();
    requestAnimationFrame(frame);
  }

  function withAlpha(hex, a) {
    if (hex.startsWith('#') && hex.length === 7) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    return hex;
  }

  function setupCursor() {
    // Skip on touch devices
    if (matchMedia('(hover: none)').matches) return;

    const c = document.getElementById('cursor-canvas');
    const ctx = c.getContext('2d');
    const trail = [];
    const cursor = { x: -9999, y: -9999, tx: -9999, ty: -9999 };

    function resize() {
      const dpr = devicePixelRatio || 1;
      c.width  = window.innerWidth  * dpr;
      c.height = window.innerHeight * dpr;
      c.style.width  = '100%';
      c.style.height = '100%';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    let last = performance.now();
    function frame(t) {
      const dt = Math.min(40, t - last);
      last = t;

      // Ease cursor position
      cursor.x += (cursor.tx - cursor.x) * 0.18;
      cursor.y += (cursor.ty - cursor.y) * 0.18;

      // Emit trail particle
      if (isFinite(cursor.x)) {
        trail.push({
          x: cursor.x + (Math.random() - 0.5) * 4,
          y: cursor.y + (Math.random() - 0.5) * 4,
          life: 1,
          r: 0.8 + Math.random() * 1.4,
        });
      }

      ctx.clearRect(0, 0, c.width, c.height);

      for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i];
        p.life -= dt / 480;
        if (p.life <= 0) { trail.splice(i, 1); continue; }
        const a = p.life * 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 229, 255, ${a})`;
        ctx.fill();
      }

      // Cursor glyph: outer ring + inner dot
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, 12, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#00e5ff';
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;

      requestAnimationFrame(frame);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', (e) => {
      cursor.tx = e.clientX;
      cursor.ty = e.clientY;
      if (cursor.x < -1000) {
        cursor.x = cursor.tx;
        cursor.y = cursor.ty;
      }
    });

    resize();
    requestAnimationFrame(frame);
  }

  /* Comet streaks -- a random diagonal streak every 12–28 seconds */
  function setupComets() {
    const el = document.getElementById('comet');
    if (!el) return;

    function fire() {
      const W = window.innerWidth, H = window.innerHeight;
      const fromTop = Math.random() < 0.5;
      const sx = Math.random() * W;
      const sy = fromTop ? -20 : Math.random() * H * 0.4;
      const angle = -20 - Math.random() * 30; // degrees, down-right streak
      const ex = sx + Math.cos(angle * Math.PI / 180) * (W * 0.9);
      const ey = sy + Math.sin(angle * Math.PI / 180) * (H * 0.9) + H * 0.4;

      el.style.setProperty('--sx', `${sx}px`);
      el.style.setProperty('--sy', `${sy}px`);
      el.style.setProperty('--ex', `${ex}px`);
      el.style.setProperty('--ey', `${ey}px`);
      el.style.setProperty('--rot', `${angle}deg`);
      el.classList.remove('active');
      // reflow to restart animation
      void el.offsetWidth;
      el.classList.add('active');

      setTimeout(fire, 12000 + Math.random() * 16000);
    }

    setTimeout(fire, 4000 + Math.random() * 3000);
  }

  /* Hidden constellation easter egg */
  function setupConstellation() {
    const svg = document.getElementById('constellation-svg');
    if (!svg) return;

    // Ursa Minor-ish points
    const points = [
      { x: 30,  y: 160, label: 'α' },
      { x: 80,  y: 130 },
      { x: 130, y: 110 },
      { x: 190, y: 90  },
      { x: 230, y: 60  },
      { x: 260, y: 100 },
      { x: 240, y: 135, label: 'β' },
    ];
    const lines = [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]
    ];

    let html = '<g>';
    for (const [a, b] of lines) {
      html += `<line class="c-line" x1="${points[a].x}" y1="${points[a].y}" x2="${points[b].x}" y2="${points[b].y}"/>`;
    }
    for (const p of points) {
      html += `<circle class="c-star" cx="${p.x}" cy="${p.y}" r="${1.4 + Math.random() * 0.8}"/>`;
      if (p.label) html += `<text class="c-label" x="${p.x + 4}" y="${p.y - 4}">${p.label}</text>`;
    }
    html += `<text class="c-label" x="20" y="185">URSA — stellar reference grid</text>`;
    html += '</g>';
    svg.innerHTML = html;

    // Position randomly in a corner region, appear briefly every ~40s
    function reveal() {
      const corners = [
        { top: 'auto', bottom: '60px', left: '24px',  right: 'auto' },
        { top: '90px', bottom: 'auto', left: 'auto',  right: '24px' },
      ];
      const pick = corners[Math.floor(Math.random() * corners.length)];
      Object.assign(svg.style, pick);
      svg.classList.add('visible');
      setTimeout(() => svg.classList.remove('visible'), 6000);
      setTimeout(reveal, 30000 + Math.random() * 20000);
    }
    setTimeout(reveal, 12000);
  }

  /* ================================================================
     17. BOOT
     ================================================================ */

  function boot() {
    setupNebula();
    setupStarfield();
    setupCursor();
    setupComets();
    setupConstellation();
    wireEvents();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
