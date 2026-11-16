// Racha Criativo — lista do vôlei
// Dados: Firebase Firestore (online) ou localStorage (modo teste).

const $ = (s) => document.querySelector(s);
const CONF = window.VOLEI_CONFIG || {};

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- datas ----------
const pad = (n) => String(n).padStart(2, "0");
function nextSunday(from = new Date()) {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return d;
}
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const fmtDay = (s) => { const d = parseDate(s); return `${WEEKDAYS[d.getDay()]} (${pad(d.getDate())}/${pad(d.getMonth() + 1)})`; };
const fmtHour = (t) => (t || "").replace(/^0/, "").replace(":00", "h").replace(":", "h");
const toLocalInput = (ms) => { const d = new Date(ms); return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const money = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });

function defaultConfig() {
  const date = isoDate(nextSunday());
  return { title: "Racha Criativo", date, weekId: date, start: "16:00", end: "19:00", spots: 18, price: 10, pixKey: "", pixName: "", opensAtMs: 0 };
}

// ---------- armazenamento: modo teste ----------
function localStore() {
  const KEY = "volei-demo-v1";
  const read = () => { const d = LS.get(KEY, {}); return { config: null, entries: {}, members: {}, ...d }; };
  let cfgFns = [], entFns = [], meFns = [], memFns = [];
  const emit = () => {
    const d = read();
    cfgFns.forEach((f) => f(d.config));
    entFns.forEach(({ weekId, fn }) => fn(Object.values(d.entries).filter((e) => e.weekId === weekId)));
    meFns.forEach((f) => f(d.members[uid] || null));
    memFns.forEach((f) => f(Object.values(d.members)));
  };
  const write = (d) => { LS.set(KEY, d); emit(); };
  window.addEventListener("storage", (e) => { if (e.key === KEY) emit(); });
  let uid = LS.get("volei-uid", null);
  if (!uid) { uid = Math.random().toString(36).slice(2); LS.set("volei-uid", uid); }
  return {
    mode: "demo", uid,
    onConfig(fn) { cfgFns.push(fn); fn(read().config); },
    onEntries(weekId, fn) {
      const h = { weekId, fn }; entFns.push(h);
      fn(Object.values(read().entries).filter((e) => e.weekId === weekId));
      return () => { entFns = entFns.filter((x) => x !== h); };
    },
    async setConfig(c) { const d = read(); d.config = { ...(d.config || {}), ...c }; write(d); },
    async addEntry(weekId, e) {
      const d = read(); const id = Math.random().toString(36).slice(2);
      d.entries[id] = { ...e, id, weekId, createdAt: Date.now() }; write(d);
    },
    async updateEntry(weekId, id, p) { const d = read(); if (d.entries[id]) Object.assign(d.entries[id], p); write(d); },
    async deleteEntry(weekId, id) { const d = read(); delete d.entries[id]; write(d); },
    async adminLogin(pin) { if (pin !== String(CONF.demoPin || "1234")) throw new Error("PIN errado"); },
    onMyMember(fn) { meFns.push(fn); fn(read().members[uid] || null); },
    onMembers(fn) { memFns.push(fn); fn(Object.values(read().members)); return () => { memFns = memFns.filter((x) => x !== fn); }; },
    async requestAccess(name) { const d = read(); d.members[uid] = { uid, name, status: "pending", requestedAt: Date.now() }; write(d); },
    async setMemberStatus(id, status) { const d = read(); if (d.members[id]) d.members[id].status = status; write(d); },
    async deleteMember(id) { const d = read(); delete d.members[id]; write(d); },
  };
}

