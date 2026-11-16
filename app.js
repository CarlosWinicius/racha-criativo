// Racha Criativo — lista do vôlei (Supabase)
"use strict";

const $ = (s) => document.querySelector(s);
const CONF = window.VOLEI_CONFIG || {};
const configured = !!(CONF.supabaseUrl && CONF.supabaseKey && window.supabase);
const sb = configured ? window.supabase.createClient(CONF.supabaseUrl, CONF.supabaseKey) : null;
const EMAIL_DOMAIN = "racha-criativo.app"; // usuários viram "apelido@racha-criativo.app" (nenhum e-mail é enviado)

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayISO = () => isoDate(new Date());
const WD = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WD3 = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MO3 = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const hour = (t) => { if (!t) return ""; const [h, m] = t.split(":"); return Number(h) + "h" + (m && m !== "00" ? m : ""); };
const money = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 40);
const toLocalInput = (iso) => { const d = new Date(iso); return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtOpen = (iso) => { const d = new Date(iso); return `${WD3[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function nextSunday(from = new Date()) { const d = new Date(from); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return d; }
function countdown(ms) {
  if (ms <= 0) return "agora";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  if (h >= 48) return Math.floor(h / 24) + " dias";
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function userToEmail(u) {
  u = String(u || "").trim().toLowerCase();
  if (u.includes("@")) return u;
  return u.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._-]/g, "") + "@" + EMAIL_DOMAIN;
}
function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Invalid login credentials/i.test(m)) return "Usuário ou senha errados.";
  if (/already registered|already been registered/i.test(m)) return "Esse usuário já existe. Escolha outro.";
  if (/Password should be at least/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/rate limit|too many/i.test(m)) return "Muitas tentativas. Espere um minuto e tente de novo.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sem conexão. Confira a internet e tente de novo.";
  return m;
}

// ---------- estado ----------
let session = null, me = null, meLoaded = false;
let lists = [], listsLoaded = false, entries = {}, members = [];
let tiers = {}; // só para admins: { "u:<pessoa>": 1..3, "e:<inscrição>": 1..3 }
let route = parseRoute(), authTab = "login", adminTab = "lists";
let channel = null;

function parseRoute() {
  const h = location.hash.slice(1);
  if (h.startsWith("l-")) return { name: "list", id: h.slice(2) };
  if (h === "admin") return { name: "admin" };
  return { name: "home" };
}
const uid = () => session && session.user.id;
const approved = () => me && (me.status === "approved" || me.is_admin);

// ---------- dados ----------
async function refresh() {
  if (!session) return;
  try {
    const p = await sb.from("profiles").select("*").eq("id", uid()).maybeSingle();
    if (p.error) throw p.error;
    me = p.data; meLoaded = true;
    if (approved()) {
      const since = isoDate(addDays(new Date(), -14));
      const l = await sb.from("lists").select("*").gte("game_date", since).order("game_date").order("start_time");
      if (l.error) throw l.error;
      lists = l.data || []; listsLoaded = true;
      const ids = lists.map((x) => x.id);
      const next = {};
      ids.forEach((id) => (next[id] = []));
      if (ids.length) {
        const e = await sb.from("entries").select("*").in("list_id", ids).order("created_at").order("id");
        if (e.error) throw e.error;
        (e.data || []).forEach((x) => next[x.list_id] && next[x.list_id].push(x));
      }
      entries = next;
    }
    if (me && me.is_admin) {
      const m = await sb.from("profiles").select("*").order("created_at");
      if (!m.error) members = m.data || [];
      const t = await sb.from("tiers").select("key,tier");
      if (!t.error) tiers = Object.fromEntries((t.data || []).map((x) => [x.key, x.tier]));
    }
  } catch (e) { toast(errMsg(e)); }
  render();
}
let refreshTimer;
const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); };

function startRealtime() {
  if (channel) return;
  channel = sb.channel("racha")
    .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "lists" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, scheduleRefresh)
    .subscribe();
}
function stopRealtime() { if (channel) { sb.removeChannel(channel); channel = null; } }

// Membros por ordem de chegada (hora do servidor), depois convidados.
function ordered(l) {
  const es = entries[l.id] || [];
  const byTime = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);
  // "avulso" (colocado pelo organizador) conta como membro
  const all = es.filter((e) => e.kind !== "convidado").sort(byTime).concat(es.filter((e) => e.kind === "convidado").sort(byTime));
  const n = Number(l.spots) || 18;
  return { main: all.slice(0, n), wait: all.slice(n), spots: n };
}
function myPlace(l) {
  const { main, wait } = ordered(l);
  let i = main.findIndex((e) => e.user_id === uid() && e.kind === "membro");
  if (i >= 0) return { where: "main", n: i + 1, entry: main[i] };
  i = wait.findIndex((e) => e.user_id === uid() && e.kind === "membro");
  if (i >= 0) return { where: "wait", n: i + 1, entry: wait[i] };
  return null;
}
const isPast = (l) => l.game_date < todayISO();
const isOpen = (l) => !l.opens_at || Date.now() >= new Date(l.opens_at).getTime();

// ---------- render ----------
function render() {
  // guarda o que a pessoa está digitando
  const keep = {}; let focusId = null;
  document.querySelectorAll("#app input").forEach((i) => { if (i.id) keep[i.id] = i.value; });
  if (document.activeElement && document.activeElement.closest("#app")) focusId = document.activeElement.id;

  let html;
  if (!configured) html = viewNotConfigured();
  else if (session === null) html = viewAuth();
  else if (!meLoaded) html = viewLoading();
  else if (!me) html = viewNoProfile();
  else if (!approved()) html = viewPending();
  else if (route.name === "admin") html = me.is_admin ? viewAdmin() : viewHome();
  else if (route.name === "list") html = viewList(route.id);
  else html = viewHome();
  $("#app").innerHTML = html;

  for (const id in keep) { const el = document.getElementById(id); if (el && el.type !== "password") el.value = keep[id]; }
  if (focusId) { const el = document.getElementById(focusId); if (el) el.focus(); }
  renderTopbar(); renderBar(); tick();
}

function renderTopbar() {
  const inside = session && me && approved();
  $("#backBtn").hidden = !(inside && route.name !== "home");
  $("#adminBtn").hidden = !(inside && me.is_admin);
  $("#adminBtn").classList.toggle("on", route.name === "admin");
  $("#meBtn").hidden = !session || session === undefined;
  if (session && me) $("#meBtn").textContent = (me.name || "?").trim().charAt(0).toUpperCase();
}

const viewLoading = () => `<div class="empty"><div class="spinner" aria-hidden="true"></div><p class="muted">Carregando…</p></div>`;
const viewNotConfigured = () => `<div class="empty"><h1 class="title">Site em configuração</h1><p class="muted">O organizador ainda está ligando o banco de dados. Volte daqui a pouco.</p></div>`;
const viewNoProfile = () => `<div class="empty"><h1 class="title">Conta sem perfil</h1><p class="muted">Sua conta existe, mas o perfil não foi criado. Avise um organizador.</p><button class="btn ghost" data-act="logout">Sair da conta</button></div>`;

function viewAuth() {
  const login = authTab === "login";
  return `
  <section class="banner tall">
    <span class="eyebrow">Vôlei de domingo</span>
    <h1 class="title big">Racha Criativo</h1>
    <p>Entre na lista do jogo, veja sua posição e pague pelo Pix.</p>
  </section>
  <section class="card">
    <div class="seg" role="tablist">
      <button role="tab" class="${login ? "on" : ""}" data-act="authTab" data-tab="login">Entrar</button>
      <button role="tab" class="${!login ? "on" : ""}" data-act="authTab" data-tab="signup">Criar conta</button>
    </div>
    ${login ? `
    <form data-form="login" class="stack">
      <label class="field">Usuário<input id="lUser" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="seu apelido"></label>
      <label class="field">Senha<input id="lPass" type="password" autocomplete="current-password" required></label>
      <button class="btn lg" type="submit">Entrar</button>
    </form>` : `
    <form data-form="signup" class="stack">
      <label class="field">Seu nome na lista<input id="sName" type="text" maxlength="40" required placeholder="Ex.: Carlos" autocomplete="nickname"></label>
      <label class="field">Usuário<input id="sUser" type="text" maxlength="24" required placeholder="Ex.: carlos.vb" autocapitalize="none" spellcheck="false" autocomplete="username"><small>Só letras, números, ponto e traço. Você usa para entrar.</small></label>
      <label class="field">Senha<input id="sPass" type="password" minlength="6" required autocomplete="new-password"><small>Pelo menos 6 caracteres.</small></label>
      <div class="notice warn"><b>Não use uma senha de verdade.</b> Nada de senha do e-mail, banco ou Instagram. Crie uma senha só para o vôlei.</div>
      <button class="btn lg" type="submit">Criar conta</button>
      <p class="small muted center">Depois de criar, um organizador precisa aprovar seu acesso.</p>
    </form>`}
  </section>`;
}

function viewPending() {
  const rejected = me.status === "rejected";
  return `<div class="empty">
    <figure class="meme"><img src="img/meme.png" alt="Meme rindo"><figcaption>${rejected ? "Não foi dessa vez" : "Calma que já já te aprovam"}</figcaption></figure>
    <h1 class="title">${rejected ? "Acesso não aprovado" : "Aguardando aprovação"}</h1>
    <p class="muted">${rejected ? "Um organizador recusou seu acesso. Fale com eles no grupo." : `Oi, <b>${esc(me.name)}</b>! Sua conta foi criada. Assim que um organizador aprovar, esta tela muda sozinha.`}</p>
    <button class="btn ghost" data-act="logout">Sair da conta</button>
  </div>`;
}

function dateBadge(l) {
  const d = parseDate(l.game_date);
  return `<span class="dbadge"><small>${WD3[d.getDay()]}</small><b>${pad(d.getDate())}</b><small>${MO3[d.getMonth()]}</small></span>`;
}

function statusChip(l) {
  const { main, wait, spots } = ordered(l), mine = myPlace(l);
  if (isPast(l)) return `<span class="chip">encerrada</span>`;
  if (mine) return `<span class="chip me">${mine.where === "main" ? "você: nº " + mine.n : "espera: nº " + mine.n}</span>`;
  if (!isOpen(l)) return `<span class="chip warn">abre ${esc(fmtOpen(l.opens_at))}</span>`;
  if (main.length >= spots) return `<span class="chip bad">lotada${wait.length ? " · " + wait.length + " na espera" : ""}</span>`;
  return `<span class="chip ok">aberta</span>`;
}

function viewHome() {
  const up = lists.filter((l) => !isPast(l));
  const cards = up.map((l) => {
    const { main, spots } = ordered(l), d = parseDate(l.game_date);
    return `<a class="game" href="#l-${l.id}">
      ${dateBadge(l)}
      <span class="game-body">
        <b>${esc(l.title)}</b>
        <span class="small muted">${WD[d.getDay()]} · ${hour(l.start_time)}–${hour(l.end_time)} · ${main.length}/${spots}</span>
        <span class="meter"><i style="width:${Math.min(100, (main.length / spots) * 100)}%"></i></span>
        ${statusChip(l)}
      </span>
      <span class="chev" aria-hidden="true">›</span>
    </a>`;
  }).join("");
  return `
  <section class="banner">
    <span class="eyebrow">Olá, ${esc(me.name)}</span>
    <h1 class="title">Próximos jogos</h1>
  </section>
  ${up.length ? `<div class="games">${cards}</div>` : `
  <div class="empty card">
    <figure class="meme"><img src="img/meme.png" alt="Meme rindo"><figcaption>Sem vôlei essa semana?</figcaption></figure>
    <h2 class="h2">Nenhuma lista aberta</h2>
    <p class="muted">${me.is_admin ? "Crie a lista do próximo domingo na área do organizador." : "Os organizadores criam a lista da semana. Ela aparece aqui."}</p>
    ${me.is_admin ? `<a class="btn" href="#admin">Criar lista</a>` : ""}
  </div>`}`;
}

function pill(paid) {
  const t = { no: "não pagou", informed: "aguardando", confirmed: "pago" }[paid || "no"];
  return `<span class="pill ${paid || "no"}">${t}</span>`;
}
function rowHtml(l, e, n, inMain) {
  const mineRow = e.user_id === uid();
  const can = mineRow || me.is_admin;
  const inner = `<span class="num">${n}</span>
    <span class="who"><b>${esc(e.name)}${e.is_setter ? ` <span class="lev">LEV</span>` : ""}</b>${e.kind === "convidado" ? `<small>convidado de ${esc(e.invited_by)}</small>` : e.kind === "avulso" ? `<small>colocado por ${esc(e.invited_by)}</small>` : ""}</span>
    ${inMain ? pill(e.paid) : ""}${can ? `<span class="chev" aria-hidden="true">›</span>` : ""}`;
  return `<li class="${mineRow ? "mine" : ""}">${can
    ? `<button class="rowbtn" type="button" data-act="row" data-list="${l.id}" data-id="${e.id}" aria-label="Opções de ${esc(e.name)}">${inner}</button>`
    : `<div class="rowbtn">${inner}</div>`}</li>`;
}

function viewList(id) {
  const l = lists.find((x) => x.id === id);
  if (!l) return listsLoaded ? `<div class="empty"><h1 class="title">Lista não encontrada</h1><p class="muted">Ela pode ter sido apagada.</p><a class="btn" href="#">Ver jogos</a></div>` : viewLoading();
  const { main, wait, spots } = ordered(l), mine = myPlace(l), d = parseDate(l.game_date);
  const paidCount = main.filter((e) => e.paid === "confirmed").length;
  let notice = "";
  if (isPast(l)) notice = `<div class="notice">Esse jogo já passou.</div>`;
  else if (!isOpen(l)) notice = `<div class="notice warn">A lista abre ${esc(fmtOpen(l.opens_at))}<span class="cd" data-cd="${l.opens_at}"></span></div>
    <img class="meme-wide" src="img/diabo.jpg" alt="Meme: o grupo do racha quando soltam a lista" onerror="this.remove()">`;
  else if (mine && mine.where === "main") notice = `<div class="notice ok">Você é o <b>nº ${mine.n}</b> da lista.</div>`;
  else if (mine) notice = `<div class="notice warn">Você é o <b>nº ${mine.n}</b> da espera. Se alguém sair, você sobe sozinho.</div>`;
  else if (main.length >= spots) notice = `<div class="notice">Lista lotada. Se entrar agora, você vai para a espera.</div>`;

  return `
  <section class="hero">
    <div class="hero-top">
      ${dateBadge(l)}
      <div class="hero-txt">
        <span class="eyebrow">${WD[d.getDay()]} · ${hour(l.start_time)}–${hour(l.end_time)}</span>
        <h1>${esc(l.title)}</h1>
      </div>
    </div>
    <div class="score">
      <div><b>${main.length}<small>/${spots}</small></b><span>na lista</span></div>
      <div><b>${wait.length}</b><span>na espera</span></div>
      <div><b>${paidCount}</b><span>pagos</span></div>
    </div>
    <div class="meter light"><i style="width:${Math.min(100, (main.length / spots) * 100)}%"></i></div>
  </section>
  ${notice}
  ${me.is_admin && !isPast(l) && !(Array.isArray(l.teams) && l.teams.length) ? `<div class="notice ${main.length >= spots ? "ok" : ""} admin-cta">
    <span>${main.length >= spots ? "<b>Lista completa!</b> Hora de sortear os times." : `Times: o sorteio libera quando a lista completar (${main.length}/${spots}).`}</span>
    <button class="btn sm ${main.length >= spots ? "yellow" : "ghost"}" data-act="teams" data-list="${l.id}">${main.length >= spots ? "Sortear times" : "Marcar levantadores"}</button>
  </div>` : ""}
  ${teamsSection(l)}
  <section class="card flush">
    <h2 class="h2 pad">Lista <small>${main.length >= spots ? "lotada" : spots - main.length + " vagas livres"}</small></h2>
    <ol class="rows">
      ${main.map((e, i) => rowHtml(l, e, i + 1, true)).join("")}
      ${main.length < spots ? `<li class="free"><span class="num">${main.length + 1}</span><span>${main.length + 1 === spots ? "última vaga livre" : `vagas ${main.length + 1} a ${spots} livres`}</span></li>` : ""}
    </ol>
  </section>
  ${wait.length ? `<section class="card flush">
    <h2 class="h2 pad">Espera <small>sobe sozinho se alguém sair</small></h2>
    <ol class="rows">${wait.map((e, i) => rowHtml(l, e, i + 1, false)).join("")}</ol>
  </section>` : ""}
  <div class="tools">
    ${mine && !isPast(l) ? `<button class="btn ghost" data-act="guest" data-list="${l.id}">+ Convidado</button>` : ""}
    ${me.is_admin ? `<button class="btn ghost" data-act="addPerson" data-list="${l.id}">+ Colocar pessoa</button>
    <button class="btn ghost" data-act="teams" data-list="${l.id}">Sortear times</button>` : ""}
    <button class="btn ghost" data-act="pix" data-list="${l.id}">Pix ${money(l.price)}</button>
    <button class="btn ghost" data-act="copy" data-list="${l.id}">Copiar p/ WhatsApp</button>
  </div>`;
}

function renderBar() {
  const bar = $("#bar");
  const l = route.name === "list" && approved() && lists.find((x) => x.id === route.id);
  if (!l || isPast(l)) { bar.hidden = true; document.body.classList.remove("has-bar"); return; }
  const { main, spots } = ordered(l), mine = myPlace(l);
  let h;
  if (!isOpen(l)) h = `<button class="btn lg" disabled>Abre em&nbsp;<span data-cd="${l.opens_at}"></span></button>`;
  else if (!mine) h = `<button class="btn lg" data-act="join" data-list="${l.id}">${main.length >= spots ? "Entrar na espera" : "Entrar na lista"}</button>`;
  else if (mine.where === "wait") h = `<span class="bar-txt">Espera: nº ${mine.n}</span><button class="btn lg ghost" data-act="leave" data-list="${l.id}" data-id="${mine.entry.id}" data-confirm="Sair da espera?">Sair da espera</button>`;
  else if ((mine.entry.paid || "no") === "no") h = `<button class="btn lg yellow" data-act="pix" data-list="${l.id}">Pagar ${money(l.price)}</button><button class="btn lg ghost narrow" data-act="leave" data-list="${l.id}" data-id="${mine.entry.id}" data-confirm="Sair?">Sair</button>`;
  else h = `<span class="bar-txt">${mine.entry.paid === "confirmed" ? "Pagamento confirmado" : "Pagamento enviado, falta o organizador confirmar"}</span><button class="btn lg ghost narrow" data-act="leave" data-list="${l.id}" data-id="${mine.entry.id}" data-confirm="Sair?">Sair</button>`;
  bar.querySelector(".bar-in").innerHTML = h;
  bar.hidden = false; document.body.classList.add("has-bar");
}

// ---------- admin ----------
function viewAdmin() {
  const pending = members.filter((m) => m.status === "pending");
  const tabs = `<div class="seg three" role="tablist">
    <button class="${adminTab === "lists" ? "on" : ""}" data-act="adminTab" data-tab="lists">Listas</button>
    <button class="${adminTab === "requests" ? "on" : ""}" data-act="adminTab" data-tab="requests">Pedidos${pending.length ? ` <span class="badge">${pending.length}</span>` : ""}</button>
    <button class="${adminTab === "people" ? "on" : ""}" data-act="adminTab" data-tab="people">Pessoas</button>
  </div>`;
  let body = "";
  if (adminTab === "lists") {
    const sorted = [...lists].sort((a, b) => (a.game_date < b.game_date ? 1 : -1));
    body = `<button class="btn lg" data-act="newList">+ Nova lista</button>
    ${sorted.length ? `<div class="games">${sorted.map((l) => {
      const { main, spots } = ordered(l);
      return `<div class="game static">
        ${dateBadge(l)}
        <span class="game-body"><b>${esc(l.title)}</b>
          <span class="small muted">${hour(l.start_time)}–${hour(l.end_time)} · ${main.length}/${spots} · ${l.opens_at ? "abre " + esc(fmtOpen(l.opens_at)) : "aberta"}</span>
          <span class="mini-acts">
            <a class="btn sm ghost" href="#l-${l.id}">Ver</a>
            <button class="btn sm ghost" data-act="editList" data-id="${l.id}">Editar</button>
            <button class="btn sm ghost" data-act="teams" data-list="${l.id}">Sortear times</button>
            <button class="btn sm ghost" data-act="repeatList" data-id="${l.id}">Repetir +7 dias</button>
            <button class="btn sm ghost danger-txt" data-act="deleteList" data-id="${l.id}" data-confirm="Apagar mesmo?">Apagar</button>
          </span>
        </span></div>`;
    }).join("")}</div>` : `<p class="muted center">Nenhuma lista ainda.</p>`}`;
  } else if (adminTab === "requests") {
    body = pending.length ? `<ol class="rows card flush">${pending.map((m) => `<li><div class="rowbtn plain">
        <span class="who"><b>${esc(m.name)}</b><small>pediu ${new Date(m.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></span>
        <span class="mini-acts"><button class="btn sm" data-act="setStatus" data-id="${m.id}" data-status="approved">Aprovar</button>
        <button class="btn sm ghost" data-act="setStatus" data-id="${m.id}" data-status="rejected" data-confirm="Recusar?">Recusar</button></span>
      </div></li>`).join("")}</ol>` : `<div class="empty card"><h2 class="h2">Nenhum pedido novo</h2><p class="muted">Quando alguém criar conta, aparece aqui para você aprovar.</p></div>`;
  } else {
    const people = members.filter((m) => m.status !== "pending").sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    body = `<ol class="rows card flush">${people.map((m) => `<li><div class="rowbtn plain">
        <span class="who"><b>${esc(m.name)}</b>${m.is_admin ? ` <span class="pill confirmed">admin</span>` : ""}${m.status === "rejected" ? ` <span class="pill no">bloqueado</span>` : ""}
          ${m.status === "approved" ? tierPicker("u:" + m.id) : ""}</span>
        <span class="mini-acts">${m.id === uid() ? `<span class="small muted">você</span>` : `
          ${m.status === "approved"
            ? `<button class="btn sm ghost" data-act="setAdmin" data-id="${m.id}" data-val="${m.is_admin ? "0" : "1"}" ${m.is_admin ? 'data-confirm="Tirar admin?"' : ""}>${m.is_admin ? "Tirar admin" : "Tornar admin"}</button>
               <button class="btn sm ghost" data-act="resetPw" data-id="${m.id}" data-name="${esc(m.name)}" data-confirm="Gerar senha nova?">Resetar senha</button>
               <button class="btn sm ghost danger-txt" data-act="setStatus" data-id="${m.id}" data-status="rejected" data-confirm="Bloquear?">Bloquear</button>`
            : `<button class="btn sm" data-act="setStatus" data-id="${m.id}" data-status="approved">Aprovar</button>`}`}
        </span></div></li>`).join("")}</ol>`;
  }
  return `<section class="intro"><span class="eyebrow">Área do organizador</span><h1 class="title">Organizar</h1></section>${tabs}${body}`;
}

function listFormHtml(l) {
  const base = l || lists[lists.length - 1] || {};
  const date = l ? l.game_date : isoDate(nextSunday());
  return `<h2 class="h2">${l ? "Editar lista" : "Nova lista"}</h2>
  <form data-form="list" data-id="${l ? l.id : ""}" class="grid2">
    <label class="field full">Nome<input id="fTitle" type="text" maxlength="60" value="${esc(base.title || "Racha Criativo")}" required></label>
    <label class="field">Data do jogo<input id="fDate" type="date" value="${date}" required></label>
    <label class="field">Vagas<input id="fSpots" type="number" inputmode="numeric" min="1" max="100" value="${base.spots || 18}" required></label>
    <label class="field">Início<input id="fStart" type="time" value="${base.start_time || "16:00"}"></label>
    <label class="field">Fim<input id="fEnd" type="time" value="${base.end_time || "19:00"}"></label>
    <label class="field full">A lista abre em<input id="fOpens" type="datetime-local" value="${l && l.opens_at ? toLocalInput(l.opens_at) : ""}"><small>Vazio = já abre na hora. Antes disso ninguém consegue entrar.</small></label>
    <label class="field">Valor (R$)<input id="fPrice" type="number" inputmode="decimal" min="0" step="0.5" value="${base.price ?? 10}"></label>
    <label class="field">Recebedor<input id="fPixName" type="text" maxlength="40" value="${esc(base.pix_name || "")}"></label>
    <label class="field full">Chave Pix<input id="fPix" type="text" maxlength="80" value="${esc(base.pix_key || "")}" autocapitalize="none"></label>
    <button class="btn lg full" type="submit">${l ? "Salvar" : "Criar lista"}</button>
  </form>`;
}

// ---------- folhas (bottom sheet) ----------
function openSheet(html) {
  $("#sheetBody").innerHTML = html; $("#sheet").hidden = false; document.body.classList.add("locked");
  const f = $("#sheetBody").querySelector("input:not([type=hidden])"); if (f && window.matchMedia("(pointer:fine)").matches) f.focus();
}
function closeSheet() { openTeamsList = null; $("#sheet").hidden = true; document.body.classList.remove("locked"); }

function pixSheet(l) {
  const mine = myPlace(l);
  return `<h2 class="h2">Pagamento</h2>
  <div class="pix">
    <div><span class="small muted">Valor por pessoa</span><div class="price">${money(l.price)}</div></div>
    ${l.pix_name ? `<div class="small muted">Para: <b>${esc(l.pix_name)}</b></div>` : ""}
    ${l.pix_key ? `
    <button class="btn lg" data-act="copyPixCode" data-list="${l.id}">Copiar Pix copia e cola</button>
    <p class="small muted">No app do banco: <b>Pix</b> → <b>Pix copia e cola</b> → cole. O valor de ${money(l.price)} já vai preenchido.</p>
    <div class="pixkey"><span class="small muted">Ou use a chave:</span><br><code>${esc(l.pix_key)}</code></div>
    <button class="btn ghost" data-act="copyPix" data-list="${l.id}">Copiar só a chave</button>` : `<div class="pixkey"><code>O organizador ainda não cadastrou a chave Pix.</code></div>`}
    ${mine && mine.where === "main" && (mine.entry.paid || "no") === "no" ? `<button class="btn lg yellow" data-act="paid" data-list="${l.id}" data-id="${mine.entry.id}">Já paguei</button>
    <p class="small muted center">Depois de pagar, toque em <b>Já paguei</b>. O organizador confirma.</p>` : ""}
  </div>`;
}

function rowSheet(l, e) {
  const mineRow = e.user_id === uid();
  const { main } = ordered(l);
  const inMain = main.some((x) => x.id === e.id);
  const acts = [];
  if (mineRow && e.kind === "membro" && inMain && (e.paid || "no") === "no") {
    acts.push(`<button class="btn lg yellow" data-act="paid" data-list="${l.id}" data-id="${e.id}">Já paguei</button>`);
    acts.push(`<button class="btn lg ghost" data-act="pix" data-list="${l.id}">Ver chave Pix</button>`);
  }
  if (me.is_admin && inMain) {
    acts.push(e.paid === "confirmed"
      ? `<button class="btn lg ghost" data-act="setPaid" data-list="${l.id}" data-id="${e.id}" data-val="no">Marcar como não pago</button>`
      : `<button class="btn lg" data-act="setPaid" data-list="${l.id}" data-id="${e.id}" data-val="confirmed">Confirmar pagamento</button>`);
  }
  const label = mineRow && e.kind === "membro" ? "Sair da lista" : mineRow && e.kind === "convidado" ? "Tirar convidado" : "Remover da lista";
  acts.push(`<button class="btn lg ghost danger-txt" data-act="leave" data-list="${l.id}" data-id="${e.id}" data-confirm="Toque de novo para confirmar">${label}</button>`);
  return `<h2 class="h2">${esc(e.name)}</h2>
  <p class="small muted">${e.kind === "convidado" ? "Convidado de " + esc(e.invited_by) + " · " : e.kind === "avulso" ? "Colocado por " + esc(e.invited_by) + " · " : ""}entrou às ${new Date(e.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
  <div class="stack">${acts.join("")}</div>`;
}

const guestSheet = (l) => `<h2 class="h2">Levar convidado</h2>
  <p class="small muted">Convidados ficam depois de todos os membros. Se a lista encher, eles vão para a espera.</p>
  <form data-form="guest" data-list="${l.id}" class="stack">
    <label class="field">Nome do convidado<input id="gName" type="text" maxlength="40" required></label>
    <button class="btn lg" type="submit">Adicionar</button>
  </form>`;

function accountSheet() {
  const user = session.user.email.endsWith("@" + EMAIL_DOMAIN) ? session.user.email.split("@")[0] : session.user.email;
  return `<h2 class="h2">${esc(me ? me.name : "Sua conta")}</h2>
  <p class="small muted">Usuário: ${esc(user)}${me && me.is_admin ? " · organizador" : ""}</p>
  ${isStandalone() ? "" : `<div class="stack">
    <button class="btn lg yellow" data-act="install">Instalar como app</button>
    <p class="small muted" id="installHelp" hidden></p>
  </div>`}
  <form data-form="changePw" class="stack">
    <label class="field">Nova senha<input id="newPw" type="password" minlength="6" required autocomplete="new-password"><small>Não use uma senha de verdade. Pelo menos 6 caracteres.</small></label>
    <button class="btn lg ghost" type="submit">Trocar senha</button>
  </form>
  <button class="btn lg ghost danger-txt" data-act="logout">Sair da conta</button>`;
}

// ---------- times do dia ----------
const TEAM_STYLES = [
  { name: "Time Azul", cls: "t-blue" }, { name: "Time Amarelo", cls: "t-yellow" }, { name: "Time Branco", cls: "t-white" },
  { name: "Time Verde", cls: "t-green" }, { name: "Time Vermelho", cls: "t-red" },
];
const TEAM_SIZE = 6;
const teamCount = (l) => Math.max(2, Math.floor((Number(l.spots) || 18) / TEAM_SIZE));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const r = new Uint32Array(1); crypto.getRandomValues(r);
    const j = r[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// ---------- tiers (só admin) ----------
let openTeamsList = null; // lista cuja folha de sorteio está aberta
function refreshTierUI() {
  const l = !$("#sheet").hidden && openTeamsList && findList(openTeamsList);
  if (l) $("#sheetBody").innerHTML = teamsSheet(l); else render();
}
const TIER_NAMES = { 1: "Iniciante", 2: "Meia bomba", 3: "Os melhores" };
const tierKey = (e) => (e.kind === "membro" ? "u:" + e.user_id : "e:" + e.id);
const tierOf = (e) => tiers[tierKey(e)] || 2; // sem classificação conta como meia bomba
function tierPicker(key) {
  const cur = tiers[key];
  return `<span class="tierpick" role="group" aria-label="Tier">${[1, 2, 3].map((t) =>
    `<button type="button" class="${cur === t ? "on t" + t : ""}" data-act="setTier" data-key="${key}" data-tier="${t}" title="${TIER_NAMES[t]}" aria-pressed="${cur === t}">${t}</button>`).join("")}</span>`;
}

// Um levantador por time (sorteado entre os marcados). O resto vai do melhor para o
// iniciante, cada um para o time mais fraco no momento (empate = sorteio).
function drawTeams(main, n, tierFn = () => 2) {
  const setters = shuffle(main.filter((e) => e.is_setter));
  if (setters.length < n) throw new Error(`Marque pelo menos ${n} levantadores (marcados: ${setters.length}).`);
  const teams = setters.slice(0, n).map((s) => ({ setter: s.id, players: [], sum: tierFn(s) }));
  const used = new Set(teams.map((t) => t.setter));
  const cap = Math.ceil(main.length / n);
  const rest = shuffle(main.filter((e) => !used.has(e.id))).sort((a, b) => tierFn(b) - tierFn(a));
  for (const e of rest) {
    const open = shuffle(teams.filter((t) => t.players.length + 1 < cap));
    const pool = open.length ? open : shuffle(teams);
    const t = pool.reduce((best, x) => (x.sum < best.sum || (x.sum === best.sum && x.players.length < best.players.length) ? x : best));
    t.players.push(e.id); t.sum += tierFn(e);
  }
  return teams.map(({ setter, players }) => ({ setter, players }));
}

function teamsSection(l) {
  if (!Array.isArray(l.teams) || !l.teams.length) return "";
  const byId = Object.fromEntries((entries[l.id] || []).map((e) => [e.id, e]));
  const mainIds = ordered(l).main.map((e) => e.id);
  const teamIds = l.teams.flatMap((t) => [t.setter, ...t.players]);
  const stale = teamIds.some((id) => !mainIds.includes(id)) || mainIds.some((id) => !teamIds.includes(id));
  const when = l.teams_at ? new Date(l.teams_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const cards = l.teams.map((t, i) => {
    const st = TEAM_STYLES[i % TEAM_STYLES.length];
    const people = [t.setter, ...t.players].map((id, j) => {
      const e = byId[id];
      return `<li>${e ? esc(e.name) : `<i class="muted">saiu da lista</i>`}${j === 0 ? ` <span class="lev">LEV</span>` : ""}</li>`;
    }).join("");
    const strength = me.is_admin ? [t.setter, ...t.players].reduce((s, id) => s + (byId[id] ? tierOf(byId[id]) : 0), 0) : 0;
    return `<div class="team ${st.cls}"><h3>${st.name}${me.is_admin ? `<small>força ${strength}</small>` : ""}</h3><ol>${people}</ol></div>`;
  }).join("");
  return `<section class="card">
    <h2 class="h2">Times do dia <small>${when ? "sorteado " + when : ""}</small></h2>
    ${stale ? `<div class="notice warn">A lista mudou depois do sorteio.${me.is_admin ? " Sorteie de novo." : " Os times podem mudar."}</div>` : ""}
    <div class="teams">${cards}</div>
    <div class="tools">
      <button class="btn ghost" data-act="copyTeams" data-list="${l.id}">Copiar times</button>
      ${me.is_admin ? `<button class="btn ghost" data-act="teams" data-list="${l.id}">Sortear de novo</button>` : ""}
    </div>
  </section>`;
}

function teamsSheet(l) {
  const { main, spots } = ordered(l), n = teamCount(l);
  const marked = main.filter((e) => e.is_setter).length;
  const full = main.length >= spots;
  const ready = full && marked >= n;
  const why = !full ? `A lista precisa estar completa para sortear (${main.length}/${spots}).`
    : marked < n ? `Marque pelo menos ${n} levantadores. Faltam ${n - marked}.` : `Pronto! ${n} times de ${Math.floor(main.length / n)}, um levantador em cada.`;
  const unrated = main.filter((e) => !tiers[tierKey(e)]).length;
  return `<h2 class="h2">Sortear times</h2>
  <p class="small muted">Marque os <b>levantadores</b> (LEV) e o <b>tier</b> de cada um: <b>1</b> iniciante, <b>2</b> meia bomba, <b>3</b> os melhores. Só organizadores veem o tier. O site lembra tudo para as próximas semanas.</p>
  <ol class="rows card flush">${main.map((e) => `<li><div class="rowbtn plain prow">
    <span class="who"><b>${esc(e.name)}</b>${e.kind !== "membro" ? `<small>${e.kind === "convidado" ? "convidado" : "avulso"}</small>` : ""}</span>
    <span class="mini-acts">
      <button type="button" class="pick ${e.is_setter ? "on" : ""}" data-act="toggleSetter" data-list="${l.id}" data-id="${e.id}" aria-pressed="${e.is_setter ? "true" : "false"}">LEV</button>
      ${tierPicker(tierKey(e))}
    </span></div></li>`).join("")}</ol>
  ${unrated ? `<p class="small muted">${unrated} sem tier. Quem não tem tier conta como 2 (meia bomba).</p>` : ""}
  <div class="notice ${ready ? "ok" : "warn"}">Levantadores: <b>${marked}</b> de ${n}. ${why}</div>
  <button class="btn lg yellow" data-act="draw" data-list="${l.id}" ${ready ? "" : "disabled"}>${Array.isArray(l.teams) && l.teams.length ? "Sortear de novo" : "Sortear times"}</button>
  ${Array.isArray(l.teams) && l.teams.length ? `<button class="btn lg ghost danger-txt" data-act="clearTeams" data-list="${l.id}" data-confirm="Apagar os times?">Apagar times</button>` : ""}`;
}

function teamsText(l) {
  const byId = Object.fromEntries((entries[l.id] || []).map((e) => [e.id, e]));
  const d = parseDate(l.game_date);
  const out = [`TIMES DO DIA · ${l.title.toUpperCase()} (${pad(d.getDate())}/${pad(d.getMonth() + 1)})`];
  l.teams.forEach((t, i) => {
    out.push("", TEAM_STYLES[i % TEAM_STYLES.length].name.toUpperCase());
    [t.setter, ...t.players].forEach((id, j) => out.push(`${j + 1}. ${byId[id] ? byId[id].name : "?"}${j === 0 ? " (levantador)" : ""}`));
  });
  return out.join("\n");
}

const addPersonSheet = (l) => `<h2 class="h2">Colocar pessoa na lista</h2>
  <p class="small muted">Para quem não tem conta ou está sem celular. Entra como membro, na ordem de agora.</p>
  <form data-form="addPerson" data-list="${l.id}" class="stack">
    <label class="field">Nome<input id="pName" type="text" maxlength="40" required></label>
    <button class="btn lg" type="submit">Colocar na lista</button>
  </form>`;

// ---------- Pix copia e cola (padrão BR Code do Banco Central) ----------
function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, "0");
}
const tlv = (id, v) => id + String(v.length).padStart(2, "0") + v;
const asciiUp = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, "").trim().toUpperCase();
function validCPF(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  for (const n of [9, 10]) {
    let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}
function pixKey(k) {
  k = String(k || "").trim();
  if (k.includes("@")) return k.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase();
  const digits = k.replace(/\D/g, "");
  if (k.startsWith("+")) return "+" + digits;
  if (digits.length === 14) return digits; // CNPJ
  if (digits.length === 11 && validCPF(digits)) return digits; // CPF
  if (digits.length === 10 || digits.length === 11) return "+55" + digits; // celular com DDD
  if (digits.length === 12 || digits.length === 13) return "+" + digits;
  return k;
}
function pixCode(l) {
  const acc = tlv("00", "br.gov.bcb.pix") + tlv("01", pixKey(l.pix_key));
  let p = tlv("00", "01") + tlv("26", acc) + tlv("52", "0000") + tlv("53", "986");
  if (Number(l.price) > 0) p += tlv("54", Number(l.price).toFixed(2));
  p += tlv("58", "BR") + tlv("59", (asciiUp(l.pix_name) || "RACHA CRIATIVO").slice(0, 25)) + tlv("60", "BRASIL") + tlv("62", tlv("05", "***")) + "6304";
  return p + crc16(p);
}

// ---------- instalar como app ----------
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// ---------- WhatsApp ----------
function whatsappText(l) {
  const { main, wait, spots } = ordered(l), d = parseDate(l.game_date);
  const tag = (e) => (e.kind === "convidado" ? ` (conv. ${e.invited_by})` : e.kind === "avulso" ? " (avulso)" : "");
  const out = [l.title.toUpperCase(), `${WD[d.getDay()]} (${pad(d.getDate())}/${pad(d.getMonth() + 1)})`, `${hour(l.start_time)}-${hour(l.end_time)}`, ""];
  for (let i = 0; i < spots; i++) { const e = main[i]; out.push(e ? `${i + 1}. ${e.name}${tag(e)}${e.paid === "confirmed" ? " ✅" : ""}` : `${i + 1}. `); }
  out.push("", "espera:");
  wait.forEach((e, i) => out.push(`${i + 1}. ${e.name}${tag(e)}`));
  out.push("", "Entre pelo site: " + location.origin + location.pathname + "#l-" + l.id);
  return out.join("\n");
}
async function copy(text, ok) {
  try { await navigator.clipboard.writeText(text); toast(ok); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(ok); } catch { toast("Não consegui copiar."); }
    ta.remove();
  }
}

// ---------- ações ----------
const findList = (id) => lists.find((x) => x.id === id);
const findEntry = (lid, id) => (entries[lid] || []).find((x) => x.id === id);
async function run(promise, okMsg) {
  const r = await promise;
  if (r && r.error) { toast(errMsg(r.error)); return false; }
  if (okMsg) toast(okMsg);
  scheduleRefresh();
  return true;
}

const actions = {
  authTab: (d) => { authTab = d.tab; render(); },
  adminTab: (d) => { adminTab = d.tab; render(); },
  logout: async () => { closeSheet(); await sb.auth.signOut(); location.hash = ""; },
  join: (d) => run(sb.rpc("join_list", { p_list: d.list }), "Você entrou!"),
  leave: async (d) => { const e = findEntry(d.list, d.id); if (await run(sb.from("entries").delete().eq("id", d.id), (e ? e.name : "") + " saiu da lista.")) closeSheet(); },
  paid: async (d) => { if (await run(sb.rpc("mark_paid", { p_entry: d.id }), "Avisado! O organizador vai confirmar.")) closeSheet(); },
  setPaid: async (d) => { if (await run(sb.from("entries").update({ paid: d.val }).eq("id", d.id), d.val === "confirmed" ? "Pagamento confirmado." : "Marcado como não pago.")) closeSheet(); },
  pix: (d) => { const l = findList(d.list); if (l) openSheet(pixSheet(l)); },
  copyPix: (d) => { const l = findList(d.list); if (l) copy(l.pix_key, "Chave Pix copiada."); },
  copyPixCode: (d) => { const l = findList(d.list); if (l) copy(pixCode(l), "Pix copia e cola copiado. Cole no app do banco."); },
  addPerson: (d) => { const l = findList(d.list); if (l) openSheet(addPersonSheet(l)); },
  teams: (d) => { const l = findList(d.list); if (l) { openSheet(teamsSheet(l)); openTeamsList = l.id; } },
  setTier: async (d) => {
    const key = d.key, t = Number(d.tier), prev = tiers[key];
    tiers[key] = t; refreshTierUI();
    const r = await sb.from("tiers").upsert({ key, tier: t, updated_at: new Date().toISOString() });
    if (r.error) { if (prev) tiers[key] = prev; else delete tiers[key]; refreshTierUI(); toast(errMsg(r.error)); }
  },
  toggleSetter: async (d) => {
    const l = findList(d.list), e = findEntry(d.list, d.id); if (!l || !e) return;
    const val = !e.is_setter;
    e.is_setter = val; $("#sheetBody").innerHTML = teamsSheet(l); // atualiza na hora
    const r = await sb.from("entries").update({ is_setter: val }).eq("id", e.id);
    if (r.error) { e.is_setter = !val; $("#sheetBody").innerHTML = teamsSheet(l); return toast(errMsg(r.error)); }
    if (e.kind === "membro") await sb.from("profiles").update({ is_setter: val }).eq("id", e.user_id); // lembra para a próxima
    scheduleRefresh();
  },
  draw: async (d) => {
    const l = findList(d.list); if (!l) return;
    let teams;
    try { teams = drawTeams(ordered(l).main, teamCount(l), tierOf); } catch (e) { return toast(e.message); }
    if (await run(sb.from("lists").update({ teams, teams_at: new Date().toISOString() }).eq("id", l.id), "Times sorteados!")) {
      l.teams = teams; l.teams_at = new Date().toISOString(); closeSheet(); render();
    }
  },
  clearTeams: async (d) => { if (await run(sb.from("lists").update({ teams: null, teams_at: null }).eq("id", d.list), "Times apagados.")) closeSheet(); },
  copyTeams: (d) => { const l = findList(d.list); if (l && l.teams) copy(teamsText(l), "Times copiados. Cole no grupo!"); },
  resetPw: async (d) => {
    const r = await sb.rpc("admin_reset_password", { p_user: d.id });
    if (r.error) return toast(errMsg(r.error));
    openSheet(`<h2 class="h2">Senha nova de ${esc(d.name)}</h2>
      <div class="pixkey"><code>${esc(r.data)}</code></div>
      <button class="btn lg" data-act="copyText" data-text="${esc(r.data)}">Copiar senha</button>
      <p class="small muted">Mande para a pessoa no privado. Ela entra com o mesmo usuário e essa senha, e depois troca em <b>Minha conta</b>.</p>`);
  },
  copyText: (d) => copy(d.text, "Copiado."),
  install: async () => {
    if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; closeSheet(); return; }
    const help = $("#installHelp"); if (!help) return;
    help.hidden = false;
    help.innerHTML = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? "No iPhone: abra no <b>Safari</b>, toque em <b>Compartilhar</b> (o quadrado com a seta) e depois em <b>Adicionar à Tela de Início</b>."
      : "No Android: abra no <b>Chrome</b>, toque nos <b>três pontinhos</b> e depois em <b>Adicionar à tela inicial</b> ou <b>Instalar app</b>.";
  },
  copy: (d) => { const l = findList(d.list); if (l) copy(whatsappText(l), "Lista copiada. Cole no grupo!"); },
  guest: (d) => { const l = findList(d.list); if (l) openSheet(guestSheet(l)); },
  row: (d) => { const l = findList(d.list), e = findEntry(d.list, d.id); if (l && e) openSheet(rowSheet(l, e)); },
  me: () => openSheet(accountSheet()),
  newList: () => openSheet(listFormHtml(null)),
  editList: (d) => { const l = findList(d.id); if (l) openSheet(listFormHtml(l)); },
  repeatList: (d) => {
    const l = findList(d.id); if (!l) return;
    const copyRow = { title: l.title, game_date: isoDate(addDays(parseDate(l.game_date), 7)), start_time: l.start_time, end_time: l.end_time, spots: l.spots, price: l.price, pix_key: l.pix_key, pix_name: l.pix_name, opens_at: l.opens_at ? new Date(new Date(l.opens_at).getTime() + 7 * 864e5).toISOString() : null };
    run(sb.from("lists").insert(copyRow), "Lista criada para " + pad(parseDate(copyRow.game_date).getDate()) + "/" + pad(parseDate(copyRow.game_date).getMonth() + 1) + ".");
  },
  deleteList: (d) => run(sb.from("lists").delete().eq("id", d.id), "Lista apagada."),
  setStatus: (d) => run(sb.from("profiles").update({ status: d.status }).eq("id", d.id), d.status === "approved" ? "Aprovado." : "Bloqueado."),
  setAdmin: (d) => run(sb.from("profiles").update({ is_admin: d.val === "1" }).eq("id", d.id), d.val === "1" ? "Agora é admin." : "Não é mais admin."),
};

const forms = {
  async login(f) {
    const email = userToEmail($("#lUser").value), password = $("#lPass").value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) toast(errMsg(error));
  },
  async signup(f) {
    const name = clean($("#sName").value), user = $("#sUser").value.trim(), password = $("#sPass").value;
    if (!/^[a-zA-Z0-9._-]{3,24}$/.test(user)) return toast("Usuário: de 3 a 24 caracteres, só letras, números, ponto e traço.");
    if (password.length < 6) return toast("A senha precisa ter pelo menos 6 caracteres.");
    const { data, error } = await sb.auth.signUp({ email: userToEmail(user), password, options: { data: { name } } });
    if (error) return toast(errMsg(error));
    if (!data.session) toast("Conta criada, mas o Supabase pediu confirmação de e-mail. Avise o organizador para desligar isso.");
  },
  async addPerson(f) {
    const name = clean($("#pName").value);
    if (await run(sb.rpc("admin_add_entry", { p_list: f.dataset.list, p_name: name }), name + " foi colocado na lista.")) closeSheet();
  },
  async changePw(f) {
    const password = $("#newPw").value;
    if (password.length < 6) return toast("A senha precisa ter pelo menos 6 caracteres.");
    const { error } = await sb.auth.updateUser({ password });
    if (error) return toast(/same|different/i.test(error.message) ? "Essa já é a sua senha atual." : errMsg(error));
    toast("Senha trocada."); closeSheet();
  },
  async guest(f) {
    const name = clean($("#gName").value);
    if (await run(sb.rpc("add_guest", { p_list: f.dataset.list, p_name: name }), "Convidado adicionado.")) closeSheet();
  },
  async list(f) {
    const opens = $("#fOpens").value;
    const row = {
      title: clean($("#fTitle").value) || "Racha Criativo", game_date: $("#fDate").value,
      spots: Math.max(1, Number($("#fSpots").value) || 18), start_time: $("#fStart").value || "16:00", end_time: $("#fEnd").value || "19:00",
      opens_at: opens ? new Date(opens).toISOString() : null, price: Number($("#fPrice").value) || 0,
      pix_name: $("#fPixName").value.trim(), pix_key: $("#fPix").value.trim(),
    };
    const id = f.dataset.id;
    const ok = await run(id ? sb.from("lists").update(row).eq("id", id) : sb.from("lists").insert(row), id ? "Lista salva." : "Lista criada.");
    if (ok) closeSheet();
  },
};

document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("[data-act], [data-close]");
  if (!t) return;
  if (t.hasAttribute("data-close")) return closeSheet();
  const d = t.dataset;
  if (d.confirm && !d.armed) {
    d.armed = "1"; d.orig = t.innerHTML; t.textContent = d.confirm; t.classList.add("armed");
    setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.innerHTML = d.orig; t.classList.remove("armed"); } }, 3000);
    return;
  }
  const fn = actions[d.act]; if (!fn) return;
  if (t.tagName === "BUTTON") t.disabled = true;
  try { await fn(d, t); } finally { if (t.isConnected && t.tagName === "BUTTON") t.disabled = false; }
});
document.addEventListener("submit", async (ev) => {
  const f = ev.target; if (!f.dataset.form) return;
  ev.preventDefault();
  const b = f.querySelector("button[type=submit]"); if (b) b.disabled = true;
  try { await forms[f.dataset.form](f); } catch (e) { toast(errMsg(e)); } finally { if (b && b.isConnected) b.disabled = false; }
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
window.addEventListener("hashchange", () => { route = parseRoute(); closeSheet(); render(); window.scrollTo(0, 0); });
$("#backBtn").addEventListener("click", () => { location.hash = ""; });
$("#meBtn").addEventListener("click", () => actions.me());

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3200);
}

// contagem regressiva: atualiza só os números; quando zera, redesenha
let needsRedraw = false;
function tick() {
  document.querySelectorAll("[data-cd]").forEach((el) => {
    const left = new Date(el.dataset.cd).getTime() - Date.now();
    el.textContent = countdown(left);
    if (left <= 0) needsRedraw = true;
  });
}
setInterval(() => { tick(); if (needsRedraw) { needsRedraw = false; render(); } }, 1000);

// ---------- início ----------
(async function start() {
  if (!configured) { session = undefined; render(); return; }
  session = undefined; $("#app").innerHTML = viewLoading();
  const { data } = await sb.auth.getSession();
  session = data.session || null;
  sb.auth.onAuthStateChange((_ev, s) => {
    const changed = (s && s.user.id) !== (session && session.user.id);
    session = s || null;
    if (!session) { me = null; meLoaded = false; lists = []; entries = {}; members = []; listsLoaded = false; stopRealtime(); render(); return; }
    if (changed) { meLoaded = false; render(); setTimeout(refresh, 0); startRealtime(); }
  });
  if (session) { startRealtime(); refresh(); } else render();
  setInterval(() => { if (session && document.visibilityState === "visible") refresh(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (session && document.visibilityState === "visible") refresh(); });
})();
