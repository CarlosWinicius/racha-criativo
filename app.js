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
let votes = {}; // { [listId]: { mine, results: [{entry_id, votes}], total, closed } }
let polls = [], pollMine = {}, pollRes = {}, pollWins = []; // votações por tipo
let googleOn = false; // login com Google ligado no Supabase?
let tiers = {}; // só para admins: { "u:<pessoa>": 1..3, "e:<inscrição>": 1..3 }
let route = parseRoute(), authTab = "login", adminTab = "lists";
let channel = null;

function parseRoute() {
  const h = location.hash.slice(1);
  if (h.startsWith("l-")) return { name: "list", id: h.slice(2) };
  if (h === "admin") return { name: "admin" };
  if (h === "ranking") return { name: "ranking" };
  if (h.startsWith("p-")) return { name: "poll", id: h.slice(2) };
  if (h === "numeros") return { name: "numeros" };
  return { name: "home" };
}
const uid = () => session && session.user.id;
const approved = () => me && (me.status === "approved" || me.is_admin);
const realEmail = (e) => (e && !e.endsWith("@" + EMAIL_DOMAIN) ? e : "");

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
      const tIds = lists.filter((x) => Array.isArray(x.teams) && x.teams.length).map((x) => x.id);
      const mnext = {};
      if (tIds.length) {
        const mm = await sb.from("matches").select("*").in("list_id", tIds).order("created_at");
        if (!mm.error) (mm.data || []).forEach((m) => (mnext[m.list_id] = mnext[m.list_id] || []).push(m));
      }
      matches = mnext;
      // votação do melhor do dia (listas com votação aberta ou que fechou há pouco)
      const vnext = {};
      await Promise.all(lists.filter(showVoting).map(async (l) => {
        const [r, m] = await Promise.all([
          sb.rpc("vote_results", { p_list: l.id }),
          sb.from("votes").select("category,entry_id").eq("list_id", l.id).eq("voter", uid()),
        ]);
        const rows = r.data || [], results = {};
        rows.filter((x) => x.entry_id).forEach((x) => (results[x.category] = results[x.category] || []).push({ entry_id: x.entry_id, votes: Number(x.votes) }));
        vnext[l.id] = {
          mine: Object.fromEntries((m.data || []).map((x) => [x.category, x.entry_id])),
          results,
          total: rows.length ? Number(rows[0].total_voters) : 0,
        };
      }));
      votes = vnext;
      await loadPolls();
      checkAchievements();
    }
    if (me && me.is_admin) {
      const m = await sb.from("profiles").select("*").order("created_at");
      if (!m.error) members = m.data || [];
      const t = await sb.from("tiers").select("key,tier");
      if (!t.error) tiers = Object.fromEntries((t.data || []).map((x) => [x.key, x.tier]));
    }
  } catch (e) { toast(errMsg(e)); }
  if ((route.name === "ranking" || route.name === "poll") && approved()) loadRanking();
  if (route.name === "numeros" && approved()) loadNumbers();
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
    .on("postgres_changes", { event: "*", schema: "public", table: "polls" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, scheduleRefresh)
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
// Votação: abre na hora do jogo, fecha no dia seguinte às 23:59 (Brasília, UTC-3)
function voteWindow(l) {
  const opens = new Date(`${l.game_date}T${(l.start_time || "16:00").slice(0, 5)}:00-03:00`).getTime();
  const next = isoDate(addDays(parseDate(l.game_date), 1));
  return { opens, closes: new Date(`${next}T23:59:59-03:00`).getTime() };
}
function votePhase(l) {
  const w = voteWindow(l), now = Date.now();
  return now < w.opens ? "before" : now <= w.closes ? "open" : "closed";
}
// mostra votação/resultado até 3 dias depois de fechar
const showVoting = (l) => votePhase(l) !== "before" && Date.now() - voteWindow(l).closes < 3 * 864e5;
const canVote = (l) => votePhase(l) === "open" && (entries[l.id] || []).some((e) => e.user_id === uid() && e.kind === "membro");
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
  else if (route.name === "ranking") html = viewRanking();
  else if (route.name === "poll") html = viewPoll(route.id);
  else if (route.name === "numeros") html = viewNumbers();
  else html = viewHome();
  $("#app").innerHTML = html;

  for (const id in keep) { const el = document.getElementById(id); if (el && el.type !== "password") el.value = keep[id]; }
  if (focusId) { const el = document.getElementById(focusId); if (el) el.focus(); }
  renderTopbar(); renderBar(); tick();
  if (route.name === "numeros" && numTab === "mes") fillRecap();
  renderPlaylist(!!(configured && session && me && approved() && route.name === "home"));
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
    ${googleOn ? `<button class="btn lg google" data-act="google"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Entrar com Google</button>
    <div class="or"><span>ou</span></div>` : ""}
    <div class="seg" role="tablist">
      <button role="tab" class="${login ? "on" : ""}" data-act="authTab" data-tab="login">Entrar</button>
      <button role="tab" class="${!login ? "on" : ""}" data-act="authTab" data-tab="signup">Criar conta</button>
    </div>
    ${login ? `
    <form data-form="login" class="stack">
      <label class="field">Usuário ou e-mail<input id="lUser" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="seu apelido ou e-mail"></label>
      <label class="field">Senha<input id="lPass" type="password" autocomplete="current-password" required></label>
      <button class="btn lg" type="submit">Entrar</button>
    </form>` : `
    <form data-form="signup" class="stack">
      <label class="field">Seu nome na lista<input id="sName" type="text" maxlength="40" required placeholder="Ex.: Carlos" autocomplete="nickname"></label>
      <label class="field">Usuário ou e-mail<input id="sUser" type="text" maxlength="80" required placeholder="Ex.: carlos.vb ou seu@email.com" autocapitalize="none" spellcheck="false" autocomplete="username"><small>Um apelido (letras, números, ponto e traço) ou o seu e-mail. Você usa para entrar.</small></label>
      <label class="field">Senha<input id="sPass" type="password" minlength="6" required autocomplete="new-password"><small>Pelo menos 6 caracteres.</small></label>
      <div class="notice warn"><b>Não use uma senha de verdade.</b> Nada de senha do e-mail, banco ou Instagram. Crie uma senha só para o vôlei.</div>
      <button class="btn lg" type="submit">Criar conta</button>
      <p class="small muted center">Depois de criar, um organizador precisa aprovar seu acesso.</p>
    </form>`}
  </section>
  <p class="small muted center legal">Ao entrar, você concorda com os <a href="termos.html">Termos de Uso</a> e a <a href="privacidade.html">Política de Privacidade</a>.</p>`;
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
  if (showVoting(l)) {
    const v = votes[l.id];
    if (votePhase(l) === "open") return `<span class="chip me">${v && votedAll(l) ? "você já votou" : "vote nos melhores do dia"}</span>`;
    const top = v && v.results.mvp && v.results.mvp[0];
    const win = top && (entries[l.id] || []).find((e) => e.id === top.entry_id);
    return `<span class="chip ok">${win ? "melhor do dia: " + esc(win.name) : "votação encerrada"}</span>`;
  }
  if (isPast(l)) return `<span class="chip">encerrada</span>`;
  if (mine) return `<span class="chip me">${mine.where === "main" ? "você: nº " + mine.n : "espera: nº " + mine.n}</span>`;
  if (!isOpen(l)) return `<span class="chip warn">abre ${esc(fmtOpen(l.opens_at))}</span>`;
  if (main.length >= spots) return `<span class="chip bad">lotada${wait.length ? " · " + wait.length + " na espera" : ""}</span>`;
  return `<span class="chip ok">aberta</span>`;
}

function viewHome() {
  const up = lists.filter((l) => !isPast(l) || showVoting(l));
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
  <a class="rank-link" href="#ranking"><span aria-hidden="true">🏅</span><span><b>Ranking</b><small>Quem tem mais conquistas no racha</small></span><span class="chev" aria-hidden="true">›</span></a>
  <a class="rank-link" href="#numeros"><span aria-hidden="true">📊</span><span><b>Racha em números</b><small>Presença, placar, caixa e retrospectiva do mês</small></span><span class="chev" aria-hidden="true">›</span></a>
  ${up.length ? `<div class="games">${cards}</div>` : `
  <div class="empty card">
    <figure class="meme"><img src="img/meme.png" alt="Meme rindo"><figcaption>Sem vôlei essa semana?</figcaption></figure>
    <h2 class="h2">Nenhuma lista aberta</h2>
    <p class="muted">${me.is_admin ? "Crie a lista do próximo domingo na área do organizador." : "Os organizadores criam a lista da semana. Ela aparece aqui."}</p>
    ${me.is_admin ? `<a class="btn" href="#admin">Criar lista</a>` : ""}
  </div>`}`;
}