// ---------- armazenamento: Firebase ----------
function loadScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Falha ao carregar " + src)); document.head.appendChild(s); });
}
async function firebaseStore(cfg) {
  const v = "10.12.2", base = `https://www.gstatic.com/firebasejs/${v}/`;
  await loadScript(base + "firebase-app-compat.js");
  await Promise.all([loadScript(base + "firebase-auth-compat.js"), loadScript(base + "firebase-firestore-compat.js")]);
  firebase.initializeApp(cfg);
  const cred = await firebase.auth().signInAnonymously();
  const db = firebase.firestore();
  const cfgRef = db.doc("config/current");
  const entries = (weekId) => db.collection("weeks").doc(weekId).collection("entries");
  return {
    mode: "online", uid: cred.user.uid,
    onConfig(fn) { cfgRef.onSnapshot((s) => fn(s.exists ? s.data() : null), showError); },
    onEntries(weekId, fn) {
      return entries(weekId).onSnapshot((q) => fn(q.docs.map((d) => {
        const x = d.data({ serverTimestamps: "estimate" });
        return { ...x, id: d.id, createdAt: x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : Date.now() };
      })), showError);
    },
    setConfig(c) { return cfgRef.set(c, { merge: true }); },
    addEntry(weekId, e) { return entries(weekId).add({ ...e, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); },
    updateEntry(weekId, id, p) { return entries(weekId).doc(id).update(p); },
    deleteEntry(weekId, id) { return entries(weekId).doc(id).delete(); },
    async adminLogin(pin) {
      try { await db.doc("adminSessions/" + cred.user.uid).set({ pin }); }
      catch { throw new Error("PIN errado"); }
    },
    onMyMember(fn) { db.doc("members/" + cred.user.uid).onSnapshot((s) => fn(s.exists ? s.data() : null), showError); },
    onMembers(fn) {
      return db.collection("members").onSnapshot((q) => fn(q.docs.map((d) => {
        const x = d.data({ serverTimestamps: "estimate" });
        return { ...x, uid: d.id, requestedAt: x.requestedAt && x.requestedAt.toMillis ? x.requestedAt.toMillis() : Date.now() };
      })), (e) => { if (e.code === "permission-denied") adminExpired(); else showError(e); });
    },
    requestAccess(name) {
      return db.doc("members/" + cred.user.uid).set({ uid: cred.user.uid, name, status: "pending", requestedAt: firebase.firestore.FieldValue.serverTimestamp() });
    },
    setMemberStatus(id, status) { return db.doc("members/" + id).update({ status }); },
    deleteMember(id) { return db.doc("members/" + id).delete(); },
  };
}

// ---------- estado ----------
let store, config = null, list = [], unsubEntries = null, isAdmin = LS.get("volei-admin", false);
let me = null, meLoaded = false, members = [], unsubMembers = null;
const approved = () => me && me.status === "approved";

function adminExpired() {
  isAdmin = false; LS.del("volei-admin"); stopMembers(); render();
  toast("Seu acesso de organizador expirou. Entre de novo com o PIN.");
}
function startMembers() { if (!unsubMembers) unsubMembers = store.onMembers((m) => { members = m; renderMembers(); }); }
function stopMembers() { if (unsubMembers) { unsubMembers(); unsubMembers = null; } members = []; }

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}
function showError(err) {
  console.error(err);
  const code = err && err.code;
  if (code === "permission-denied") toast("Não deu: a lista ainda está fechada ou você não tem permissão.");
  else toast("Erro: " + (err && err.message ? err.message : err));
}

// Membros por ordem de chegada, depois convidados por ordem de chegada.
function ordered() {
  const byTime = (a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id));
  const m = list.filter((e) => e.type !== "convidado").sort(byTime);
  const g = list.filter((e) => e.type === "convidado").sort(byTime);
  const all = m.concat(g), n = Number(config.spots) || 18;
  return { main: all.slice(0, n), wait: all.slice(n), spots: n };
}

const isOpen = () => !config.opensAtMs || Date.now() >= config.opensAtMs;

