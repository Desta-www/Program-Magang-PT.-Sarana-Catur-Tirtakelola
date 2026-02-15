const DEFAULT_KEYS_LATEST = [
  "temperature", "humidity", "pressure",
  "wishner", "system", "charging",
  "batteryVoltage", "battery_soc", "velocity",
  "bytes_cycle", "bytes_total"
];

// ====== Embedded connection (Option A) ======
const TB_HOST_DEFAULT = "https://thingsboard.cloud";
const TB_FIXED_DEVICE_ID = "ebd014e0-eed6-11f0-80c0-fdc442896b74";

// Viewer account (auto-login)
const AUTO_TB_USERNAME = "destareza157@gmail.com";
const AUTO_TB_PASSWORD = "desta123";

// localStorage keys
const LS = {
  host: "tb_host",
  device: "tb_device_id",
  token: "tb_jwt_token",
  refresh: "tb_refresh_token"
};

// Export column order (match dashboard)
const EXPORT_COLUMNS = [
  { key: "system",         label: "System" },
  { key: "charging",       label: "Charging" },
  { key: "wishner",        label: "Water Pressure" },
  { key: "velocity",       label: "Velocity" },
  { key: "battery_soc",    label: "Percent Battery" },
  { key: "batteryVoltage", label: "Battery Voltage" },
  { key: "temperature",    label: "Temperature" },
  { key: "humidity",       label: "Humidity" },
  { key: "pressure",       label: "Air Pressure" },
  { key: "bytes_cycle",    label: "Bytes Cycle" },
  { key: "bytes_total",    label: "Bytes Total" }
];


const MAX_WISHNER = 5;

// ✅ 30 minutes bucket for AVG/MIN/MAX
const AGG_INTERVAL_MS = 30 * 60 * 1000;

const TB = { host: TB_HOST_DEFAULT, deviceId: TB_FIXED_DEVICE_ID, token: "", refreshToken: "" };
const timers = { selector: null, latest: null, charts: null };

const charts = {
  water: null,
  velocity: null,
  battSoc: null,
  battVolt: null,
  charging: null,
  temp: null,
  hum: null,
  air: null
};

const ORG_TITLE = "Sarana Catur Tirta Kelola";
const DASH_NAME = "KINO";

function $(id){ return document.getElementById(id); }

function setBrandTitle(text){
  const el = $("brandTitle");
  if (el) el.textContent = text;
  document.title = text;
}

function log(msg){
  const el = $("logBox");
  if (!el) return;
  const ts = new Date().toLocaleString();
  el.textContent = `[${ts}] ${msg}\n` + el.textContent;
}
function clearLog(){ const el = $("logBox"); if (el) el.textContent = ""; }