// A playlist fica fora do #app para o player não recarregar (e cortar a música) a cada atualização.
const PLAYLIST_ID = "1Y9FLdFo2epGHk4GyRNrVI";
function renderPlaylist(show) {
  const box = $("#playlist");
  box.hidden = !show;
  const f = box.querySelector("iframe");
  if (show && !f.src) f.src = `https://open.spotify.com/embed/playlist/${PLAYLIST_ID}?utm_source=generator&theme=0`;
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
  ${mvpSection(l)}
  ${teamsSection(l)}
  ${scoreSection(l)}
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
    <a class="btn spotify" href="https://open.spotify.com/playlist/${PLAYLIST_ID}" target="_blank" rel="noopener">Playlist do racha</a>
  </div>`;
}

function renderBar() {
  const bar = $("#bar");
  const l = route.name === "list" && approved() && lists.find((x) => x.id === route.id);
  const hideBar = () => { bar.hidden = true; document.body.classList.remove("has-bar"); };
  if (!l) return hideBar();
  const { main, spots } = ordered(l), mine = myPlace(l);
  let h;
  if (canVote(l) && !votedAll(l)) {
    bar.querySelector(".bar-in").innerHTML = `<button class="btn lg yellow" data-act="vote" data-list="${l.id}">Votar nos melhores do dia</button>`;
    bar.hidden = false; document.body.classList.add("has-bar"); return;
  }
  if (isPast(l)) return hideBar();
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
        <span class="who"><b>${esc(m.name)}</b><small>${realEmail(m.email) ? esc(m.email) + " · " : ""}pediu ${new Date(m.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></span>
        <span class="mini-acts"><button class="btn sm" data-act="setStatus" data-id="${m.id}" data-status="approved">Aprovar</button>
        <button class="btn sm ghost" data-act="setStatus" data-id="${m.id}" data-status="rejected" data-confirm="Recusar?">Recusar</button></span>
      </div></li>`).join("")}</ol>` : `<div class="empty card"><h2 class="h2">Nenhum pedido novo</h2><p class="muted">Quando alguém criar conta, aparece aqui para você aprovar.</p></div>`;
  } else {
    const people = members.filter((m) => m.status !== "pending").sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    body = `<ol class="rows card flush">${people.map((m) => `<li><div class="rowbtn plain">
        <span class="who"><b>${esc(m.name)}</b>${realEmail(m.email) ? `<small>${esc(m.email)}</small>` : ""}${m.is_admin ? ` <span class="pill confirmed">admin</span>` : ""}${m.status === "rejected" ? ` <span class="pill no">bloqueado</span>` : ""}
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
  const viaGoogle = ((session.user.app_metadata || {}).providers || []).includes("google");
  return `<h2 class="h2">${esc(me ? me.name : "Sua conta")}</h2>
  <p class="small muted">${viaGoogle ? "Entra com o Google" : "Usuário"}: ${esc(user)}${me && me.is_admin ? " · organizador" : ""}</p>
  ${medalsHtml()}
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

// ---------- melhores do dia ----------
const CATS = [
  { key: "mvp", name: "Melhor do dia", short: "Melhor", icon: "🏆", ask: "Quem jogou mais hoje?" },
  { key: "ataque", name: "Melhor atacante", short: "Ataque", icon: "💥", ask: "Quem mais pontuou no ataque?" },
  { key: "defesa", name: "Melhor defesa", short: "Defesa", icon: "🧤", ask: "Quem salvou mais bolas?" },
  { key: "bloqueio", name: "Maior bloqueador", short: "Bloqueio", icon: "🧱", ask: "Quem mais parou bola na rede?" },
];
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const votedAll = (l) => { const m = (votes[l.id] || {}).mine || {}; return CATS.every((c) => m[c.key]); };
let voteCat = "mvp";

// vencedor(es) de uma categoria (empate = todos com o máximo de votos)
function catWinners(l, cat) {
  const rs = ((votes[l.id] || {}).results || {})[cat] || [];
  if (!rs.length) return [];
  return rs.filter((r) => r.votes === rs[0].votes);
}

function mvpSection(l) {
  if (!showVoting(l)) return "";
  const v = votes[l.id] || { mine: {}, results: {}, total: 0 };
  const byId = Object.fromEntries((entries[l.id] || []).map((e) => [e.id, e]));
  const nameOf = (id) => (byId[id] ? byId[id].name : "?");
  if (votePhase(l) === "open") {
    const closeDay = addDays(parseDate(l.game_date), 1);
    return `<section class="card mvp">
      <h2 class="h2">Melhores do dia <small>fecha ${WD3[closeDay.getDay()]} às 23:59</small></h2>
      <p><b>${plural(v.total, "pessoa votou", "pessoas votaram")}</b> até agora. O resultado aparece quando a votação fechar.</p>
      ${canVote(l) ? `<ul class="my-votes">${CATS.map((c) => `<li><span>${c.icon} ${c.name}</span>${v.mine[c.key] ? `<b>${esc(nameOf(v.mine[c.key]))}</b>` : `<span class="muted">falta votar</span>`}</li>`).join("")}</ul>
        <button class="btn ${votedAll(l) ? "ghost" : "yellow"}" data-act="vote" data-list="${l.id}">${votedAll(l) ? "Trocar votos" : "Votar"}</button>`
        : `<p class="small muted">Só quem estava na lista pode votar.</p>`}
      ${me.is_admin && Object.keys(v.results).length ? `<p class="small muted">Parcial (só organizadores): ${CATS.map((c) => { const w = catWinners(l, c.key); return w.length ? `${c.short}: ${w.map((r) => esc(nameOf(r.entry_id))).join("/")} (${w[0].votes})` : ""; }).filter(Boolean).join(" · ")}</p>` : ""}
    </section>`;
  }
  const mvp = catWinners(l, "mvp");
  if (!v.total) return `<section class="card mvp"><h2 class="h2">Melhores do dia</h2><p class="muted">Ninguém votou dessa vez.</p></section>`;
  return `<section class="card mvp done">
    ${mvp.length ? `<div class="trophy" aria-hidden="true">🏆</div>
    <span class="eyebrow">${mvp.length > 1 ? "Empate! Melhores do dia" : "Melhor do dia"}</span>
    <h2 class="mvp-name">${mvp.map((r) => esc(nameOf(r.entry_id))).join(" e ")}</h2>
    <p class="small muted">${plural(mvp[0].votes, "voto", "votos")} · ${plural(v.total, "pessoa votou", "pessoas votaram")}</p>` : ""}
    <ul class="awards">${CATS.filter((c) => c.key !== "mvp").map((c) => { const w = catWinners(l, c.key); return `<li><span class="aw-icon" aria-hidden="true">${c.icon}</span><span class="aw-txt"><small>${c.name}</small><b>${w.length ? w.map((r) => esc(nameOf(r.entry_id))).join(" e ") : "sem votos"}</b></span>${w.length ? `<span class="small muted">${plural(w[0].votes, "voto", "votos")}</span>` : ""}</li>`; }).join("")}</ul>
  </section>`;
}

function voteSheet(l) {
  const v = votes[l.id] || { mine: {} };
  const cat = CATS.find((c) => c.key === voteCat) || CATS[0];
  const cands = ordered(l).main.filter((e) => !(e.kind === "membro" && e.user_id === uid()));
  return `<div class="seg four" role="tablist">${CATS.map((c) => `<button role="tab" class="${c.key === cat.key ? "on" : ""}" data-act="voteCat" data-list="${l.id}" data-cat="${c.key}">${v.mine[c.key] ? "✓ " : ""}${c.short}</button>`).join("")}</div>
  <h2 class="h2">${cat.icon} ${cat.name}</h2>
  <p class="small muted">${cat.ask} Toque em um nome. Dá para trocar até a votação fechar, e ninguém vê em quem você votou.</p>
  <div class="vote-grid">${cands.map((e) => `<button type="button" class="vote-opt ${v.mine[cat.key] === e.id ? "on" : ""}" data-act="castVote" data-list="${l.id}" data-id="${e.id}" data-cat="${cat.key}">${esc(e.name)}</button>`).join("")}</div>`;
}

// ---------- conquistas (estilo Hevy) ----------
const GAME_MILESTONES = [1, 5, 10, 25, 50];
const MEDAL_KINDS = [...CATS,
  { key: "levantador", name: "Melhor levantador", icon: "🙌" }, { key: "passe", name: "Melhor passe", icon: "🎯" },
  { key: "saque", name: "Melhor saque", icon: "🚀" }, { key: "time", name: "Melhor time", icon: "👥" },
  { key: "outro", name: "Eleito na votação", icon: "⭐" }];
const pollWinsFor = (id) => pollWins.filter((w) => w.user_id === id).map((w) => ({ category: w.kind, date: w.closes_at, title: w.title }));
let achievements = null; // { wins: [{category, date, title}], games }
function medalsFrom(a) {
  const out = [];
  GAME_MILESTONES.forEach((n) => out.push({ id: "games-" + n, icon: "🏐", name: n === 1 ? "Primeiro racha" : `${n} rachas`, got: a.games >= n, sub: n === 1 ? "Jogou o primeiro" : `Jogou ${n} vezes` }));
  MEDAL_KINDS.forEach((c) => {
    const k = a.wins.filter((w) => w.category === c.key).length;
    out.push({ id: c.key + "-1", icon: c.icon, name: c.name, got: k >= 1, sub: k ? `Ganhou ${plural(k, "vez", "vezes")}` : "Ganhe uma votação" });
    out.push({ id: c.key + "-5", icon: c.icon, name: c.name + " ×5", got: k >= 5, sub: "Ganhe 5 vezes", gold: true });
  });
  return out;
}

// ---------- ranking ----------
let rankingRows = null; // [{ user_id, name, games, mvp, ataque, defesa, bloqueio, medals, wins }]
async function loadRanking() {
  const [r, pw] = await Promise.all([sb.rpc("ranking"), sb.rpc("poll_wins")]);
  if (r.error) { toast(errMsg(r.error)); rankingRows = []; render(); return; }
  if (!pw.error) pollWins = pw.data || [];
  rankingRows = (r.data || []).map((p) => {
    const counts = Object.fromEntries(MEDAL_KINDS.map((c) => [c.key, (Number(p[c.key]) || 0) + pollWins.filter((w) => w.user_id === p.user_id && w.kind === c.key).length]));
    const wins = MEDAL_KINDS.flatMap((c) => Array(counts[c.key]).fill({ category: c.key }));
    return { ...p, ...counts, games: Number(p.games) || 0, wins: wins.length, medals: medalsFrom({ wins, games: Number(p.games) || 0 }).filter((m) => m.got).length };
  }).sort((a, b) => b.medals - a.medals || b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name, "pt-BR"));
  if (route.name === "ranking") render();
}
function viewRanking() {
  if (!rankingRows) return `<section class="intro"><span class="eyebrow">Conquistas</span><h1 class="title">Ranking</h1></section>${pollsSection()}${viewLoading()}`;
  const total = medalsFrom({ wins: [], games: 0 }).length;
  // posição com empate (mesmas medalhas, vitórias e jogos = mesma posição)
  let pos = 0;
  const rows = rankingRows.map((p, i) => {
    const prev = rankingRows[i - 1];
    if (!prev || prev.medals !== p.medals || prev.wins !== p.wins || prev.games !== p.games) pos = i + 1;
    return { ...p, pos };
  });
  const badges = (p) => MEDAL_KINDS.filter((c) => p[c.key]).map((c) => `<span class="rk-b" title="${c.name}">${c.icon}${p[c.key] > 1 ? p[c.key] : ""}</span>`).join("");
  const podium = rows.slice(0, 3).filter((p) => p.medals > 0);
  return `<section class="intro"><span class="eyebrow">Conquistas</span><h1 class="title">Ranking</h1>
    <p class="small muted">Quem tem mais medalhas fica na frente. Empate: mais vitórias nas votações, depois mais jogos.</p></section>
  ${pollsSection()}
  ${podium.length ? `<div class="rk-podium">${podium.map((p) => `<div class="rk-p rk-${p.pos} ${p.user_id === uid() ? "me" : ""}">
      <span class="rk-medal" aria-hidden="true">${["🥇", "🥈", "🥉"][p.pos - 1] || "🏅"}</span>
      <b>${esc(p.name)}</b><small>${plural(p.medals, "medalha", "medalhas")}</small><span class="rk-badges">${badges(p)}</span>
    </div>`).join("")}</div>` : `<div class="empty card"><h2 class="h2">Ninguém pontuou ainda</h2><p class="muted">As medalhas aparecem depois do primeiro jogo e da primeira votação.</p></div>`}
  <p class="small muted center">Toque em alguém para ver as medalhas.</p>
  <ol class="rows card flush">${rows.map((p) => `<li class="${p.user_id === uid() ? "mine" : ""}"><button type="button" class="rowbtn rk-row" data-act="personMedals" data-id="${p.user_id}">
      <span class="num">${p.pos}</span>
      <span class="who"><b>${esc(p.name)}</b><small>${plural(p.games, "jogo", "jogos")}${p.wins ? " · " + plural(p.wins, "vitória", "vitórias") : ""}</small></span>
      <span class="rk-badges">${badges(p)}</span>
      <span class="rk-count" title="medalhas de ${total}"><b>${p.medals}</b><small>/${total}</small></span>
    </button></li>`).join("")}</ol>`;
}
function personMedalsSheet(p) {
  const wins = MEDAL_KINDS.flatMap((c) => Array(p[c.key] || 0).fill({ category: c.key }));
  return `<h2 class="h2">${esc(p.name)}</h2>
  <p class="small muted">${plural(p.games, "jogo", "jogos")} · ${plural(p.wins, "vitória", "vitórias")} nas votações</p>
  ${medalsHtml({ wins, games: p.games }, "Conquistas")}`;
}

// ---------- votações por tipo (link para o grupo) ----------
const POLL_KINDS = [
  { key: "mvp", name: "Melhor jogador", icon: "🏆" },
  { key: "ataque", name: "Melhor ataque", icon: "💥" },
  { key: "levantador", name: "Melhor levantador", icon: "🙌" },
  { key: "bloqueio", name: "Melhor bloqueio", icon: "🧱" },
  { key: "passe", name: "Melhor passe", icon: "🎯" },
  { key: "defesa", name: "Melhor defesa", icon: "🧤" },
  { key: "saque", name: "Melhor saque", icon: "🚀" },
  { key: "time", name: "Melhor time", icon: "👥" },
  { key: "outro", name: "Outra", icon: "⭐" },
];
const pollKind = (k) => POLL_KINDS.find((x) => x.key === k) || POLL_KINDS[POLL_KINDS.length - 1];
const pollOpen = (p) => Date.now() <= new Date(p.closes_at).getTime();
const pollUrl = (p) => location.origin + location.pathname + "#p-" + p.id;
const findPoll = (id) => polls.find((x) => x.id === id);
const fmtWhen = (iso) => { const d = new Date(iso); return `${WD3[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
let pollQ = "";

async function loadPolls() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const r = await sb.from("polls").select("*").gte("closes_at", since).order("created_at", { ascending: false });
  if (r.error) { polls = []; return; } // tabela ainda não criada
  polls = r.data || [];
  const [m] = await Promise.all([
    sb.from("poll_votes").select("poll_id,target").eq("voter", uid()),
    ...polls.map(async (p) => {
      const x = await sb.rpc("poll_results", { p_poll: p.id });
      const rows = x.data || [];
      pollRes[p.id] = { rows: rows.filter((y) => y.target).map((y) => ({ target: y.target, votes: Number(y.votes) })), total: rows.length ? Number(rows[0].total_voters) : 0 };
    }),
  ]);
  pollMine = Object.fromEntries(((m && m.data) || []).map((x) => [x.poll_id, x.target]));
}

// candidatos: times do jogo, quem jogou naquele jogo, ou todo mundo aprovado
function pollCands(p) {
  const l = p.list_id && findList(p.list_id);
  if (p.kind === "time") {
    if (!l || !Array.isArray(l.teams)) return [];
    const byId = Object.fromEntries((entries[l.id] || []).map((e) => [e.id, e]));
    return l.teams.map((t, i) => ({ id: "team:" + i, name: TEAM_STYLES[i % TEAM_STYLES.length].name, sub: [t.setter, ...t.players].map((id) => (byId[id] ? byId[id].name : "?")).join(", ") }));
  }
  if (l) return ordered(l).main.filter((e) => e.kind === "membro").map((e) => ({ id: e.user_id, name: e.name }));
  return (rankingRows || []).map((r) => ({ id: r.user_id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
function pollName(p, target) {
  const c = pollCands(p).find((x) => x.id === target);
  if (c) return c.name;
  const r = (rankingRows || []).find((x) => x.user_id === target);
  return r ? r.name : "?";
}
function pollWinnersOf(p) {
  const rs = (pollRes[p.id] || {}).rows || [];
  return rs.length ? rs.filter((r) => r.votes === rs[0].votes) : [];
}

function pollsSection() {
  const list = polls.slice(0, 12);
  if (!list.length && !me.is_admin) return "";
  return `<section class="card polls">
    <h2 class="h2">Votações <small>escolha os melhores</small></h2>
    ${list.length ? `<ul class="poll-list">${list.map((p) => {
      const k = pollKind(p.kind), open = pollOpen(p), w = open ? [] : pollWinnersOf(p);
      const status = open ? (pollMine[p.id] ? `<span class="chip ok">você votou</span>` : `<span class="chip me">votar</span>`)
        : `<span class="small muted pw">${w.length ? "🏆 " + w.map((r) => esc(pollName(p, r.target))).join(" e ") : "sem votos"}</span>`;
      return `<li><a href="#p-${p.id}" class="poll-item"><span class="pk-icon" aria-hidden="true">${k.icon}</span>
        <span class="who"><b>${esc(p.title)}</b><small>${open ? "fecha " + esc(fmtWhen(p.closes_at)) : "encerrada"}</small></span>${status}</a></li>`;
    }).join("")}</ul>` : `<p class="small muted">Nenhuma votação ainda. Crie uma e mande o link no grupo.</p>`}
    ${me.is_admin ? `<button class="btn yellow" data-act="newPoll">+ Nova votação</button>` : ""}
  </section>`;
}

function viewPoll(id) {
  const p = findPoll(id);
  if (!p) return listsLoaded ? `<div class="empty"><h1 class="title">Votação não encontrada</h1><p class="muted">Ela pode ter sido apagada ou já é antiga.</p><a class="btn ghost" href="#ranking">Ver votações</a></div>` : viewLoading();
  const k = pollKind(p.kind), open = pollOpen(p), res = pollRes[p.id] || { rows: [], total: 0 };
  const l = p.list_id && findList(p.list_id);
  const mine = pollMine[p.id];
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cands = pollCands(p).filter((c) => c.id !== uid());
  const shown = cands.filter((c) => !pollQ || norm(c.name).includes(norm(pollQ)));
  const head = `<section class="intro"><span class="eyebrow">${k.icon} Votação${l ? " · " + esc(l.title) + " " + pad(parseDate(l.game_date).getDate()) + "/" + pad(parseDate(l.game_date).getMonth() + 1) : ""}</span>
    <h1 class="title">${esc(p.title)}</h1>
    <p class="small muted">${open ? "Fecha " + esc(fmtWhen(p.closes_at)) + ". O resultado aparece quando fechar." : "Encerrada " + esc(fmtWhen(p.closes_at)) + "."} ${plural(res.total, "pessoa votou", "pessoas votaram")}.</p></section>`;
  const share = `<div class="tools"><button class="btn ghost" data-act="sharePoll" data-id="${p.id}">Copiar link p/ WhatsApp</button>
    ${me.is_admin && open ? `<button class="btn ghost" data-act="closePoll" data-id="${p.id}" data-confirm="Encerrar agora?">Encerrar agora</button>` : ""}
    ${me.is_admin ? `<button class="btn ghost danger-txt" data-act="deletePoll" data-id="${p.id}" data-confirm="Apagar votação?">Apagar</button>` : ""}</div>`;
  const bars = (rows) => { const max = rows.length ? rows[0].votes : 1; return `<ul class="poll-bars">${rows.map((r) => `<li class="${r.votes === rows[0].votes ? "win" : ""}"><span class="pb-name">${esc(pollName(p, r.target))}</span><span class="pb-bar"><i style="width:${Math.round((r.votes / max) * 100)}%"></i></span><b>${r.votes}</b></li>`).join("")}</ul>`; };
  if (!open) {
    const w = pollWinnersOf(p);
    return `${head}<section class="card mvp done">
      ${w.length ? `<div class="trophy" aria-hidden="true">${k.icon}</div><span class="eyebrow">${w.length > 1 ? "Empate!" : "Vencedor"}</span>
      <h2 class="mvp-name">${w.map((r) => esc(pollName(p, r.target))).join(" e ")}</h2>
      <p class="small muted">${plural(w[0].votes, "voto", "votos")}</p>` : `<p class="muted">Ninguém votou.</p>`}
      ${res.rows.length > 1 ? bars(res.rows) : ""}
    </section>${share}`;
  }
  return `${head}
  <section class="card">
    ${mine ? `<div class="notice ok">Seu voto: <b>${esc(pollName(p, mine))}</b>. Dá para trocar até fechar. Ninguém vê em quem você votou.</div>` : `<p class="small muted">Toque em ${p.kind === "time" ? "um time" : "um nome"} para votar. Ninguém vê em quem você votou.</p>`}
    ${p.kind === "time" || cands.length < 10 ? "" : `<label class="field">Buscar<input id="pollSearch" type="search" value="${esc(pollQ)}" placeholder="Nome" autocomplete="off" data-pollsearch="${p.id}"></label>`}
    <div class="vote-grid ${p.kind === "time" ? "teams-vote" : ""}" id="pollGrid">${shown.length ? shown.map((c) => `<button type="button" class="vote-opt ${mine === c.id ? "on" : ""}" data-act="castPoll" data-id="${p.id}" data-target="${c.id}">${esc(c.name)}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</button>`).join("")
      : `<p class="small muted">${p.kind === "time" ? "Os times desse jogo ainda não foram sorteados." : pollQ ? "Ninguém com esse nome." : "Carregando…"}</p>`}</div>
    ${me.is_admin && res.rows.length ? `<h3 class="h3">Parcial <small>só organizadores</small></h3>${bars(res.rows)}` : ""}
  </section>${share}`;
}
document.addEventListener("input", (ev) => {
  const t = ev.target; if (!t.dataset || !t.dataset.pollsearch) return;
  pollQ = t.value;
  const tmp = document.createElement("div"); tmp.innerHTML = viewPoll(t.dataset.pollsearch);
  const g = tmp.querySelector("#pollGrid"); if (g) $("#pollGrid").replaceWith(g);
});

function pollFormHtml() {
  const d = addDays(new Date(), 2); d.setHours(23, 59, 0, 0);
  const games = lists.filter((l) => (entries[l.id] || []).length).slice().reverse();
  return `<h2 class="h2">Nova votação</h2>
  <p class="small muted">Depois de criar, o link é copiado. Cole no grupo e a galera vota pelo site.</p>
  <form data-form="poll" class="stack">
    <div class="field">Tipo<div class="kind-grid">${POLL_KINDS.map((k, i) => `<label class="kind-opt"><input type="radio" name="pKind" value="${k.key}" ${i === 0 ? "checked" : ""}><span>${k.icon} ${k.name}</span></label>`).join("")}</div></div>
    <label class="field">Título<input id="pTitle" type="text" maxlength="60" placeholder="Ex.: Melhor levantador de novembro"><small>Se deixar vazio, usa o nome do tipo.</small></label>
    <label class="field">Quem pode ser votado
      <select id="pList"><option value="">Todo mundo que tem conta</option>${games.map((l) => `<option value="${l.id}">Quem jogou ${esc(l.title)} ${pad(parseDate(l.game_date).getDate())}/${pad(parseDate(l.game_date).getMonth() + 1)}${Array.isArray(l.teams) && l.teams.length ? " (tem times)" : ""}</option>`).join("")}</select>
      <small>Para <b>Melhor time</b>, escolha um jogo que já teve sorteio de times.</small></label>
    <label class="field">Fecha em<input id="pCloses" type="datetime-local" required value="${toLocalInput(d.toISOString())}"></label>
    <button class="btn lg yellow" type="submit">Criar e copiar link</button>
  </form>`;
}

async function checkAchievements() {
  const [r, pw] = await Promise.all([sb.rpc("my_achievements"), sb.rpc("poll_wins")]);
  if (r.error || !r.data) return;
  if (!pw.error) pollWins = pw.data || [];
  achievements = { ...r.data, wins: [...(r.data.wins || []), ...pollWinsFor(uid())] };
  const got = medalsFrom(achievements).filter((m) => m.got).map((m) => m.id);
  let seen = null; try { seen = JSON.parse(localStorage.getItem("racha-medals-" + uid())); } catch {}
  if (seen) {
    const fresh = medalsFrom(achievements).filter((m) => m.got && !seen.includes(m.id));
    if (fresh.length) toast(`${fresh[0].icon} Conquista desbloqueada: ${fresh[0].name}!${fresh.length > 1 ? ` (+${fresh.length - 1})` : ""}`);
  }
  try { localStorage.setItem("racha-medals-" + uid(), JSON.stringify(got)); } catch {}
}
function medalsHtml(a = achievements, title = "Minhas conquistas") {
  if (!a) return `<p class="small muted">Carregando conquistas…</p>`;
  const ms = medalsFrom(a), n = ms.filter((m) => m.got).length;
  return `<h3 class="h3">${title} <small>${n} de ${ms.length}</small></h3>
  <div class="medals">${ms.map((m) => `<div class="medal ${m.got ? "got" : ""} ${m.gold ? "gold" : ""}" title="${esc(m.sub)}"><span class="m-icon" aria-hidden="true">${m.icon}</span><b>${esc(m.name)}</b><small>${esc(m.sub)}</small></div>`).join("")}</div>`;
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
  ${(matches[l.id] || []).length ? `<p class="small muted center">Sortear de novo ou apagar os times também apaga o placar desse jogo.</p>` : ""}
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

// ---------- placar e rodízio (vencedor fica, perdedor vai para o fim da fila) ----------
let matches = {}; // { [listId]: [{ team_a, team_b, score_a, score_b, created_at }] }
const teamName = (i) => TEAM_STYLES[i % TEAM_STYLES.length].name;
const teamShort = (i) => teamName(i).replace("Time ", "");
function rotation(l) {
  const n = l.teams.length;
  const ms = (matches[l.id] || []).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  let court = [0, 1]; const queue = [];
  for (let i = 2; i < n; i++) queue.push(i);
  const wins = Array(n).fill(0), played = Array(n).fill(0);
  for (const m of ms) {
    const w = m.score_a > m.score_b ? m.team_a : m.team_b, lo = w === m.team_a ? m.team_b : m.team_a;
    if (w >= n || lo >= n) continue;
    wins[w]++; played[w]++; played[lo]++;
    const qi = queue.indexOf(w); if (qi >= 0) queue.splice(qi, 1);
    const qj = queue.indexOf(lo); if (qj >= 0) queue.splice(qj, 1);
    court.filter((t) => t !== w && t !== lo).forEach((t) => queue.unshift(t));
    if (queue.length) { queue.push(lo); court = [w, queue.shift()]; } else court = [w, lo];
  }
  return { court, queue, wins, played, ms };
}
const canScore = (l) => me.is_admin || (entries[l.id] || []).some((e) => e.user_id === uid() && e.kind === "membro");
const scoreDay = (l) => l.game_date <= todayISO() && l.game_date >= isoDate(addDays(new Date(), -1));
function liveScore(id) { try { return JSON.parse(localStorage.getItem("racha-score-" + id)) || { a: 0, b: 0 }; } catch { return { a: 0, b: 0 }; } }
function saveLive(id, s) { try { localStorage.setItem("racha-score-" + id, JSON.stringify(s)); } catch {} }

function scoreSection(l) {
  if (!Array.isArray(l.teams) || l.teams.length < 2 || l.game_date > todayISO()) return "";
  const r = rotation(l), live = liveScore(l.id), edit = scoreDay(l) && canScore(l);
  const [a, b] = r.court;
  const side = (t, k, v) => `<button type="button" class="side ${TEAM_STYLES[t % TEAM_STYLES.length].cls}" ${edit ? `data-act="pt" data-list="${l.id}" data-side="${k}"` : "disabled"} aria-label="Ponto para ${teamName(t)}"><span>${teamShort(t)}</span><b>${v}</b></button>`;
  return `<section class="card scoreboard">
    <h2 class="h2">Placar <small>vencedor fica, perdedor sai</small></h2>
    ${edit ? `<div class="court">${side(a, "a", live.a)}<span class="x">×</span>${side(b, "b", live.b)}</div>
    <div class="tools">
      <button class="btn sm ghost" data-act="ptMinus" data-list="${l.id}" data-side="a">−1 ${teamShort(a)}</button>
      <button class="btn sm ghost" data-act="ptMinus" data-list="${l.id}" data-side="b">−1 ${teamShort(b)}</button>
      <button class="btn yellow" data-act="endSet" data-list="${l.id}">Fim do set</button>
    </div>
    <p class="small muted">Toque no time para marcar ponto. ${r.queue.length ? `Próximo a entrar: <b>${teamName(r.queue[0])}</b>${r.queue.length > 1 ? ` (depois: ${r.queue.slice(1).map(teamShort).join(", ")})` : ""}.` : ""}</p>`
    : `<p class="small muted">${r.ms.length ? "" : "Ninguém anotou o placar desse jogo."}</p>`}
    ${r.ms.length ? `<h3 class="h3">Sets <small>${l.teams.map((_, i) => `${teamShort(i)} ${r.wins[i]}`).join(" · ")}</small></h3>
    <ol class="sets">${r.ms.map((m) => `<li><span><b class="${m.score_a > m.score_b ? "w" : ""}">${teamShort(m.team_a)} ${m.score_a}</b> × <b class="${m.score_b > m.score_a ? "w" : ""}">${m.score_b} ${teamShort(m.team_b)}</b></span>
      ${me.is_admin || m.created_by === uid() ? `<button class="btn sm ghost danger-txt" data-act="delMatch" data-id="${m.id}" data-confirm="Apagar set?">Apagar</button>` : ""}</li>`).join("")}</ol>` : ""}
  </section>`;
}

// ---------- racha em números ----------
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
const monthLabel = (k) => { const [y, m] = k.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
let numTab = "presenca", numMonth = monthKey(new Date());
const stats = { players: null, cash: null, cashRows: [], board: {}, recap: {} };

async function loadNumbers() {
  const [ps, cs, cr] = await Promise.all([sb.rpc("player_stats"), sb.rpc("cash_summary"), sb.from("cash").select("*").order("day", { ascending: false })]);
  stats.players = ps.error ? [] : ps.data || [];
  stats.cash = cs.error ? null : (cs.data || [])[0] || null;
  stats.cashRows = cr.error ? [] : (cr.data || []).sort((a, b) => (a.day < b.day ? 1 : -1));
  await loadMonth(numMonth);
  if (route.name === "numeros") render();
}
async function loadMonth(m) {
  const [b, r] = await Promise.all([sb.rpc("month_board", { p_month: m }), sb.rpc("month_recap", { p_month: m })]);
  stats.board[m] = b.error ? [] : (b.data || []).map((x) => ({ ...x, wins: Number(x.wins), played: Number(x.played) }));
  stats.recap[m] = r.error ? null : r.data;
}

function monthNav() {
  const cur = monthKey(new Date());
  return `<div class="month-nav"><button class="btn sm ghost" data-act="numMonth" data-dir="-1" aria-label="Mês anterior">‹</button>
    <b>${monthLabel(numMonth)}</b>
    <button class="btn sm ghost" data-act="numMonth" data-dir="1" aria-label="Próximo mês" ${numMonth >= cur ? "disabled" : ""}>›</button></div>`;
}

function viewNumbers() {
  const tabs = [["presenca", "Presença"], ["placar", "Placar"], ["caixa", "Caixa"], ["mes", "Mês"]];
  let body = viewLoading();
  if (stats.players) {
    if (numTab === "presenca") body = numPresence();
    else if (numTab === "placar") body = numBoard();
    else if (numTab === "caixa") body = numCash();
    else body = numRecap();
  }
  return `<section class="intro"><span class="eyebrow">Estatísticas</span><h1 class="title">Racha em números</h1></section>
  <div class="seg four" role="tablist">${tabs.map(([k, n]) => `<button role="tab" class="${numTab === k ? "on" : ""}" data-act="numTab" data-tab="${k}">${n}</button>`).join("")}</div>
  ${body}`;
}

function numPresence() {
  const rows = stats.players.map((p) => ({ ...p, games: Number(p.games), last12: Number(p.last12), late: Number(p.late_drops), total: Number(p.total_lists) }))
    .sort((a, b) => b.last12 - a.last12 || b.games - a.games || a.name.localeCompare(b.name, "pt-BR"));
  const total = rows.length ? rows[0].total : 0;
  if (!total) return `<div class="empty card"><h2 class="h2">Ainda sem jogos</h2><p class="muted">A presença aparece depois do primeiro jogo.</p></div>`;
  const weeks = (d) => d ? Math.floor((Date.now() - parseDate(d).getTime()) / (7 * 864e5)) : null;
  return `<p class="small muted">Quantas vezes cada um jogou nos últimos ${plural(total, "jogo", "jogos")} (só conta quem estava dentro das vagas). <b>Em cima da hora</b> = saiu da lista menos de 24h antes do jogo.</p>
  <ol class="rows card flush">${rows.map((p) => {
    const w = weeks(p.last_game), gone = w === null || w >= 3;
    return `<li class="${p.user_id === uid() ? "mine" : ""}"><div class="rowbtn plain pres">
      <span class="who"><b>${esc(p.name)}</b><small>${p.games ? `${plural(p.games, "jogo", "jogos")} no total` : "nunca jogou"}${p.late ? ` · <span class="late">${plural(p.late, "desistência", "desistências")} em cima da hora</span>` : ""}</small>
        <span class="pbar" aria-hidden="true"><i style="width:${Math.round((p.last12 / total) * 100)}%"></i></span></span>
      <span class="pres-n"><b>${p.last12}</b><small>/${total}</small>${gone ? `<span class="chip warn">${w === null ? "nunca veio" : `sumido ${w} sem.`}</span>` : ""}</span>
    </div></li>`;
  }).join("")}</ol>`;
}

function numBoard() {
  const b = (stats.board[numMonth] || []).slice().sort((x, y) => y.wins - x.wins || y.wins / y.played - x.wins / x.played || x.name.localeCompare(y.name, "pt-BR"));
  return `${monthNav()}
  ${stats.board[numMonth] === undefined ? viewLoading() : b.length ? `<p class="small muted">Sets vencidos no mês. Cada set anotado no placar do jogo conta para todo mundo do time.</p>
  <ol class="rows card flush">${b.map((p, i) => `<li class="${p.user_id === uid() ? "mine" : ""}"><div class="rowbtn plain brow">
    <span class="num">${i + 1}</span><span class="who"><b>${esc(p.name)}</b><small>${plural(p.wins, "vitória", "vitórias")} em ${plural(p.played, "set", "sets")}</small></span>
    <span class="rk-count"><b>${p.played ? Math.round((p.wins / p.played) * 100) : 0}%</b></span></div></li>`).join("")}</ol>`
  : `<div class="empty card"><h2 class="h2">Nenhum set anotado</h2><p class="muted">No dia do jogo, abra a lista e use o <b>Placar</b> embaixo dos times.</p></div>`}`;
}

function numCash() {
  const c = stats.cash;
  if (!c) return `<div class="empty card"><p class="muted">Não consegui carregar o caixa.</p></div>`;
  const rec = Number(c.received), pend = Number(c.pending), mi = Number(c.manual_in), mo = Number(c.manual_out);
  const owing = me.is_admin ? lists.filter((l) => l.game_date <= todayISO() && Number(l.price) > 0)
    .flatMap((l) => ordered(l).main.filter((e) => e.paid !== "confirmed").map((e) => ({ e, l }))) : [];
  return `<section class="card cash">
    <span class="eyebrow">Saldo do caixa</span>
    <b class="cash-total ${rec + mi - mo < 0 ? "neg" : ""}">${money(rec + mi - mo)}</b>
    <ul class="cash-lines">
      <li><span>Pagamentos confirmados</span><b class="pos">+ ${money(rec)}</b></li>
      ${mi ? `<li><span>Outras entradas</span><b class="pos">+ ${money(mi)}</b></li>` : ""}
      <li><span>Gastos</span><b class="neg">− ${money(mo)}</b></li>
      <li class="muted"><span>Falta receber</span><b>${money(pend)} <small>(${plural(Number(c.pending_people), "pessoa", "pessoas")})</small></b></li>
    </ul>
  </section>
  ${me.is_admin ? `<section class="card">
    <h2 class="h2">Lançar</h2>
    <form data-form="cash" class="stack">
      <div class="seg"><label class="kind-opt"><input type="radio" name="cKind" value="out" checked><span>Gasto</span></label><label class="kind-opt"><input type="radio" name="cKind" value="in"><span>Entrada</span></label></div>
      <label class="field">Valor (R$)<input id="cAmount" type="number" inputmode="decimal" min="0.01" step="0.01" required placeholder="Ex.: 240"></label>
      <label class="field">Descrição<input id="cDesc" type="text" maxlength="80" required placeholder="Ex.: Aluguel da quadra, bola nova"></label>
      <label class="field">Data<input id="cDay" type="date" required value="${todayISO()}"></label>
      <button class="btn lg" type="submit">Lançar</button>
    </form>
  </section>` : ""}
  <section class="card">
    <h2 class="h2">Lançamentos</h2>
    ${stats.cashRows.length ? `<ul class="cash-rows">${stats.cashRows.map((r) => `<li><span class="who"><b>${esc(r.description)}</b><small>${pad(parseDate(r.day).getDate())}/${pad(parseDate(r.day).getMonth() + 1)}/${parseDate(r.day).getFullYear()}</small></span>
      <b class="${r.kind === "in" ? "pos" : "neg"}">${r.kind === "in" ? "+" : "−"} ${money(r.amount)}</b>
      ${me.is_admin ? `<button class="btn sm ghost danger-txt" data-act="delCash" data-id="${r.id}" data-confirm="Apagar?">✕</button>` : ""}</li>`).join("")}</ul>`
    : `<p class="small muted">Nenhum gasto ou entrada lançado ainda.${me.is_admin ? " Lance o aluguel da quadra, bolas, etc." : ""}</p>`}
  </section>
  ${me.is_admin && owing.length ? `<section class="card"><h2 class="h2">Quem falta pagar <small>últimos jogos</small></h2>
    <ul class="cash-rows">${owing.map(({ e, l }) => `<li><span class="who"><b>${esc(e.name)}</b><small>${esc(l.title)} ${pad(parseDate(l.game_date).getDate())}/${pad(parseDate(l.game_date).getMonth() + 1)}${e.paid === "informed" ? " · disse que pagou" : ""}</small></span>
      <b>${money(l.price)}</b><button class="btn sm ${e.paid === "informed" ? "" : "ghost"}" data-act="setPaid" data-id="${e.id}" data-val="confirmed">Confirmar</button></li>`).join("")}</ul></section>` : ""}`;
}

function numRecap() {
  const r = stats.recap[numMonth];
  return `${monthNav()}
  ${r === undefined ? viewLoading() : !r || !Number(r.games) ? `<div class="empty card"><h2 class="h2">Sem jogos nesse mês</h2><p class="muted">A retrospectiva aparece depois que tiver jogo no mês.</p></div>`
  : `<img id="recapImg" class="recap-img" alt="Retrospectiva de ${monthLabel(numMonth)}">
  <div class="tools"><button class="btn lg yellow" data-act="shareRecap">Compartilhar no grupo</button></div>
  <p class="small muted center">No celular abre o menu de compartilhar. No computador, baixa a imagem.</p>`}`;
}

// card 1080x1350 desenhado no canvas
function drawRecap(m) {
  const r = stats.recap[m];
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1350;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 1080, 1350); g.addColorStop(0, "#1d47c8"); g.addColorStop(1, "#0c1a52");
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  x.strokeStyle = "rgba(255,255,255,.08)"; x.lineWidth = 6;
  x.strokeRect(60, 60, 960, 1230); x.beginPath(); x.moveTo(60, 675); x.lineTo(1020, 675); x.stroke();
  x.fillStyle = "#f7c600"; x.fillRect(90, 110, 140, 12);
  const D = "'Barlow Condensed', 'Arial Narrow', sans-serif", B = "Inter, system-ui, sans-serif";
  const fit = (t, max, size, weight, fam) => { let s = size; do { x.font = `${weight} ${s}px ${fam}`; s -= 2; } while (x.measureText(t).width > max && s > 20); return t; };
  x.fillStyle = "#fff"; x.textBaseline = "alphabetic";
  x.font = `700 40px ${B}`; x.fillStyle = "rgba(255,255,255,.75)"; x.fillText("RACHA CRIATIVO · RETROSPECTIVA", 90, 180);
  x.fillStyle = "#fff"; fit(monthLabel(m).toUpperCase(), 900, 130, 800, D); x.fillText(monthLabel(m).toUpperCase(), 90, 310);
  const nums = [[r.games, Number(r.games) === 1 ? "jogo" : "jogos"], [r.sets, Number(r.sets) === 1 ? "set" : "sets"], [r.players, "jogadores"]];
  nums.forEach(([n, lab], i) => {
    const cx = 90 + i * 310;
    x.fillStyle = "#f7c600"; x.font = `800 110px ${D}`; x.fillText(String(n), cx, 450);
    x.fillStyle = "rgba(255,255,255,.8)"; x.font = `600 34px ${B}`; x.fillText(lab, cx, 500);
  });
  const names = (arr) => arr.map((p) => p.name).join(" e ");
  const blocks = [
    ["🏆", "Melhor do mês", r.best, (p) => `${p.n} ${p.n === 1 ? "vitória" : "vitórias"} nas votações`],
    ["🙋", "Mais presente", r.present, (p) => `${p.n} ${p.n === 1 ? "jogo" : "jogos"}`],
    ["👑", "Rei da quadra", r.king, (p) => `${p.n} sets vencidos de ${p.p}`],
  ];
  let y = 640;
  blocks.forEach(([icon, label, arr, sub]) => {
    x.font = `80px ${B}`; x.fillText(icon, 90, y + 20);
    x.fillStyle = "rgba(255,255,255,.7)"; x.font = `700 32px ${B}`; x.fillText(label.toUpperCase(), 210, y - 30);
    x.fillStyle = "#fff";
    if (arr && arr.length) {
      const t = names(arr); fit(t, 780, 76, 800, D); x.fillText(t, 210, y + 40);
      x.fillStyle = "#f7c600"; x.font = `600 32px ${B}`; x.fillText(sub(arr[0]), 210, y + 90);
    } else { x.fillStyle = "rgba(255,255,255,.5)"; x.font = `600 44px ${B}`; x.fillText("ninguém ainda", 210, y + 30); }
    x.fillStyle = "#fff"; y += 210;
  });
  x.fillStyle = "rgba(255,255,255,.6)"; x.font = `600 30px ${B}`; x.fillText("Vôlei de domingo · " + location.host + location.pathname.replace(/\/$/, ""), 90, 1260);
  return c;
}
async function fillRecap() {
  const img = $("#recapImg"); if (!img) return;
  try { await document.fonts.ready; } catch {}
  img.src = drawRecap(numMonth).toDataURL("image/png");
}

function addPersonSheet(l, q = "") {
  const inList = new Set((entries[l.id] || []).filter((e) => e.kind === "membro").map((e) => e.user_id));
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const people = members.filter((m) => m.status === "approved" && !inList.has(m.id) && norm(m.name).includes(norm(q)))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return `<h2 class="h2">Colocar pessoa na lista</h2>
  <p class="small muted">Toque em quem tem conta no app. A pessoa entra na ordem de agora, como se tivesse entrado sozinha, e pode sair, pagar e votar.</p>
  <label class="field">Buscar<input id="pSearch" type="search" value="${esc(q)}" placeholder="Nome" autocomplete="off" data-search="${l.id}"></label>
  <div class="vote-grid" id="pResults">${people.length
    ? people.map((m) => `<button type="button" class="vote-opt" data-act="addMember" data-list="${l.id}" data-id="${m.id}" data-name="${esc(m.name)}">${esc(m.name)}</button>`).join("")
    : `<p class="small muted">${q ? "Ninguém com esse nome (ou já está na lista)." : "Todo mundo que tem conta já está na lista."}</p>`}</div>
  <details class="stack">
    <summary class="small muted" style="cursor:pointer">Não tem conta? Colocar só o nome</summary>
    <form data-form="addPerson" data-list="${l.id}" class="stack" style="margin-top:10px">
      <label class="field">Nome<input id="pName" type="text" maxlength="40" required></label>
      <button class="btn lg ghost" type="submit">Colocar na lista</button>
    </form>
  </details>`;
}
// busca ao digitar, sem perder o foco do campo
document.addEventListener("input", (ev) => {
  const t = ev.target; if (!t.dataset || !t.dataset.search) return;
  const l = findList(t.dataset.search); if (!l) return;
  const tmp = document.createElement("div"); tmp.innerHTML = addPersonSheet(l, t.value);
  $("#pResults").replaceWith(tmp.querySelector("#pResults"));
});

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
function pollShareText(p) {
  const k = pollKind(p.kind);
  return `${k.icon} VOTAÇÃO: ${p.title.toUpperCase()}\nVote aqui: ${pollUrl(p)}\nFecha ${fmtWhen(p.closes_at)}`;
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
  google: async () => {
    try { sessionStorage.setItem("racha-after-login", location.hash); } catch {}
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) toast(errMsg(error));
  },
  adminTab: (d) => { adminTab = d.tab; render(); },
  logout: async () => { closeSheet(); await sb.auth.signOut(); location.hash = ""; },
  join: (d) => run(sb.rpc("join_list", { p_list: d.list }), "Você entrou!"),
  leave: async (d) => { const e = findEntry(d.list, d.id); if (await run(sb.from("entries").delete().eq("id", d.id), (e ? e.name : "") + " saiu da lista.")) closeSheet(); },
  paid: async (d) => { if (await run(sb.rpc("mark_paid", { p_entry: d.id }), "Avisado! O organizador vai confirmar.")) closeSheet(); },
  setPaid: async (d) => { if (await run(sb.from("entries").update({ paid: d.val }).eq("id", d.id), d.val === "confirmed" ? "Pagamento confirmado." : "Marcado como não pago.")) { closeSheet(); if (route.name === "numeros") setTimeout(loadNumbers, 400); } },
  pix: (d) => { const l = findList(d.list); if (l) openSheet(pixSheet(l)); },
  copyPix: (d) => { const l = findList(d.list); if (l) copy(l.pix_key, "Chave Pix copiada."); },
  copyPixCode: (d) => { const l = findList(d.list); if (l) copy(pixCode(l), "Pix copia e cola copiado. Cole no app do banco."); },
  addPerson: (d) => { const l = findList(d.list); if (l) openSheet(addPersonSheet(l)); },
  addMember: async (d) => {
    if (await run(sb.rpc("admin_add_member", { p_list: d.list, p_user: d.id }), d.name + " entrou na lista.")) {
      const l = findList(d.list); entries[d.list] = [...(entries[d.list] || []), { id: "tmp-" + d.id, list_id: d.list, user_id: d.id, kind: "membro", name: d.name, created_at: new Date().toISOString() }];
      if (l) $("#sheetBody").innerHTML = addPersonSheet(l, ($("#pSearch") || {}).value || "");
    }
  },
  newPoll: () => openSheet(pollFormHtml()),
  pt: (d) => { const sc = liveScore(d.list); sc[d.side] = Math.min(99, sc[d.side] + 1); saveLive(d.list, sc); render(); },
  ptMinus: (d) => { const sc = liveScore(d.list); sc[d.side] = Math.max(0, sc[d.side] - 1); saveLive(d.list, sc); render(); },
  endSet: async (d) => {
    const l = findList(d.list); if (!l) return;
    const sc = liveScore(l.id), r = rotation(l);
    if (sc.a === sc.b) return toast(sc.a ? "Empate não vale. Marque o ponto que falta." : "Marque os pontos antes de fechar o set.");
    const row = { list_id: l.id, team_a: r.court[0], team_b: r.court[1], score_a: sc.a, score_b: sc.b, created_by: uid() };
    const res = await sb.from("matches").insert(row).select().maybeSingle();
    if (res.error) return toast(errMsg(res.error));
    matches[l.id] = [...(matches[l.id] || []), res.data || { ...row, created_at: new Date().toISOString() }];
    saveLive(l.id, { a: 0, b: 0 });
    const w = sc.a > sc.b ? r.court[0] : r.court[1], lo = w === r.court[0] ? r.court[1] : r.court[0], nx = rotation(l);
    toast(nx.queue.length || l.teams.length > 2 ? `${teamName(w)} fica. Sai ${teamShort(lo)}, entra ${teamShort(nx.court[1])}.` : `Set salvo! ${teamName(w)} venceu.`);
    render(); scheduleRefresh();
  },
  delMatch: (d) => run(sb.from("matches").delete().eq("id", d.id), "Set apagado."),
  numTab: (d) => { numTab = d.tab; render(); },
  numMonth: async (d) => {
    const [y, m] = numMonth.split("-").map(Number);
    numMonth = monthKey(new Date(y, m - 1 + Number(d.dir), 1));
    render();
    if (stats.board[numMonth] === undefined || stats.recap[numMonth] === undefined) { await loadMonth(numMonth); render(); }
  },
  shareRecap: async () => {
    const c = drawRecap(numMonth);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const file = new File([blob], `racha-${numMonth.slice(0, 7)}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text: "Retrospectiva do racha de " + monthLabel(numMonth) }); } catch {} return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    toast("Imagem baixada. Mande no grupo!");
  },
  delCash: async (d) => { if (await run(sb.from("cash").delete().eq("id", d.id), "Lançamento apagado.")) loadNumbers(); },
  sharePoll: (d) => { const p = findPoll(d.id); if (p) copy(pollShareText(p), "Link copiado. Cole no grupo!"); },
  closePoll: (d) => run(sb.from("polls").update({ closes_at: new Date().toISOString() }).eq("id", d.id), "Votação encerrada."),
  deletePoll: async (d) => { if (await run(sb.from("polls").delete().eq("id", d.id), "Votação apagada.")) location.hash = "ranking"; },
  castPoll: async (d) => {
    const p = findPoll(d.id); if (!p) return;
    const r = await sb.rpc("cast_poll_vote", { p_poll: p.id, p_target: d.target });
    if (r.error) return toast(errMsg(r.error));
    const first = !pollMine[p.id];
    pollMine[p.id] = d.target;
    if (first && pollRes[p.id]) pollRes[p.id].total++;
    toast(`Voto em ${pollName(p, d.target)} registrado!`);
    render(); scheduleRefresh();
  },
  personMedals: (d) => { const p = (rankingRows || []).find((x) => x.user_id === d.id); if (p) openSheet(personMedalsSheet(p)); },
  vote: (d) => {
    const l = findList(d.list); if (!l) return;
    const m = (votes[l.id] || {}).mine || {};
    voteCat = (CATS.find((c) => !m[c.key]) || CATS[0]).key; // abre na primeira categoria que falta
    openSheet(voteSheet(l));
  },
  voteCat: (d) => { const l = findList(d.list); voteCat = d.cat; if (l) $("#sheetBody").innerHTML = voteSheet(l); },
  castVote: async (d) => {
    const l = findList(d.list), e = findEntry(d.list, d.id); if (!l) return;
    const r = await sb.rpc("cast_vote", { p_list: d.list, p_entry: d.id, p_category: d.cat });
    if (r.error) return toast(errMsg(r.error));
    const v = votes[d.list] = votes[d.list] || { mine: {}, results: {}, total: 0 };
    v.mine = { ...v.mine, [d.cat]: d.id };
    const next = CATS.find((c) => !v.mine[c.key]);
    toast(`Voto em ${e ? e.name : "?"} registrado!`);
    if (next) { voteCat = next.key; $("#sheetBody").innerHTML = voteSheet(l); } else { closeSheet(); }
    render(); scheduleRefresh();
  },
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
    if ((matches[l.id] || []).length) await sb.from("matches").delete().eq("list_id", l.id);
    if (await run(sb.from("lists").update({ teams, teams_at: new Date().toISOString() }).eq("id", l.id), "Times sorteados!")) {
      l.teams = teams; l.teams_at = new Date().toISOString(); closeSheet(); render();
    }
  },
  clearTeams: async (d) => {
    if ((matches[d.list] || []).length) await sb.from("matches").delete().eq("list_id", d.list); if (await run(sb.from("lists").update({ teams: null, teams_at: null }).eq("id", d.list), "Times apagados.")) closeSheet(); },
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
  me: () => { openSheet(accountSheet()); if (!achievements) checkAchievements().then(() => { if (!$("#sheet").hidden) $("#sheetBody").innerHTML = accountSheet(); }); },
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
    if (user.includes("@") ? !/^[^s@]+@[^s@]+.[^s@]+$/.test(user) : !/^[a-zA-Z0-9._-]{3,24}$/.test(user)) return toast(user.includes("@") ? "Confira o e-mail." : "Usuário: de 3 a 24 caracteres, só letras, números, ponto e traço.");
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
  async cash(f) {
    const kind = (f.querySelector("input[name=cKind]:checked") || {}).value || "out";
    const amount = Math.round(Number(String($("#cAmount").value).replace(",", ".")) * 100) / 100;
    const description = clean($("#cDesc").value).slice(0, 80);
    if (!(amount > 0)) return toast("Coloque um valor.");
    if (!description) return toast("Coloque uma descrição.");
    if (await run(sb.from("cash").insert({ kind, amount, description, day: $("#cDay").value || todayISO() }), kind === "in" ? "Entrada lançada." : "Gasto lançado.")) {
      $("#cAmount").value = ""; $("#cDesc").value = ""; loadNumbers();
    }
  },
  async poll(f) {
    const kind = (f.querySelector("input[name=pKind]:checked") || {}).value || "mvp";
    const list_id = $("#pList").value || null;
    const l = list_id && findList(list_id);
    if (kind === "time" && !(l && Array.isArray(l.teams) && l.teams.length)) return toast("Para Melhor time, escolha um jogo que já teve sorteio de times.");
    const closes = $("#pCloses").value;
    if (!closes || new Date(closes).getTime() <= Date.now()) return toast("A data de fechar precisa ser no futuro.");
    let title = clean($("#pTitle").value);
    if (!title) title = kind === "outro" ? "" : pollKind(kind).name + (l ? " · " + pad(parseDate(l.game_date).getDate()) + "/" + pad(parseDate(l.game_date).getMonth() + 1) : "");
    if (title.length < 2) return toast("Dê um título para a votação.");
    const r = await sb.from("polls").insert({ kind, title: title.slice(0, 60), list_id, closes_at: new Date(closes).toISOString() }).select().maybeSingle();
    if (r.error) return toast(errMsg(r.error));
    const p = r.data;
    if (p) { polls = [p, ...polls]; pollRes[p.id] = { rows: [], total: 0 }; await copy(pollShareText(p), "Votação criada! Link copiado, cole no grupo."); location.hash = "p-" + p.id; }
    closeSheet(); scheduleRefresh();
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
window.addEventListener("hashchange", () => { route = parseRoute(); closeSheet(); render(); window.scrollTo(0, 0); if (route.name === "ranking" || route.name === "poll") loadRanking(); if (route.name === "numeros") loadNumbers(); });
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
  let back = null; try { back = sessionStorage.getItem("racha-after-login"); sessionStorage.removeItem("racha-after-login"); } catch {}
  if (session && back && back.length > 1 && !/access_token|error/.test(back)) { location.hash = back; route = parseRoute(); }
  fetch(CONF.supabaseUrl + "/auth/v1/settings", { headers: { apikey: CONF.supabaseKey } }).then((r) => r.json())
    .then((x) => { googleOn = !!(x && x.external && x.external.google); if (!session) render(); }).catch(() => {});
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