// ---------- render ----------
function render() {
  if (!config) return;
  const { main, wait, spots } = ordered();
  document.title = config.title || "Racha Criativo";
  $("#title").textContent = config.title || "Racha Criativo";
  $("#when").textContent = `${fmtDay(config.date)} · ${fmtHour(config.start)}–${fmtHour(config.end)}`;
  $("#sConf").textContent = `${main.length}/${spots}`;
  $("#sWait").textContent = wait.length;
  $("#sPaid").textContent = main.filter((e) => e.paid === "confirmed").length;
  $("#fill").style.width = Math.min(100, (main.length / spots) * 100) + "%";
  $("#listCount").textContent = main.length >= spots ? "lotada" : `${spots - main.length} vagas`;

  // lista principal com vagas vazias numeradas, como no grupo
  const ml = $("#mainList"); ml.replaceChildren();
  for (let i = 0; i < spots; i++) ml.appendChild(main[i] ? row(main[i], i + 1, true) : emptyRow(i + 1));
  const wl = $("#waitList"); wl.replaceChildren();
  if (!wait.length) { const li = emptyRow("–"); li.querySelector(".who").textContent = "Ninguém na espera"; wl.appendChild(li); }
  wait.forEach((e, i) => wl.appendChild(row(e, i + 1, false)));

  // pagamento
  $("#price").textContent = money(config.price);
  $("#pixKey").textContent = config.pixKey || "O organizador ainda não cadastrou a chave";
  $("#pixName").textContent = config.pixName ? "Para: " + config.pixName : "";
  $("#copyPix").disabled = !config.pixKey;

  // acesso: sem cadastro -> pedir; pendente/recusado -> aviso; aprovado -> pode entrar
  $("#accessCard").hidden = !meLoaded || !!me;
  $("#pendingCard").hidden = !me || me.status === "approved";
  if (me && me.status === "pending") $("#pendingMsg").textContent = `Pedido enviado como "${me.name}". Assim que um organizador aprovar, esta tela muda sozinha.`;
  if (me && me.status === "rejected") $("#pendingMsg").textContent = "Seu pedido não foi aprovado. Fale com um organizador no grupo.";
  $("#joinCard").hidden = !approved();

  renderOpenState();
  const mine = list.filter((e) => e.uid === store.uid && e.type !== "convidado");
  $("#joinName").value = approved() ? me.name : "";
  $("#joinBtn").disabled = !isOpen() || mine.length > 0 || !approved();
  $("#guestBtn").disabled = !isOpen() || mine.length === 0;

  $("#adminCard").hidden = !isAdmin;
  $("#requestsCard").hidden = !isAdmin;
  $("#adminOpen").hidden = isAdmin;
  renderMembers();
}

function renderMembers() {
  if (!isAdmin) return;
  const pending = members.filter((m) => m.status === "pending").sort((a, b) => a.requestedAt - b.requestedAt);
  const ok = members.filter((m) => m.status === "approved").sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  $("#reqCount").textContent = pending.length ? pending.length + " esperando" : "";
  $("#memCount").textContent = ok.length;
  const rl = $("#reqList"); rl.replaceChildren();
  if (!pending.length) { const li = emptyRow("–"); li.querySelector(".who").textContent = "Nenhum pedido novo"; rl.appendChild(li); }
  pending.forEach((m, i) => {
    const li = memberRow(m, i + 1);
    li.querySelector(".acts").append(
      btn("Aprovar", "sm", () => store.setMemberStatus(m.uid, "approved").then(() => toast(m.name + " aprovado."), showError)),
      confirmBtn("Recusar", () => store.setMemberStatus(m.uid, "rejected").catch(showError)));
    rl.appendChild(li);
  });
  const ml = $("#memList"); ml.replaceChildren();
  ok.forEach((m, i) => {
    const li = memberRow(m, i + 1);
    li.querySelector(".acts").append(confirmBtn("Remover", () => store.deleteMember(m.uid).then(() => toast(m.name + " removido."), showError)));
    ml.appendChild(li);
  });
}
function memberRow(m, n) {
  const li = document.createElement("li");
  li.innerHTML = `<span class="num">${n}.</span><span class="who"><b></b><span class="sub"></span></span><span class="acts"></span>`;
  li.querySelector("b").textContent = m.name;
  li.querySelector(".sub").textContent = "pediu em " + new Date(m.requestedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return li;
}

function renderOpenState() {
  const box = $("#openState"), { main, wait } = ordered();
  const mine = [...main.map((e, i) => [e, i + 1, "lista"]), ...wait.map((e, i) => [e, i + 1, "espera"])]
    .find(([e]) => e.uid === store.uid && e.type !== "convidado");
  if (!isOpen()) {
    const left = config.opensAtMs - Date.now();
    const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000), s = Math.floor((left % 60000) / 1000);
    const d = new Date(config.opensAtMs);
    box.className = "notice wait";
    box.innerHTML = `A lista abre ${WEEKDAYS[d.getDay()].toLowerCase()} às ${pad(d.getHours())}:${pad(d.getMinutes())}<span class="countdown">${h > 47 ? Math.floor(h / 24) + " dias" : `${pad(h)}:${pad(m)}:${pad(s)}`}</span>`;
  } else if (mine) {
    box.className = "notice ok";
    box.textContent = mine[2] === "lista" ? `Você está na lista: nº ${mine[1]}.` : `Você está na espera: nº ${mine[1]}. Se alguém sair, você sobe.`;
  } else { box.className = ""; box.textContent = ""; }
}

function emptyRow(n) {
  const li = document.createElement("li"); li.className = "empty";
  li.innerHTML = `<span class="num">${n}.</span><span class="who">vaga livre</span><span></span>`;
  return li;
}