function setConn(ok, text){
  const el = $("connStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("good","bad","warn","neutral");
  el.classList.add(ok ? "good" : "bad");
}
function setLastUpdatedText(txt){
  const el = $("lastUpdated");
  if (el) el.textContent = txt;
}
function setLastUpdatedNow(){ setLastUpdatedText(`Last update: ${new Date().toLocaleString()}`); }

function hideAllSections(){
  const ids = ["loginSection","selectorSection","dashSection"];
  for (const id of ids){
    const el = $(id);
    if (el) el.style.display = "none";
  }
}

async function testToken(){
  // lightweight endpoint: current user
  const res = await fetchWithAuth(`${TB.host}/api/auth/user`);
  return res.ok;
}

async function bootToSelectorNoFlash(){
  setConn(false, "CONNECTING");
  log("Boot: auto-connecting to ThingsBoard...");

  // 1) If we already have a token, test it quickly
  if (TB.token){
    const ok = await testToken().catch(()=>false);
    if (ok){
      log("Boot: connected (existing token)");
      showSelector();
      startSelectorRefresh();
      setConn(true, "CONNECTED");
      return;
    }
  }

  // 2) Try refresh token
  if (TB.refreshToken){
    try{
      await tbRefreshJwt();
      const ok = await testToken().catch(()=>false);
      if (ok){
        log("Boot: connected (refresh token)");
        showSelector();
        startSelectorRefresh();
        setConn(true, "CONNECTED");
        return;
      }
    }catch(e){
      log(`Boot: refresh token failed: ${e.message}`);
    }
  }

  // 3) Auto-login with embedded user/pass
  await tbPasswordLogin(AUTO_TB_USERNAME, AUTO_TB_PASSWORD);
  const ok = await testToken().catch(()=>false);
  if (!ok) throw new Error("Login succeeded but token test failed");
  log("Boot: connected (auto login)");
  showSelector();
  startSelectorRefresh();
  setConn(true, "CONNECTED");
}

function showLogin(){
  $("loginSection").style.display = "";
  $("selectorSection").style.display = "none";
  $("dashSection").style.display = "none";
  const out = $("btnLogout");
  if (out) out.style.display = "none";
  setConn(false, "DISCONNECTED");
  setBrandTitle(ORG_TITLE);
}

function showSelector(){
  $("loginSection").style.display = "none";
  $("selectorSection").style.display = "";
  $("dashSection").style.display = "none";
  const out = $("btnLogout");
  if (out) out.style.display = "";
  setConn(true, "CONNECTED");
  setBrandTitle(ORG_TITLE);
}

function showDashboard(){
  $("loginSection").style.display = "none";
  $("selectorSection").style.display = "none";
  $("dashSection").style.display = "";
  const out = $("btnLogout");
  if (out) out.style.display = "";
  setConn(true, "CONNECTED");
  setBrandTitle(`${ORG_TITLE} - ${DASH_NAME}`);
}

/** 2 decimals everywhere */
function fmt2(v){
  const n = Number(v);
  if (Number.isNaN(n)) return "-";
  return n.toFixed(2);
}

/**
 * Bytes formatter (SI base-1000)
 */
function formatBytesSI(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return { num: "-", unit: "bytes" };

  const abs = Math.abs(n);
  const units = [
    { unit: "bytes", factor: 1 },
    { unit: "kilobytes", factor: 1e3 },
    { unit: "megabytes", factor: 1e6 },
    { unit: "gigabytes", factor: 1e9 },
    { unit: "terabytes", factor: 1e12 }
  ];

  let chosen = units[0];
  for (let i = units.length - 1; i >= 0; i--){
    if (abs >= units[i].factor){
      chosen = units[i];
      break;
    }
  }

  const scaled = n / chosen.factor;
  return { num: scaled.toFixed(2), unit: chosen.unit };
}

function rangeToMs(v){
  switch(v){
    case "1h": return 1*60*60*1000;
    case "6h": return 6*60*60*1000;
    case "24h": return 24*60*60*1000;
    case "7d": return 7*24*60*60*1000;
    default: return 24*60*60*1000;
  }
}

function rangeToPretty(v){
  switch(v){
    case "1h": return "1 hour";
    case "6h": return "6 hours";
    case "24h": return "24 hours";
    case "7d": return "7 days";
    default: return "24 hours";
  }
}

function getAgg(){ return $("aggSelect")?.value || "AVG"; }
function getRefreshSeconds(){ return Number($("refreshSelect")?.value || 10); }


async function tbPasswordLogin(username, password){
  const url = `${TB.host}/api/auth/login`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`Login failed (${res.status}) ${t}`);
  }
  const data = await res.json();
  TB.token = data.token;
  TB.refreshToken = data.refreshToken;
  saveSession();
  log(`Auth: logged in as ${username}`);
  scheduleJwtRefresh();
  return data;
}

