"use strict";


/* ---------- 1. Konfigurasi ---------- */
const API_URL = "https://api-web.dnccudinus.org/api/mobil";
const FAV_KEY = "maison:favorit";
const MAX_COMPARE = 3;
const BUNGA_FLAT = 0.05; // asumsi bunga flat 5% per tahun untuk simulasi

const FALLBACK_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 600'>" +
      "<rect width='800' height='600' fill='#EFE5D8'/>" +
      "<g fill='none' stroke='#BD5210' stroke-width='14' stroke-linecap='round' stroke-linejoin='round'>" +
      "<path d='M170 380h460l-40-110a40 40 0 0 0-38-26H248a40 40 0 0 0-38 26z'/>" +
      "<circle cx='280' cy='400' r='34'/><circle cx='520' cy='400' r='34'/></g>" +
      "<text x='400' y='500' text-anchor='middle' font-family='sans-serif' font-size='28' fill='#6B6258'>Foto tidak tersedia</text>" +
      "</svg>"
  );

const ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3M7 8h4"/>',
  heart: '<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
  compare: '<path d="M7 4v16M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  car: '<path d="M4 16V12l2-5h12l2 5v4M3 16h18M7 19v-3M17 19v-3"/><circle cx="7.5" cy="13" r=".6"/><circle cx="16.5" cy="13" r=".6"/>',
};

/* ---------- 2. Utilitas ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const rupiah = (n) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n));
const juta = (n) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n / 1e6) + " jt";
const uniq = (arr) => [...new Set(arr)];

/** Pembuat elemen DOM. Teks selalu lewat textContent/text node (aman dari XSS). */
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key.startsWith("aria-")) {
      node.setAttribute(key, String(val));
    } else if (val == null || val === false) {
      continue;
    } else if (key === "class") {
      node.className = val;
    } else if (key === "text") {
      node.textContent = val;
    } else if (key === "dataset") {
      Object.assign(node.dataset, val);
    } else if (key.startsWith("on")) {
      node.addEventListener(key.slice(2), val);
    } else {
      node.setAttribute(key, val === true ? "" : val);
    }
  }
  kids.flat().forEach((kid) => {
    if (kid == null || kid === false) return;
    node.append(kid.nodeType ? kid : document.createTextNode(kid));
  });
  return node;
}

/** Ikon SVG inline (konstanta internal, bukan data dari API). */
function icon(name, size = 18) {
  const span = document.createElement("span");
  span.className = "ico";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML =
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
  return span;
}

function imgFallback(e) {
  const img = e.currentTarget;
  img.removeEventListener("error", imgFallback);
  img.src = FALLBACK_IMG;
}

function debounce(fn, ms = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function toast(message) {
  const box = $("#toasts");
  const item = el("p", { class: "toast", text: message });
  box.append(item);
  setTimeout(() => {
    item.classList.add("out");
    item.addEventListener("animationend", () => item.remove(), { once: true });
  }, 2800);
}

/* ---------- 3. State ---------- */
const state = {
  cars: [],
  byId: new Map(),
  q: "",
  brand: "all",
  fuel: "all",
  trans: "all",
  priceMin: 0,
  priceMax: 0,
  maxPrice: Infinity,
  onlyAvail: false,
  favOnly: false,
  sort: "terbaru",
  view: "grid",
  favorites: loadFavs(),
  compare: [],
  featured: [],
  featIdx: 0,
  timer: null,
};

function loadFavs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || []);
  } catch {
    return new Set();
  }
}
function saveFavs() {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...state.favorites]));
  } catch {
    /* penyimpanan tidak tersedia, abaikan */
  }
}

/* ---------- 4. Elemen yang sering dipakai ---------- */
const grid = $("#grid");
const stateBox = $("#stateBox");
const resultInfo = $("#resultInfo");
const stage = $("#stage");
const detailDialog = $("#detailDialog");
const compareDialog = $("#compareDialog");

/* ---------- 5. Ambil data dari API (fetch) ---------- */
function normalizeCar(c) {
  return {
    id: Number(c.id),
    nama: String(c.nama ?? "Tanpa nama"),
    brand: String(c.brand ?? "Lainnya"),
    harga: Number(c.harga) || 0,
    tahun: Number(c.tahun) || 0,
    transmisi: String(c.transmisi ?? "-"),
    bahan_bakar: String(c.bahan_bakar ?? "-"),
    status: String(c.status ?? "").toLowerCase(),
    available: String(c.status ?? "").toLowerCase() === "tersedia",
    foto: c.foto || FALLBACK_IMG,
  };
}