const PAID_LABEL = { no: "não pagou", informed: "aguardando", confirmed: "pago" };

function row(e, n, inMain) {
  const li = document.createElement("li");
  const mineRow = e.uid === store.uid;
  if (mineRow) li.classList.add("mine");
  const num = document.createElement("span"); num.className = "num"; num.textContent = n + ".";
  const who = document.createElement("span"); who.className = "who";
  const b = document.createElement("b"); b.textContent = e.name; who.appendChild(b);
  if (e.type === "convidado") {
    const t = document.createElement("span"); t.className = "tag"; t.textContent = "convidado"; who.appendChild(t);
    const s = document.createElement("span"); s.className = "sub"; s.textContent = "de " + (e.invitedBy || "?"); who.appendChild(s);
  }
  const acts = document.createElement("span"); acts.className = "acts";
  if (inMain) {
    const p = document.createElement("span"); p.className = "pill " + (e.paid || "no"); p.textContent = PAID_LABEL[e.paid || "no"]; acts.appendChild(p);
  }
  if (inMain && mineRow && (e.paid || "no") === "no") acts.appendChild(btn("Já paguei", "sm yellow", () => store.updateEntry(config.weekId, e.id, { paid: "informed" }).then(() => toast("Avisado! O organizador vai confirmar."), showError)));
  if (inMain && isAdmin && e.paid !== "confirmed") acts.appendChild(btn("Confirmar", "sm", () => store.updateEntry(config.weekId, e.id, { paid: "confirmed" }).catch(showError)));
  if (inMain && isAdmin && e.paid === "confirmed") acts.appendChild(btn("Desfazer", "sm ghost", () => store.updateEntry(config.weekId, e.id, { paid: "no" }).catch(showError)));
  if (mineRow || isAdmin) acts.appendChild(confirmBtn(mineRow ? "Sair" : "Remover", () => store.deleteEntry(config.weekId, e.id).then(() => toast(e.name + " saiu da lista."), showError)));
  li.append(num, who, acts);
  return li;
}

function btn(label, cls, fn) {
  const b = document.createElement("button"); b.type = "button"; b.className = "btn " + cls; b.textContent = label;
  b.addEventListener("click", fn); return b;
}
// Botão de duas etapas (o navegador do artifact/WhatsApp pode bloquear confirm())
function confirmBtn(label, fn) {
  const b = btn(label, "sm ghost", () => {
    if (b.dataset.armed) { fn(); return; }
    b.dataset.armed = "1"; b.textContent = "Certeza?"; b.className = "btn sm danger";
    setTimeout(() => { delete b.dataset.armed; b.textContent = label; b.className = "btn sm ghost"; }, 3000);
  });
  return b;
}

// ---------- texto do WhatsApp ----------
function whatsappText() {
  const { main, wait, spots } = ordered();
  const lines = [String(config.title || "Racha Criativo").toUpperCase(), fmtDay(config.date), `${fmtHour(config.start)}-${fmtHour(config.end)}`, ""];
  for (let i = 0; i < spots; i++) {
    const e = main[i];
    lines.push(e ? `${i + 1}. ${e.name}${e.type === "convidado" ? ` (conv. ${e.invitedBy})` : ""}${e.paid === "confirmed" ? " ✅" : ""}` : `${i + 1}. `);
  }
  lines.push("", "espera:");
  wait.forEach((e, i) => lines.push(`${i + 1}. ${e.name}${e.type === "convidado" ? ` (conv. ${e.invitedBy})` : ""}`));
  lines.push("", "Entre pelo site: " + location.href.split("#")[0]);
  return lines.join("\n");
}
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(okMsg); } catch { toast("Não consegui copiar. Selecione e copie manualmente."); }
    ta.remove();
  }
}

// ---------- ações ----------
function cleanName(s) { return s.replace(/\s+/g, " ").trim().slice(0, 40); }

$("#accessForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const name = cleanName($("#accessName").value);
  if (!name) return;
  try { await store.requestAccess(name); toast("Pedido enviado!"); }
  catch (e) { showError(e); }
});