async function tbRefreshJwt(){
  if (!TB.refreshToken) throw new Error("No refresh token");
  const url = `${TB.host}/api/auth/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: TB.refreshToken })
  });
  if (!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`Refresh failed (${res.status}) ${t}`);
  }
  const data = await res.json();
  TB.token = data.token;
  TB.refreshToken = data.refreshToken || TB.refreshToken;
  saveSession();
  log("Auth: token refreshed");
  scheduleJwtRefresh();
  return data;
}

function parseJwtExpMs(jwt){
  try{
    const payload = jwt.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g,"+").replace(/_/g,"/")));
    if (!json.exp) return null;
    return Number(json.exp) * 1000;
  }catch(_e){ return null; }
}

let jwtRefreshTimer = null;
function scheduleJwtRefresh(){
  if (jwtRefreshTimer) clearTimeout(jwtRefreshTimer);
  const expMs = parseJwtExpMs(TB.token);
  if (!expMs) return;
  const now = Date.now();
  // refresh ~60s before expiry (min 10s)
  const wait = Math.max(10000, expMs - now - 60000);
  jwtRefreshTimer = setTimeout(() => {
    tbRefreshJwt().catch(e => log(`Auth refresh error: ${e.message}`));
  }, wait);
}

async function fetchWithAuth(url, opts = {}, retry = true){
  const headers = Object.assign({}, opts.headers || {});
  if (TB.token) headers["Authorization"] = `Bearer ${TB.token}`;
  const res = await fetch(url, Object.assign({}, opts, { headers }));

  if (res.status === 401 && retry){
    // Try refresh once
    try{ await tbRefreshJwt(); }catch(_e){}
    return fetchWithAuth(url, opts, false);
  }
  return res;
}

async function getLatest(keys){
  const keysParam = encodeURIComponent(keys.join(","));
  const url = `${TB.host}/api/plugins/telemetry/DEVICE/${TB.deviceId}/values/timeseries?keys=${keysParam}`;
  const res = await fetchWithAuth(url);
  return await res.json();
}

// ✅ Aggregated history: interval fixed to 30 minutes (AGG_INTERVAL_MS)
async function getHistoryAgg(keys, rangeMs, agg="AVG"){
  const endTs = Date.now();
  const startTs = endTs - rangeMs;
  const keysParam = encodeURIComponent(keys.join(","));

  const url =
    `${TB.host}/api/plugins/telemetry/DEVICE/${TB.deviceId}/values/timeseries` +
    `?keys=${keysParam}&startTs=${startTs}&endTs=${endTs}` +
    `&interval=${AGG_INTERVAL_MS}&agg=${agg}&limit=5000`;

  const res = await fetchWithAuth(url);
  return await res.json();
}

async function getHistoryRaw(keys, rangeMs){
  const endTs = Date.now();
  const startTs = endTs - rangeMs;
  const keysParam = encodeURIComponent(keys.join(","));
  const url =
    `${TB.host}/api/plugins/telemetry/DEVICE/${TB.deviceId}/values/timeseries` +
    `?keys=${keysParam}&startTs=${startTs}&endTs=${endTs}&limit=5000`;

  const res = await fetchWithAuth(url);
  return await res.json();
}

function pickLatestValue(obj, key){
  if (!obj || !obj[key] || !obj[key][0]) return null;
  return obj[key][0].value;
}

function setPill(el, label, cls){
  if (!el) return;
  el.textContent = label;
  el.classList.remove("good","warn","bad","neutral");
  el.classList.add(cls);
}

function normalizeBoolish(v){
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "on";
}

function boolTo01(v){
  return normalizeBoolish(v) ? 1 : 0;
}

/* ========== SELECTOR TILE ========== */
function shortId(id){
  const s = String(id||"");
  if (s.length <= 12) return s || "-";
  return `${s.slice(0,6)}…${s.slice(-4)}`;
}

async function refreshSelectorTile(){
  try{
    const data = await getLatest(["wishner"]);
    const wish = pickLatestValue(data, "wishner");
    const v = (wish === null) ? null : Number(wish);

    $("tileKinoPressure").textContent = v === null ? "--" : fmt2(v);
    $("tileKinoUpdated").textContent = `updated: ${new Date().toLocaleTimeString()}`;
    $("tileKinoDevice").textContent = `device: ${shortId(TB.deviceId)}`;

    const st = $("tileKinoStatus");
    if (v === null){
      setPill(st, "NO DATA", "neutral");
    }else{
      setPill(st, "LIVE", "good");
    }

    setLastUpdatedNow();
    setConn(true, "CONNECTED");
  }catch(e){
    setPill($("tileKinoStatus"), "ERROR", "bad");
    log(`Selector error: ${e.message}`);
  }
}

function startSelectorRefresh(){
  clearTimers();
  refreshSelectorTile().catch(()=>{});
  const sec = getRefreshSeconds();
  timers.selector = setInterval(() => {
    refreshSelectorTile().catch(()=>{});
  }, sec * 1000);
}

/* ===== Gauge (SVG) ===== */
let gaugeValueLen = 0;
let gaugeAnimRaf = null;
let __lastGaugeFrac = 0;

const GAUGE_CX = 100;
const GAUGE_CY = 100;
const GAUGE_R  = 80;

function initGaugeSvg(){
  const value = $("gaugeValue");
  if (!value) return;

  gaugeValueLen = value.getTotalLength();
  value.style.strokeDasharray = `${gaugeValueLen}`;
  value.style.strokeDashoffset = `${gaugeValueLen}`;

  buildGaugeTicks();
  positionGaugeTicks();

  __lastGaugeFrac = 0;
  applyGaugeSvg(0);
}

function setGaugeStamp(){
  const el = $("gaugeStamp");
  if (el) el.textContent = new Date().toLocaleTimeString();
}

function setTipDot(frac){
  const f = Math.max(0, Math.min(1, frac));
  const ang = Math.PI - f * Math.PI;

  const x = GAUGE_CX + Math.cos(ang) * GAUGE_R;
  const y = GAUGE_CY - Math.sin(ang) * GAUGE_R;

  const o = $("gaugeTipOuter");
  const i = $("gaugeTipInner");

  if (o){
    o.setAttribute("cx", String(x));
    o.setAttribute("cy", String(y));
  }
  if (i){
    i.setAttribute("cx", String(x));
    i.setAttribute("cy", String(y));
  }
}

function applyGaugeSvg(frac){
  const f = Math.max(0, Math.min(1, frac));
  const value = $("gaugeValue");
  if (!value) return;

  const offset = gaugeValueLen * (1 - f);
  value.style.strokeDashoffset = `${offset}`;
  setTipDot(f);
}

function animateGaugeTo(fracTarget){
  const target = Math.max(0, Math.min(1, fracTarget));
  const start = __lastGaugeFrac;
  const dur = 520;
  const t0 = performance.now();

  if (gaugeAnimRaf) cancelAnimationFrame(gaugeAnimRaf);

  const ease = (t) => 1 - Math.pow(1 - t, 3);

  const tick = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const cur = start + (target - start) * ease(p);
    applyGaugeSvg(cur);

    if (p < 1){
      gaugeAnimRaf = requestAnimationFrame(tick);
    }else{
      __lastGaugeFrac = target;
    }
  };

  gaugeAnimRaf = requestAnimationFrame(tick);
}

function buildGaugeTicks(){
  const wrap = $("gaugeTicks");
  if (!wrap) return;
  wrap.innerHTML = "";

  for (let i = 0; i <= MAX_WISHNER; i++){
    const sp = document.createElement("span");
    sp.textContent = String(i);
    sp.dataset.value = String(i);
    wrap.appendChild(sp);
  }
}

function positionGaugeTicks(){
  const wrap = $("gaugeTicks");
  if (!wrap) return;
  const spans = Array.from(wrap.querySelectorAll("span"));
  if (!spans.length) return;

  const cx = 100;
  const cy = 100;
  const r = 98;

  spans.forEach((sp) => {
    const v = Number(sp.dataset.value || "0");
    const frac = v / MAX_WISHNER;

    const ang = Math.PI - frac * Math.PI;
    const x = cx + Math.cos(ang) * r;
    const y = cy - Math.sin(ang) * r;

    sp.style.left = `${(x/200)*100}%`;
    sp.style.top  = `${(y/120)*100}%`;
  });
}

/* ========== KPI + Gauge Update ========== */
function setBoolKpi(pillEl, boolVal, onLabel="ON", offLabel="OFF"){
  const on = normalizeBoolish(boolVal);
  if (on){
    setPill(pillEl, onLabel, "good");
  }else{
    setPill(pillEl, offLabel, "neutral");
  }
}

function updateGaugeAndKpis(latest){
  const wish = pickLatestValue(latest, "wishner");
  const sys = pickLatestValue(latest, "system");
  const chg = pickLatestValue(latest, "charging");

  const battSoc = pickLatestValue(latest, "battery_soc");
  const battVolt = pickLatestValue(latest, "batteryVoltage");
  const temp = pickLatestValue(latest, "temperature");
  const hum = pickLatestValue(latest, "humidity");
  const press = pickLatestValue(latest, "pressure");
  const vel = pickLatestValue(latest, "velocity");
  const bc = pickLatestValue(latest, "bytes_cycle");
  const bt = pickLatestValue(latest, "bytes_total");

  setBoolKpi($("kpiSystem"), sys, "ON", "OFF");
  setBoolKpi($("kpiCharging"), chg, "ON", "OFF");

  if (wish !== null){
    const v = Number(wish);
    $("kpiWishner").textContent = fmt2(v);
    $("wishnerBarText").textContent = fmt2(v);
    const frac = Math.max(0, Math.min(MAX_WISHNER, v)) / MAX_WISHNER;
    animateGaugeTo(frac);
  }else{
    $("kpiWishner").textContent = "-";
    $("wishnerBarText").textContent = "0.00";
    animateGaugeTo(0);
  }

  $("kpiBattSoc").textContent = battSoc === null ? "-" : fmt2(battSoc);
  $("kpiBattVolt").textContent = battVolt === null ? "-" : fmt2(battVolt);
  $("kpiTemp").textContent = temp === null ? "-" : fmt2(temp);
  $("kpiHum").textContent = hum === null ? "-" : fmt2(hum);
  $("kpiPress").textContent = press === null ? "-" : fmt2(press);
  $("kpiVelocity").textContent = vel === null ? "-" : fmt2(vel);
  $("kpiBytesCycle").textContent = bc === null ? "-" : fmt2(bc);

  if (bt === null){
    $("kpiBytesTotal").textContent = "-";
    const u = $("kpiBytesTotalUnit");
    if (u) u.textContent = "bytes";
  }else{
    const f = formatBytesSI(bt);
    $("kpiBytesTotal").textContent = f.num;
    const u = $("kpiBytesTotalUnit");
    if (u) u.textContent = f.unit;
  }

  setGaugeStamp();
}

/* ========== Charts ========== */


// ---------------- Tooltip UX (mobile friendly) ----------------
let __tooltipHideTimer = null;

function getAllCharts(){
  return Object.values(charts || {}).filter(c => c && typeof c.setActiveElements === "function");
}
function hideAllTooltips(){
  for (const c of getAllCharts()){
    try{ c.setActiveElements([], {x: 0, y: 0}); c.update("none"); }catch(_e){}
  }
}
function scheduleHideTooltips(ms = 1800){
  if (__tooltipHideTimer) clearTimeout(__tooltipHideTimer);
  __tooltipHideTimer = setTimeout(() => { hideAllTooltips(); __tooltipHideTimer = null; }, ms);
}
function cancelHideTooltips(){
  if (__tooltipHideTimer) clearTimeout(__tooltipHideTimer);
  __tooltipHideTimer = null;
}
function setupGlobalTooltipDismiss(){
  const handler = (e) => {
    const t = e.target;
    if (!(t && t.closest && t.closest("canvas"))){
      hideAllTooltips();
    }
  };
  document.addEventListener("touchstart", handler, { passive: true, capture: true });
  document.addEventListener("mousedown", handler, { capture: true });
  window.addEventListener("scroll", () => hideAllTooltips(), { passive: true, capture: true });
}

function makeLineChart(canvasId, displayLabel, opts = {}){
  const ctx = $(canvasId).getContext("2d");
  const isBool = !!opts.boolLabels;

  return new Chart(ctx, {
    type: "line",
    data: {
      datasets: [{
        label: displayLabel,
        data: [],
        borderWidth: 2,
        pointRadius: 0,          // clean look
        pointHoverRadius: 6,     // desktop
        pointHitRadius: 18,      // BIG hit area (mobile)
        tension: opts.stepped ? 0 : 0.25,
        stepped: !!opts.stepped
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,

      // Easier hover/tap
      interaction: { mode: "nearest", intersect: false },
      events: ["mousemove","mouseout","click","touchstart","touchmove","touchend","touchcancel"],

      plugins: {
        legend: { display: true },
        tooltip: {
          enabled: true,
          mode: "nearest",
          intersect: false,
          callbacks: isBool ? {
            label: (ctx) => {
              const y = ctx.parsed?.y;
              return `${displayLabel}: ${(y >= 1) ? "On" : "Off"}`;
            }
          } : undefined
        }
      },
      scales: {
        x: { type: "time", time: { tooltipFormat: "PPpp" }, ticks: { maxRotation: 45, minRotation: 45 } },
        y: Object.assign(
          { beginAtZero: false },
          (opts.y01 || isBool) ? {
            suggestedMin: -0.05,
            suggestedMax: 1.05,
            ticks: Object.assign({ stepSize: 1 }, isBool ? {
              callback: (v) => (Number(v) === 0 ? "Off" : (Number(v) === 1 ? "On" : ""))
            } : {})
          } : {}
        )
      }
    }
  });
}

// ✅ meta jadi rapih: "Range: 24 hours • Mode: RAW"
function setMeta(id, rangeVal, aggVal){
  const el = $(id);
  if (!el) return;

  const rangePretty = rangeToPretty(rangeVal);
  const raw = aggVal === "NON";

  if (raw){
    el.textContent = `Range: ${rangePretty} • Mode: RAW`;
  }else{
    el.textContent = `Range: ${rangePretty} • Aggregation: ${aggVal} • Bucket: 30 min`;
  }
}

function valueToNumberMaybeBoolean(v){
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  return boolTo01(v);
}

function toChartPoints(arr){
  if (!Array.isArray(arr)) return [];
  return arr.map(p => ({ x: p.ts, y: valueToNumberMaybeBoolean(p.value) }))
            .filter(p => Number.isFinite(p.y));
}

function toChartPointsBool(arr){
  if (!Array.isArray(arr)) return [];
  return arr.map(p => {
    const n = Number(p.value);
    const y = (!Number.isNaN(n) ? (n > 0 ? 1 : 0) : (normalizeBoolish(p.value) ? 1 : 0));
    return { x: p.ts, y };
  });
}


function updateChart(chart, points){
  chart.data.datasets[0].data = points;
  chart.update("none");
}

async function refreshCharts(){
  const rangeVal = $("rangeSelect").value;
  const rangeMs = rangeToMs(rangeVal);
  const agg = getAgg();

  const KEYS = ["wishner","velocity","battery_soc","batteryVoltage","charging","temperature","humidity","pressure"];

  try{
    const data = (agg === "NON")
      ? await getHistoryRaw(KEYS, rangeMs)
      : await getHistoryAgg(KEYS, rangeMs, agg);

    // ✅ meta rapih + konsisten
    setMeta("wishnerMeta", rangeVal, agg);
    setMeta("velocityMeta", rangeVal, agg);
    setMeta("battSocMeta", rangeVal, agg);
    setMeta("battVoltMeta", rangeVal, agg);
    setMeta("chargingMeta", rangeVal, agg);
    setMeta("tempMeta", rangeVal, agg);
    setMeta("humMeta", rangeVal, agg);
    setMeta("pressMeta", rangeVal, agg);

    updateChart(charts.water, toChartPoints(data.wishner));
    updateChart(charts.velocity, toChartPoints(data.velocity));
    updateChart(charts.battSoc, toChartPoints(data.battery_soc));
    updateChart(charts.battVolt, toChartPoints(data.batteryVoltage));
    updateChart(charts.charging, toChartPointsBool(data.charging));
    updateChart(charts.temp, toChartPoints(data.temperature));
    updateChart(charts.hum, toChartPoints(data.humidity));
    updateChart(charts.air, toChartPoints(data.pressure));

  }catch(e){
    log(`Charts error: ${e.message}`);
  }
}

/* ========== Latest refresh ========== */
async function refreshLatest(){
  try{
    const latest = await getLatest(DEFAULT_KEYS_LATEST);
    updateGaugeAndKpis(latest);
    setLastUpdatedNow();
    setConn(true, "CONNECTED");
  }catch(e){
    log(`Latest error: ${e.message}`);
  }
}

function clearTimers(){
  Object.keys(timers).forEach(k => {
    if (timers[k]) clearInterval(timers[k]);
    timers[k] = null;
  });
}

function startDashboardLoops(){
  clearTimers();

  refreshLatest().catch(()=>{});
  refreshCharts().catch(()=>{});

  const sec = getRefreshSeconds();
  timers.latest = setInterval(() => refreshLatest().catch(()=>{}), sec * 1000);

  const chartEvery = Math.max(20, sec);
  timers.charts = setInterval(() => refreshCharts().catch(()=>{}), chartEvery * 1000);
}

/* ========== Wire UI ========== */
function readLoginInputs(){
  TB.host = ($("tbHost").value || "").trim();
  TB.deviceId = ($("deviceId").value || "").trim();
  TB.token = ($("jwtToken").value || "").trim();
}

function saveSession(){
  localStorage.setItem("tbHost", TB.host);
  localStorage.setItem("tbDeviceId", TB.deviceId);
  localStorage.setItem("tbToken", TB.token);
}

function loadSession(){
  TB.host = localStorage.getItem(LS.host) || TB_HOST_DEFAULT;
  TB.deviceId = localStorage.getItem(LS.device) || TB_FIXED_DEVICE_ID;
  TB.token = localStorage.getItem(LS.token) || "";
  TB.refreshToken = localStorage.getItem(LS.refresh) || "";

  // Keep inputs (if user ever opens login) in sync
  const h = $("tbHost"); if (h) h.value = TB.host;
  const d = $("deviceId"); if (d) d.value = TB.deviceId;
  const j = $("jwtToken"); if (j) j.value = TB.token;
  const u = $("tbUser"); if (u) u.value = AUTO_TB_USERNAME;
  const p = $("tbPass"); if (p) p.value = AUTO_TB_PASSWORD;

  const badge = $("deviceBadge");
  if (badge) badge.textContent = TB.deviceId ? (TB.deviceId.slice(0,6) + "..." + TB.deviceId.slice(-4)) : "-";
}

function initChartsOnce(){
  if (!charts.water){
    // ✅ legend label sekarang bener (bukan key telemetry)
    charts.water    = makeLineChart("chartWishner",   "Water Pressure");
    charts.velocity = makeLineChart("chartVelocity",  "Velocity");
    charts.battSoc  = makeLineChart("chartBattSoc",   "Percent Battery");
    charts.battVolt = makeLineChart("chartBattVolt",  "Battery Voltage");
    charts.charging = makeLineChart("chartCharging", "Charging", { stepped: true, y01: true, boolLabels: true });
    charts.temp     = makeLineChart("chartTemp",      "Temperature");
    charts.hum      = makeLineChart("chartHum",       "Humidity");
    charts.air      = makeLineChart("chartPress",     "Air Pressure");
  }

  // Mobile: auto-hide tooltip shortly after finger lifts
  const ids = ["chartWishner","chartVelocity","chartBattSoc","chartBattVolt","chartCharging","chartTemp","chartHum","chartPress"];
  for (const id of ids){
    const cv = $(id);
    if (!cv) continue;
    cv.addEventListener("touchstart", () => cancelHideTooltips(), { passive: true });
    cv.addEventListener("touchmove",  () => cancelHideTooltips(), { passive: true });
    cv.addEventListener("touchend",   () => scheduleHideTooltips(1800), { passive: true });
    cv.addEventListener("touchcancel",() => scheduleHideTooltips(200), { passive: true });
  }

}

function bindUI(){
  $("btnClearLog").addEventListener("click", clearLog);

  $("btnUseToken").addEventListener("click", async () => {
    try{
      readLoginInputs();
      if (!TB.host || !TB.deviceId || !TB.token){
        $("loginMsg").textContent = "Host, Device ID, and Token are required.";
        return;
      }
      $("loginMsg").textContent = "Checking token…";
      saveSession();

      await getLatest(["wishner"]);
      $("loginMsg").textContent = "Login OK.";
      showSelector();
      startSelectorRefresh();
    }catch(e){
      $("loginMsg").textContent = e.message;
      log(`Login error: ${e.message}`);
      setConn(false, "TOKEN INVALID");
    }
  });

  $("btnLogin").addEventListener("click", () => {
    $("loginMsg").textContent = "Use Token Only for Google Sign-in.";
  });

  $("btnLogout").addEventListener("click", () => {
    clearTimers();
    TB.token = "";
    localStorage.removeItem("tbToken");
    showLogin();
  });

  $("tileKino").addEventListener("click", () => {
    showDashboard();
    $("deviceBadge").textContent = shortId(TB.deviceId);
    initChartsOnce();
    initGaugeSvg();
    startDashboardLoops();
  });

  $("btnBackToSelector").addEventListener("click", () => {
    showSelector();
    startSelectorRefresh();
  });

  $("btnRefreshNow").addEventListener("click", () => {
    refreshLatest().catch(()=>{});
    refreshCharts().catch(()=>{});
  });

  $("rangeSelect").addEventListener("change", () => {
    refreshCharts().catch(()=>{});
    startDashboardLoops();
  });

  $("refreshSelect").addEventListener("change", () => {
    if ($("selectorSection").style.display !== "none"){
      startSelectorRefresh();
    }
    if ($("dashSection").style.display !== "none"){
      startDashboardLoops();
    }
  });

  $("aggSelect").addEventListener("change", () => {
    refreshCharts().catch(()=>{});
  });

  window.addEventListener("resize", () => {
    positionGaugeTicks();
  });

  $("btnExport")?.addEventListener("click", async () => {
    try{
      const scope = ($("exportScope")?.value || "range").toLowerCase();
      const fmt = ($("exportFormat")?.value || "csv").toLowerCase();
      await exportData(scope, fmt);
    }catch(e){
      log(`Export error: ${e.message}`);
      alert(`Export error: ${e.message}`);
    }
  });

}


// ---------------- Export (CSV / XLS / XLSX) ----------------
function fmtTsLocal(ts){
  // Nice Excel-friendly: YYYY-MM-DD HH:mm:ss
  try{
    // sv-SE gives ISO-like local string: "2026-01-22 16:05:00"
    return new Date(Number(ts)).toLocaleString("sv-SE", { hour12: false });
  }catch(_e){
    return String(ts);
  }
}

async function getHistoryRawPage(keysCsv, startTs, endTs, limit=10000, orderBy="ASC"){
  const url =
    `${TB.host}/api/plugins/telemetry/DEVICE/${TB.deviceId}/values/timeseries` +
    `?keys=${encodeURIComponent(keysCsv)}&startTs=${startTs}&endTs=${endTs}` +
    `&limit=${limit}&orderBy=${orderBy}`;
  const res = await fetchWithAuth(url);
  if (!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`History fetch failed (${res.status}) ${t}`);
  }
  return await res.json();
}

function rowsToCsv(rows, headers){
  const esc = (s) => {
    const t = String(s ?? "");
    if (/[",\n]/.test(t)) return '"' + t.replace(/"/g,'""') + '"';
    return t;
  };
  const lines = [headers.map(esc).join(",")];
  for (const r of rows){
    lines.push(headers.map(h => esc(r[h])).join(","));
  }
  return lines.join("\n");
}

function downloadBlob(filename, blob){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 250);
}

function getExportWindowMs(){
  const rangeSel = $("rangeSelect");
  const v = rangeSel ? rangeSel.value : "24h";
  return rangeToMs(v);
}

async function exportData(scope, format){
  const now = Date.now();
  const startTs = (scope === "all") ? 0 : (now - getExportWindowMs());
  const endTs = now;

  const keys = EXPORT_COLUMNS.map(c => c.key);
  const labels = EXPORT_COLUMNS.map(c => c.label);

  log(`Export: ${scope.toUpperCase()} as ${format.toUpperCase()} (${labels.length} columns)...`);

  // Fetch all keys in one shot (ThingsBoard returns { key: [{ts,value}...] })
  const data = await getHistoryRawPage(keys.join(","), startTs, endTs, 10000, "ASC");

  // Build union timestamps
  const tsSet = new Set();
  for (const k of keys){
    for (const p of (data?.[k] || [])) tsSet.add(Number(p.ts));
  }
  const tsList = Array.from(tsSet).sort((a,b)=>a-b);

  // Lookup maps
  const lookups = {};
  for (const k of keys){
    const m = new Map();
    for (const p of (data?.[k] || [])){
      m.set(Number(p.ts), p.value);
    }
    lookups[k] = m;
  }

  // Build rows with friendly headers (and a timestamp column)
  const headers = ["Timestamp", ...labels];
  const rows = [];
  for (const ts of tsList){
    const row = { "Timestamp": fmtTsLocal(ts) };
    for (let i=0;i<keys.length;i++){
      const key = keys[i];
      const label = labels[i];
      let v = lookups[key].get(ts);
      if (v === undefined) v = "";
      // Charging/System export as On/Off for readability
      if (key === "charging" || key === "system"){
        const n = Number(v);
        const on = (!Number.isNaN(n) ? (n > 0) : normalizeBoolish(v));
        v = (v === "" ? "" : (on ? "On" : "Off"));
      }
      row[label] = v;
    }
    rows.push(row);
  }

  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  const baseName = `thingsboard_${TB.deviceId}_${scope}_${stamp}`;

  if (format === "csv"){
    downloadBlob(`${baseName}.csv`, new Blob([rowsToCsv(rows, headers)], { type: "text/csv;charset=utf-8" }));
    log(`Export: done (${rows.length} rows)`);
    return;
  }

  if (typeof XLSX === "undefined"){
    throw new Error("XLSX library not loaded. (SheetJS CDN needs internet)");
  }

  const sheetData = [headers];
  for (const r of rows){
    sheetData.push(headers.map(h => r[h]));
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "telemetry");

  const bookType = (format === "xls") ? "xls" : "xlsx";
  const out = XLSX.write(wb, { bookType, type: "array" });

  const mime = (format === "xls")
    ? "application/vnd.ms-excel"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  downloadBlob(`${baseName}.${bookType}`, new Blob([out], { type: mime }));
  log(`Export: done (${rows.length} rows)`);
}

(function boot(){
  // Keep UI clean: no login flash.
  loadSession();
  bindUI();
  setupGlobalTooltipDismiss();

  // Start with everything hidden, then jump straight to selector.
  hideAllSections();
  bootToSelectorNoFlash().catch(e => {
    log(`Boot error: ${e.message}`);
    // fallback
    showLogin();
  });
})();