async function loadCars() {
  stateBox.replaceChildren();
  showSkeleton();
  resultInfo.textContent = "Memuat data mobil…";

  try {
    const res = await fetch(API_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Server merespons ${res.status}`);

    const json = await res.json();
    const list = Array.isArray(json) ? json : json.data;
    if (!Array.isArray(list)) throw new Error("Format data tidak dikenali");

    state.cars = list.map(normalizeCar);
    state.byId = new Map(state.cars.map((c) => [c.id, c]));
    state.favorites = new Set([...state.favorites].filter((id) => state.byId.has(id)));

    onDataReady();
  } catch (err) {
    console.error("Gagal mengambil data mobil:", err);
    showError(err);
  }
}

function onDataReady() {
  setupFilters();
  setupFeatured();
  fillStats();
  render();
  renderCompareBar();
  updateFavCount();
}

/* ---------- 6. Filter, urutan, render katalog ---------- */
function getFiltered() {
  const q = state.q.trim().toLowerCase();

  const list = state.cars.filter((c) => {
    if (q && !`${c.nama} ${c.brand} ${c.tahun}`.toLowerCase().includes(q)) return false;
    if (state.brand !== "all" && c.brand !== state.brand) return false;
    if (state.fuel !== "all" && c.bahan_bakar !== state.fuel) return false;
    if (state.trans !== "all" && c.transmisi !== state.trans) return false;
    if (c.harga > state.maxPrice) return false;
    if (state.onlyAvail && !c.available) return false;
    if (state.favOnly && !state.favorites.has(c.id)) return false;
    return true;
  });

  const sorters = {
    terbaru: (a, b) => b.tahun - a.tahun || b.id - a.id,
    murah: (a, b) => a.harga - b.harga,
    mahal: (a, b) => b.harga - a.harga,
    nama: (a, b) => a.nama.localeCompare(b.nama, "id"),
  };
  return list.sort(sorters[state.sort] || sorters.terbaru);
}

function render() {
  const list = getFiltered();

  grid.className = "grid" + (state.view === "list" ? " is-list" : "");
  grid.replaceChildren(...list.map(carCard));
  grid.setAttribute("aria-busy", "false");
  stateBox.replaceChildren();

  resultInfo.textContent = list.length
    ? `Menampilkan ${list.length} dari ${state.cars.length} mobil`
    : "Tidak ada hasil";

  if (!list.length) showEmpty();
  updateChips();
  syncButtons();
  observeReveal($$(".card.reveal", grid));
}

function spec(iconName, text) {
  return el("li", {}, icon(iconName, 16), text);
}

function carCard(car, index = 0) {
  const detailLabel = `Lihat detail ${car.nama}`;

  return el(
    "article",
    { class: `card reveal${car.available ? "" : " is-sold"}`, style: `--i:${Math.min(index, 12)}` },
    el(
      "div",
      { class: "card-media" },
      el(
        "button",
        { class: "card-media-btn", type: "button", "aria-label": detailLabel, onclick: () => openDetail(car.id) },
        el("img", {
          src: car.foto,
          alt: `${car.nama} tahun ${car.tahun}`,
          loading: "lazy",
          onerror: imgFallback,
        })
      ),
      el("span", { class: `badge ${car.available ? "ok" : "sold"}`, text: car.available ? "Tersedia" : "Terjual" }),
      el(
        "button",
        {
          class: "icon-btn",
          type: "button",
          dataset: { fav: car.id },
          "aria-pressed": false,
          "aria-label": "Simpan ke favorit",
          title: "Favorit",
          onclick: () => toggleFav(car.id),
        },
        icon("heart", 20)
      )
    ),
    el(
      "div",
      { class: "card-body" },
      el("p", { class: "card-brand", text: car.brand }),
      el("h3", { class: "card-title", text: car.nama }),
      el("ul", { class: "specs" }, spec("calendar", car.tahun), spec("gear", car.transmisi), spec("fuel", car.bahan_bakar)),
      el(
        "div",
        { class: "card-foot" },
        el("p", { class: "price", text: rupiah(car.harga) }),
        el(
          "div",
          { class: "card-actions" },
          el("button", { class: "btn btn-dark btn-sm", type: "button", text: "Lihat detail", "aria-label": detailLabel, onclick: () => openDetail(car.id) }),
          el(
            "button",
            { class: "btn btn-ghost btn-sm", type: "button", dataset: { cmp: car.id }, "aria-pressed": false, onclick: () => toggleCompare(car.id) },
            icon("compare", 16),
            el("span", { class: "label", text: "Bandingkan" })
          )
        )
      )
    )
  );
}

function showSkeleton() {
  grid.setAttribute("aria-busy", "true");
  grid.className = "grid";
  grid.replaceChildren(
    ...Array.from({ length: 6 }, () =>
      el(
        "div",
        { class: "card skeleton", "aria-hidden": true },
        el("div", { class: "sk sk-media" }),
        el("div", { class: "card-body" }, el("div", { class: "sk sk-line short" }), el("div", { class: "sk sk-line mid" }), el("div", { class: "sk sk-line" }))
      )
    )
  );
}

function showEmpty() {
  const noFavs = state.favOnly && state.favorites.size === 0;
  stateBox.replaceChildren(
    el(
      "div",
      { class: "state" },
      icon("car", 36),
      el("h3", { text: noFavs ? "Belum ada mobil favorit" : "Belum ada mobil yang cocok" }),
      el("p", {
        text: noFavs
          ? "Tekan ikon hati pada kartu mobil untuk menyimpannya di sini."
          : "Ubah kata kunci atau longgarkan filter harga untuk melihat lebih banyak unit.",
      }),
      el("button", { class: "btn btn-primary", type: "button", text: "Atur ulang filter", onclick: resetFilters })
    )
  );
}

function showError(err) {
  grid.replaceChildren();
  grid.setAttribute("aria-busy", "false");
  resultInfo.textContent = "Data gagal dimuat";
  stateBox.replaceChildren(
    el(
      "div",
      { class: "state is-error", role: "alert" },
      icon("warn", 36),
      el("h3", { text: "Data mobil gagal dimuat" }),
      el("p", { text: `Periksa koneksi internet Anda, lalu coba lagi. (${err.message})` }),
      el("button", { class: "btn btn-primary", type: "button", text: "Coba lagi", onclick: loadCars })
    )
  );
  stage.replaceChildren(
    el("div", { class: "stage-info" }, el("p", { class: "stage-name", text: "Unit pilihan belum bisa ditampilkan" }))
  );
}

/* ---------- 7. Kontrol filter ---------- */
function chip(value, label, count) {
  return el(
    "button",
    {
      class: "chip",
      type: "button",
      dataset: { brand: value },
      "aria-pressed": state.brand === value,
      onclick: () => {
        state.brand = value;
        render();
      },
    },
    label,
    el("span", { class: "chip-n", text: count })
  );
}

function updateChips() {
  $$(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.brand === state.brand)));
}

function fillSelect(select, values) {
  const first = select.options[0];
  select.replaceChildren(first, ...values.map((v) => el("option", { value: v, text: v })));
}

function setupFilters() {
  const brands = uniq(state.cars.map((c) => c.brand)).sort((a, b) => a.localeCompare(b, "id"));
  $("#brandChips").replaceChildren(
    chip("all", "Semua", state.cars.length),
    ...brands.map((b) => chip(b, b, state.cars.filter((c) => c.brand === b).length))
  );

  fillSelect($("#fuel"), uniq(state.cars.map((c) => c.bahan_bakar)).sort());
  fillSelect($("#trans"), uniq(state.cars.map((c) => c.transmisi)).sort());

  const prices = state.cars.map((c) => c.harga);
  const step = 25e6;
  state.priceMin = Math.floor(Math.min(...prices) / step) * step;
  state.priceMax = Math.ceil(Math.max(...prices) / step) * step;
  state.maxPrice = state.priceMax;

  const range = $("#price");
  range.min = state.priceMin;
  range.max = state.priceMax;
  range.step = 5e6;
  range.disabled = false;

  syncControls();
}

function syncControls() {
  $("#search").value = state.q;
  $("#heroInput").value = state.q;
  $("#fuel").value = state.fuel;
  $("#trans").value = state.trans;
  $("#sort").value = state.sort;
  $("#onlyAvail").checked = state.onlyAvail;
  $("#favOnly").setAttribute("aria-pressed", String(state.favOnly));
  $("#viewGrid").setAttribute("aria-pressed", String(state.view === "grid"));
  $("#viewList").setAttribute("aria-pressed", String(state.view === "list"));

  const range = $("#price");
  if (state.priceMax) {
    range.value = state.maxPrice === Infinity ? state.priceMax : state.maxPrice;
    $("#priceOut").textContent = "Rp " + juta(Number(range.value));
  }
}

function resetFilters() {
  Object.assign(state, {
    q: "",
    brand: "all",
    fuel: "all",
    trans: "all",
    maxPrice: state.priceMax || Infinity,
    onlyAvail: false,
    favOnly: false,
    sort: "terbaru",
  });
  syncControls();
  render();
}

function setFavOnly(on) {
  state.favOnly = on;
  syncControls();
  render();
}

function bindStaticEvents() {
  const onSearch = debounce((value) => {
    state.q = value;
    $("#heroInput").value = value;
    render();
  });
  $("#search").addEventListener("input", (e) => onSearch(e.target.value));

  $("#heroSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    state.q = $("#heroInput").value;
    $("#search").value = state.q;
    render();
    $("#katalog").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
  });

  $("#fuel").addEventListener("change", (e) => { state.fuel = e.target.value; render(); });
  $("#trans").addEventListener("change", (e) => { state.trans = e.target.value; render(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  $("#onlyAvail").addEventListener("change", (e) => { state.onlyAvail = e.target.checked; render(); });

  $("#price").addEventListener("input", (e) => {
    state.maxPrice = Number(e.target.value);
    $("#priceOut").textContent = "Rp " + juta(state.maxPrice);
    render();
  });

  $("#favOnly").addEventListener("click", () => setFavOnly(!state.favOnly));
  $("#reset").addEventListener("click", resetFilters);
  $("#viewGrid").addEventListener("click", () => { state.view = "grid"; syncControls(); render(); });
  $("#viewList").addEventListener("click", () => { state.view = "list"; syncControls(); render(); });

  $("#favPill").addEventListener("click", () => {
    setFavOnly(true);
    $("#katalog").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
  });

  // Header: bayangan saat scroll + menu mobile
  const header = $(".site-header");
  window.addEventListener("scroll", () => header.classList.toggle("scrolled", window.scrollY > 8), { passive: true });

  const burger = $("#burger");
  burger.addEventListener("click", () => {
    const open = header.classList.toggle("open");
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Tutup menu" : "Buka menu");
  });
  $$("#menu a").forEach((a) =>
    a.addEventListener("click", () => {
      header.classList.remove("open");
      burger.setAttribute("aria-expanded", "false");
    })
  );

  // Perbandingan & dialog
  $("#cmpOpen").addEventListener("click", openCompare);
  $("#cmpClear").addEventListener("click", () => {
    state.compare = [];
    syncButtons();
    renderCompareBar();
  });
  $("#compareClose").addEventListener("click", () => compareDialog.close());

  [detailDialog, compareDialog].forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    d.addEventListener("close", () => {
      if (!$$("dialog[open]").length) document.body.classList.remove("no-scroll");
    });
  });
}

/* ---------- 8. Favorit & perbandingan ---------- */
function updateFavCount() {
  $("#favCount").textContent = state.favorites.size;
}

function toggleFav(id) {
  const car = state.byId.get(id);
  if (!car) return;

  if (state.favorites.has(id)) {
    state.favorites.delete(id);
    toast(`${car.nama} dihapus dari favorit`);
  } else {
    state.favorites.add(id);
    toast(`${car.nama} disimpan ke favorit`);
  }
  saveFavs();
  updateFavCount();
  if (state.favOnly) render();
  else syncButtons();
}

function toggleCompare(id) {
  const i = state.compare.indexOf(id);
  if (i > -1) {
    state.compare.splice(i, 1);
  } else {
    if (state.compare.length >= MAX_COMPARE) {
      toast(`Maksimal ${MAX_COMPARE} mobil untuk dibandingkan`);
      return;
    }
    state.compare.push(id);
  }
  syncButtons();
  renderCompareBar();
}

/** Samakan status semua tombol favorit/bandingkan (kartu dan dialog). */
function syncButtons() {
  $$("[data-fav]").forEach((btn) => {
    const on = state.favorites.has(Number(btn.dataset.fav));
    btn.setAttribute("aria-pressed", String(on));
    const label = $(".label", btn);
    if (label) label.textContent = on ? "Tersimpan" : "Simpan ke favorit";
    else btn.setAttribute("aria-label", on ? "Hapus dari favorit" : "Simpan ke favorit");
  });

  $$("[data-cmp]").forEach((btn) => {
    const on = state.compare.includes(Number(btn.dataset.cmp));
    btn.setAttribute("aria-pressed", String(on));
    const label = $(".label", btn);
    if (label) label.textContent = on ? "Dibandingkan" : "Bandingkan";
  });
}

function renderCompareBar() {
  const n = state.compare.length;
  $("#cmpBar").hidden = n === 0;
  document.body.classList.toggle("has-cmp", n > 0);

  $("#cmpThumbs").replaceChildren(
    ...state.compare.map((id) => {
      const c = state.byId.get(id);
      return el(
        "button",
        { class: "cmp-thumb", type: "button", title: `Hapus ${c.nama}`, "aria-label": `Hapus ${c.nama} dari perbandingan`, onclick: () => toggleCompare(id) },
        el("img", { src: c.foto, alt: "", onerror: imgFallback }),
        icon("close", 16)
      );
    })
  );
  $("#cmpText").textContent = n < 2 ? "Pilih minimal 2 mobil" : `${n} mobil dipilih`;
  $("#cmpOpen").disabled = n < 2;
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  document.body.classList.add("no-scroll");
}

function openCompare() {
  if (state.compare.length < 2) {
    toast("Pilih minimal 2 mobil untuk dibandingkan");
    return;
  }
  renderCompareTable();
  openDialog(compareDialog);
}

function renderCompareTable() {
  const cars = state.compare.map((id) => state.byId.get(id));
  const minPrice = Math.min(...cars.map((c) => c.harga));
  const maxYear = Math.max(...cars.map((c) => c.tahun));

  const rows = [
    { label: "Harga", get: (c) => rupiah(c.harga), best: (c) => c.harga === minPrice, tag: "Termurah" },
    { label: "Tahun", get: (c) => String(c.tahun), best: (c) => c.tahun === maxYear, tag: "Terbaru" },
    { label: "Transmisi", get: (c) => c.transmisi },
    { label: "Bahan bakar", get: (c) => c.bahan_bakar },
    { label: "Status", get: (c) => (c.available ? "Tersedia" : "Terjual") },
  ];

  const hasDiff = (row) => row.best && new Set(cars.map(row.get)).size > 1;

  const table = el(
    "table",
    { class: "cmp-table" },
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        el("th", { scope: "col" }, el("span", { class: "visually-hidden", text: "Spesifikasi" })),
        ...cars.map((c) =>
          el(
            "th",
            { scope: "col" },
            el(
              "div",
              { class: "cmp-car" },
              el("img", { src: c.foto, alt: c.nama, onerror: imgFallback }),
              el("strong", { text: c.nama }),
              el("button", {
                type: "button",
                text: "Hapus",
                "aria-label": `Hapus ${c.nama} dari perbandingan`,
                onclick: () => {
                  toggleCompare(c.id);
                  if (state.compare.length < 2) compareDialog.close();
                  else renderCompareTable();
                },
              })
            )
          )
        )
      )
    ),
    el(
      "tbody",
      {},
      ...rows.map((row) =>
        el(
          "tr",
          {},
          el("th", { scope: "row", text: row.label }),
          ...cars.map((c) => {
            const isBest = hasDiff(row) && row.best(c);
            return el("td", { class: isBest ? "best" : "" }, row.get(c), isBest ? el("span", { class: "best-tag", text: row.tag }) : null);
          })
        )
      )
    )
  );

  $("#compareBody").replaceChildren(table);
}

/* ---------- 9. Dialog detail + simulasi cicilan ---------- */
function openDetail(id) {
  const car = state.byId.get(id);
  if (!car) return;

  // Kontrol simulasi
  const dp = el("input", { type: "range", id: "dp", min: "10", max: "50", step: "5", value: "20" });
  const tenor = el(
    "select",
    { id: "tenor" },
    ...[1, 2, 3, 4, 5, 6, 7].map((y) => el("option", { value: String(y), selected: y === 5, text: `${y} tahun` }))
  );
  const dpOut = el("output", { for: "dp" });
  const monthlyOut = el("p", { class: "sim-monthly" });
  const loanOut = el("span");

  const calc = () => {
    const pct = Number(dp.value);
    const years = Number(tenor.value);
    const dpAmount = (car.harga * pct) / 100;
    const loan = car.harga - dpAmount;
    const monthly = Math.round((loan * (1 + BUNGA_FLAT * years)) / (years * 12) / 1000) * 1000;
    dpOut.textContent = `${pct}% (${rupiah(dpAmount)})`;
    loanOut.textContent = rupiah(loan);
    monthlyOut.textContent = rupiah(monthly);
  };
  dp.addEventListener("input", calc);
  tenor.addEventListener("change", calc);
  calc();

  // Tombol aksi utama
  const primary = car.available
    ? el("button", {
        class: "btn btn-primary",
        type: "button",
        text: "Jadwalkan test drive",
        onclick: () => {
          detailDialog.close();
          toast(`Permintaan test drive ${car.nama} tercatat. Tim kami akan menghubungi Anda.`);
        },
      })
    : el("button", {
        class: "btn btn-primary",
        type: "button",
        text: `Lihat unit ${car.brand} yang tersedia`,
        onclick: () => {
          detailDialog.close();
          Object.assign(state, { brand: car.brand, onlyAvail: true, q: "", fuel: "all", trans: "all", favOnly: false, maxPrice: state.priceMax });
          syncControls();
          render();
          $("#katalog").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
        },
      });

  const specs = [
    ["Merek", car.brand],
    ["Tahun", String(car.tahun)],
    ["Transmisi", car.transmisi],
    ["Bahan bakar", car.bahan_bakar],
    ["Status", car.available ? "Tersedia" : "Terjual"],
  ];

  $("#detailBody").replaceChildren(
    el(
      "button",
      { class: "dialog-close", type: "button", "aria-label": "Tutup detail", onclick: () => detailDialog.close() },
      icon("close", 20)
    ),
    el(
      "div",
      { class: `detail-media${car.available ? "" : " is-sold"}` },
      el("img", { src: car.foto, alt: `${car.nama} tahun ${car.tahun}`, onerror: imgFallback }),
      el("span", { class: `badge ${car.available ? "ok" : "sold"}`, text: car.available ? "Tersedia" : "Terjual" })
    ),
    el(
      "div",
      { class: "detail-info" },
      el(
        "div",
        {},
        el("p", { class: "detail-brand", text: car.brand }),
        el("h2", { class: "detail-title", id: "detailTitle", text: car.nama }),
        el("p", { class: "detail-price", text: rupiah(car.harga) })
      ),
      el("dl", { class: "spec-grid" }, ...specs.map(([k, v]) => el("div", {}, el("dt", { text: k }), el("dd", { text: v })))),
      el(
        "div",
        { class: "sim" },
        el("h3", { text: "Simulasi cicilan" }),
        el("label", { for: "dp" }, "Uang muka", dpOut),
        dp,
        el("label", { for: "tenor" }, "Tenor"),
        tenor,
        el(
          "div",
          { class: "sim-result" },
          el("p", { class: "sim-label", text: "Cicilan per bulan" }),
          monthlyOut,
          el("small", { class: "sim-note" }, "Pokok pinjaman ", loanOut, ". Estimasi dengan bunga flat 5% per tahun, bukan penawaran resmi.")
        )
      ),
      el(
        "div",
        { class: "detail-actions" },
        primary,
        el(
          "button",
          { class: "btn btn-ghost", type: "button", dataset: { fav: car.id }, "aria-pressed": false, onclick: () => toggleFav(car.id) },
          icon("heart", 18),
          el("span", { class: "label", text: "Simpan ke favorit" })
        ),
        el(
          "button",
          { class: "btn btn-ghost", type: "button", dataset: { cmp: car.id }, "aria-pressed": false, onclick: () => toggleCompare(car.id) },
          icon("compare", 18),
          el("span", { class: "label", text: "Bandingkan" })
        )
      )
    )
  );

  syncButtons();
  openDialog(detailDialog);
  detailDialog.scrollTop = 0;
}

/* ---------- 10. Unit pilihan (hero) ---------- */
function setupFeatured() {
  const pool = state.cars
    .filter((c) => c.available)
    .sort((a, b) => b.tahun - a.tahun || b.harga - a.harga)
    .slice(0, 5);
  state.featured = pool.length ? pool : state.cars.slice(0, 5);
  if (!state.featured.length) return;

  const img = el("img", { class: "stage-img", alt: "" });
  img.addEventListener("error", () => {
    if (!img.dataset.fb) {
      img.dataset.fb = "1";
      img.src = FALLBACK_IMG;
    }
  });

  const dots = el(
    "div",
    { class: "dots" },
    ...state.featured.map((c, i) =>
      el("button", { class: "dot", type: "button", "aria-label": `Tampilkan ${c.nama}`, onclick: () => showFeatured(i, true) })
    )
  );

  stage.replaceChildren(
    img,
    el(
      "div",
      { class: "stage-nav" },
      dots,
      el(
        "div",
        { class: "arrows" },
        el("button", { class: "arrow-btn", type: "button", "aria-label": "Mobil sebelumnya", onclick: () => showFeatured(state.featIdx - 1, true) }, icon("left", 20)),
        el("button", { class: "arrow-btn", type: "button", "aria-label": "Mobil berikutnya", onclick: () => showFeatured(state.featIdx + 1, true) }, icon("right", 20))
      )
    ),
    el(
      "div",
      { class: "stage-info" },
      el("p", { class: "stage-tag", text: "Unit pilihan" }),
      el("h2", { class: "stage-name", id: "stageName" }),
      el("p", { class: "stage-price", id: "stagePrice" }),
      el("ul", { class: "chips-inline", id: "stageSpecs" }),
      el(
        "div",
        { class: "stage-actions" },
        el("button", { class: "btn btn-primary", type: "button", text: "Lihat detail", onclick: () => openDetail(state.featured[state.featIdx].id) }),
        el("button", { class: "btn btn-ghost-light", type: "button", text: "Lihat semua mobil", onclick: () => $("#katalog").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" }) })
      )
    )
  );

  bindStageEvents();
  showFeatured(0);
  startAuto();
}

function showFeatured(index, manual = false) {
  const n = state.featured.length;
  state.featIdx = (index + n) % n;
  const car = state.featured[state.featIdx];

  const img = $(".stage-img", stage);
  delete img.dataset.fb;
  img.src = car.foto;
  img.alt = `${car.nama} tahun ${car.tahun}`;

  $("#stageName").textContent = car.nama;
  $("#stagePrice").textContent = rupiah(car.harga);
  $("#stageSpecs").replaceChildren(
    ...[car.tahun, car.transmisi, car.bahan_bakar].map((t) => el("li", { text: t }))
  );
  $$(".dot", stage).forEach((d, i) => d.setAttribute("aria-current", String(i === state.featIdx)));

  // Mulai ulang animasi masuk
  stage.classList.remove("anim");
  void stage.offsetWidth;
  stage.classList.add("anim");

  if (manual) startAuto();
}

function bindStageEvents() {
  // Gerak halus: nilai saat ini mengejar target tiap frame (lerp)
  const wrap = stage.parentElement; // pembungkus untuk efek tilt 3D
  const home = { mx: 68, my: 30, px: 0, py: 0 };
  const cur = { ...home }, tgt = { ...home };
  let raf = 0;
  const apply = () => {
    let moving = false;
    for (const k in cur) {
      const d = tgt[k] - cur[k];
      if (Math.abs(d) > 0.001) { cur[k] += d * 0.12; moving = true; } else cur[k] = tgt[k];
    }
    stage.style.setProperty("--mx", cur.mx + "%");
    stage.style.setProperty("--my", cur.my + "%");
    stage.style.setProperty("--px", cur.px.toFixed(3));
    stage.style.setProperty("--py", cur.py.toFixed(3));
    wrap.style.setProperty("--tx", cur.px.toFixed(3));
    wrap.style.setProperty("--ty", cur.py.toFixed(3));
    raf = moving ? requestAnimationFrame(apply) : 0;
  };
  const go = () => {
    if (prefersReducedMotion) Object.assign(cur, tgt);
    if (!raf) raf = requestAnimationFrame(apply);
  };

  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    Object.assign(tgt, { mx: x * 100, my: y * 100, px: (x - 0.5) * 2, py: (y - 0.5) * 2 });
    go();
  });
  stage.addEventListener("pointerleave", () => {
    Object.assign(tgt, home);
    go();
    startAuto();
  });
  stage.addEventListener("pointerenter", stopAuto);
  stage.addEventListener("focusin", stopAuto);
  stage.addEventListener("focusout", startAuto);
}

function startAuto() {
  stopAuto();
  if (prefersReducedMotion || state.featured.length < 2) return;
  void stage.offsetWidth;
  stage.classList.add("auto");
  state.timer = setInterval(() => showFeatured(state.featIdx + 1), 6000);
}
function stopAuto() {
  clearInterval(state.timer);
  stage.classList.remove("auto");
}

/* ---------- 11. Statistik hero ---------- */
function countUp(node, to) {
  if (prefersReducedMotion) {
    node.textContent = to;
    return;
  }
  const duration = 900;
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min((t - t0) / duration, 1);
    node.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function fillStats() {
  const available = state.cars.filter((c) => c.available);
  const priced = (available.length ? available : state.cars).map((c) => c.harga);

  countUp($('[data-stat="total"]'), state.cars.length);
  countUp($('[data-stat="available"]'), available.length);
  countUp($('[data-stat="brands"]'), uniq(state.cars.map((c) => c.brand)).length);
  $('[data-stat="minPrice"]').textContent = priced.length ? juta(Math.min(...priced)) : "-";
}

/* ---------- 12. Efek gerak halus ---------- */
let revealIO = null;
function observeReveal(nodes) {
  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    nodes.forEach((n) => n.classList.add("in"));
    return;
  }
  revealIO ||= new IntersectionObserver((entries) => {
    let k = 0;
    entries.filter((e) => e.isIntersecting).forEach((e) => {
      const n = e.target;
      const delay = k++ * 80;
      n.style.transitionDelay = delay + "ms";
      n.classList.add("in");
      revealIO.unobserve(n);
      setTimeout(() => (n.style.transitionDelay = ""), delay + 1000);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  nodes.forEach((n) => revealIO.observe(n));
}

function initEffects() {
  const bar = $("#progress");
  const hero = $("#hero");
  let ticking = false;
  const update = () => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    bar.style.setProperty("--p", max > 0 ? (h.scrollTop / max).toFixed(4) : 0);
    if (hero) hero.style.setProperty("--sc", Math.min(1, h.scrollTop / window.innerHeight).toFixed(4));
    ticking = false;
  };
  window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });

  const items = $$(".section-head, .filters, .services h2, .service-list li, .footer-grid > div, .footer-bottom");
  items.forEach((n) => n.classList.add("reveal"));
  observeReveal(items);
}


/* ---------- 12b. Hero: judul per huruf, video, magnet ---------- */
function splitTitle() {
  const h1 = $("[data-split]");
  if (!h1) return;
  h1.setAttribute("aria-label", "Maison de Luxe");
  let i = 0;
  $$(".word", h1).forEach((word) => {
    const text = word.textContent;
    word.textContent = "";
    word.setAttribute("aria-hidden", "true");
    [...text].forEach((c, j) => {
      word.append(el("span", { class: "ch", style: `--i:${i++};--j:${j}`, text: c === " " ? "\u00a0" : c }));
    });
  });
}

function initVideo() {
  const video = $("#heroVideo");
  const btn = $("#vidToggle");
  if (!video || !btn) return;
  let userPaused = false;

  const setBtn = (paused) => {
    btn.setAttribute("aria-pressed", String(paused));
    btn.setAttribute("aria-label", paused ? "Putar video latar" : "Jeda video latar");
  };

  if (prefersReducedMotion) {
    userPaused = true;
    video.pause();
    setBtn(true);
  } else {
    const p = video.play();
    if (p && p.catch) p.catch(() => setBtn(true)); // autoplay diblokir: poster tetap tampil
  }

  btn.addEventListener("click", () => {
    if (video.paused) {
      userPaused = false;
      video.play().then(() => setBtn(false)).catch(() => {});
    } else {
      userPaused = true;
      video.pause();
      setBtn(true);
    }
  });

  // Hemat baterai: video berhenti saat hero keluar layar
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      if (userPaused) return;
      if (e.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }, { threshold: 0.05 }).observe(video);
  }
}

/** Tombol "magnetik": sedikit tertarik ke arah kursor. */
function initMagnetic() {
  if (prefersReducedMotion || !window.matchMedia("(hover: hover)").matches) return;
  $$("[data-magnetic]").forEach((node) => {
    node.addEventListener("pointermove", (e) => {
      const r = node.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.28;
      const y = (e.clientY - r.top - r.height / 2) * 0.4;
      node.style.translate = `${x}px ${y}px`;
    });
    node.addEventListener("pointerleave", () => { node.style.translate = ""; });
  });
}

/** Sorot kartu katalog mengikuti kursor. */
function initCardGlow() {
  grid.addEventListener("pointermove", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--cx", e.clientX - r.left + "px");
    card.style.setProperty("--cy", e.clientY - r.top + "px");
  });
}

/** Serbuk sari yang naik pelan di latar hero (dari Lumen Motors). */
function initAmbient() {
  const bg = $(".hero-bg");
  if (!bg || prefersReducedMotion) return;
  const total = window.innerWidth < 720 ? 12 : 22;
  for (let i = 0; i < total; i++) {
    const size = 3 + Math.random() * 6;
    const dot = el("span", { class: "pollen", "aria-hidden": "true" });
    dot.style.cssText =
      `left:${Math.random() * 100}%;width:${size}px;height:${size}px;` +
      `--dur:${10 + Math.random() * 10}s;--dl:-${Math.random() * 14}s;` +
      `--dx:${(Math.random() - 0.5) * 120}px`;
    bg.append(dot);
  }
}

function initHero() {
  splitTitle();
  initVideo();
  initMagnetic();
  initCardGlow();
  initAmbient();
}

/* ---------- 13. Mulai ---------- */
function init() {
  bindStaticEvents();
  initEffects();
  initHero();
  updateFavCount();
  loadCars();
}

document.addEventListener("DOMContentLoaded", init);