$("#joinForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!approved()) return toast("Você ainda não foi aprovado.");
  const name = me.name;
  if (!isOpen()) return toast("A lista ainda não abriu.");
  if (list.some((e) => e.uid === store.uid && e.type !== "convidado")) return toast("Você já está na lista.");
  $("#joinBtn").disabled = true;
  try { await store.addEntry(config.weekId, { name, type: "membro", uid: store.uid, paid: "no" }); toast("Você entrou!"); }
  catch (e) { showError(e); $("#joinBtn").disabled = false; }
});

$("#guestForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const name = cleanName($("#guestName").value);
  const me = list.find((e) => e.uid === store.uid && e.type !== "convidado");
  if (!name || !me) return toast("Entre na lista antes de levar convidado.");
  if (list.some((e) => e.name.toLowerCase() === name.toLowerCase())) return toast(`Já tem um "${name}" na lista.`);
  try { await store.addEntry(config.weekId, { name, type: "convidado", invitedBy: me.name, uid: store.uid, paid: "no" }); $("#guestName").value = ""; toast("Convidado adicionado."); }
  catch (e) { showError(e); }
});

$("#copyPix").addEventListener("click", () => copy(config.pixKey, "Chave Pix copiada."));
$("#copyList").addEventListener("click", () => copy(whatsappText(), "Lista copiada. Cole no grupo!"));

$("#adminOpen").addEventListener("click", () => { $("#pinForm").hidden = !$("#pinForm").hidden; $("#pin").focus(); });
$("#pinForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try { await store.adminLogin($("#pin").value.trim()); isAdmin = true; LS.set("volei-admin", true); $("#pinForm").hidden = true; $("#pin").value = ""; fillCfgForm(); startMembers(); render(); toast("Modo organizador ligado."); }
  catch (e) { toast(e.message); }
});
$("#adminLogout").addEventListener("click", () => { isAdmin = false; LS.del("volei-admin"); stopMembers(); render(); });

function fillCfgForm() {
  if (!config) return;
  $("#cTitle").value = config.title || ""; $("#cDate").value = config.date; $("#cSpots").value = config.spots;
  $("#cStart").value = config.start || ""; $("#cEnd").value = config.end || "";
  $("#cOpens").value = config.opensAtMs ? toLocalInput(config.opensAtMs) : "";
  $("#cPrice").value = config.price ?? ""; $("#cPixName").value = config.pixName || ""; $("#cPix").value = config.pixKey || "";
}
function readCfgForm() {
  const opens = $("#cOpens").value;
  const date = $("#cDate").value;
  return {
    title: cleanName($("#cTitle").value) || "Racha Criativo", date, weekId: date,
    spots: Math.max(1, Number($("#cSpots").value) || 18), start: $("#cStart").value, end: $("#cEnd").value,
    opensAtMs: opens ? new Date(opens).getTime() : 0, price: Number($("#cPrice").value) || 0,
    pixName: $("#cPixName").value.trim(), pixKey: $("#cPix").value.trim(),
  };
}
$("#cfgForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  store.setConfig(readCfgForm()).then(() => toast("Salvo."), (e) => toast(e.code === "permission-denied" ? "Sem permissão: entre de novo com o PIN." : e.message));
});
$("#nextWeek").addEventListener("click", () => {
  const next = nextSunday(parseDate(config.date));
  $("#cDate").value = isoDate(next);
  toast("Data trocada para " + fmtDay(isoDate(next)) + ". Ajuste a abertura e toque em Salvar.");
});

// ---------- início ----------
function subscribeWeek() {
  if (unsubEntries) unsubEntries();
  list = [];
  unsubEntries = store.onEntries(config.weekId, (items) => { list = items; render(); });
}

(async function start() {
  try {
    store = CONF.firebase ? await firebaseStore(CONF.firebase) : localStore();
  } catch (e) {
    showError(e); $("#when").textContent = "Não consegui conectar. Recarregue a página."; return;
  }
  $("#demoBanner").hidden = store.mode !== "demo";
  store.onMyMember((m) => { me = m; meLoaded = true; render(); });
  if (isAdmin) startMembers();
  let currentWeek = null;
  store.onConfig((c) => {
    if (!c) {
      config = defaultConfig();
      if (store.mode === "demo") store.setConfig(config);
    } else config = { ...defaultConfig(), ...c };
    if (config.weekId !== currentWeek) { currentWeek = config.weekId; subscribeWeek(); }
    if (isAdmin) fillCfgForm();
    render();
  });
  setInterval(() => { if (config && config.opensAtMs && !isOpen() || (config && config.opensAtMs && Date.now() - config.opensAtMs < 2000)) render(); }, 1000);
})();
