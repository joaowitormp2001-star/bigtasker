// ═══════════════════════════════════════════════════════════════
// BIGTASKER — app.js
// Integração completa com o backend em bigtasker-backend.onrender.com
// ═══════════════════════════════════════════════════════════════

const API = 'https://bigtasker-backend.onrender.com';

// ─────────────────────────────────────────────
// UTILITÁRIOS DE API
// ─────────────────────────────────────────────
function getToken() { return localStorage.getItem('token'); }

async function apiFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ─────────────────────────────────────────────
// ESTADO GLOBAL
// ─────────────────────────────────────────────
let usuarioAtual = null;   // objeto do usuário logado
let tarefasCache = [];     // cache local das tarefas
let perfilPrivado = false;
let pendenciasCount = 1;

// ─────────────────────────────────────────────
// NÍVEIS (frontend — espelha o banco)
// ─────────────────────────────────────────────
const NIVEIS_XP = [
  { nome: 'Tasker Bronze',     cls: 'nivel-bronze',     min: 0,      max: 499   },
  { nome: 'Tasker Prata',      cls: 'nivel-prata',      min: 500,    max: 3499  },
  { nome: 'Tasker Ouro',       cls: 'nivel-ouro',       min: 3500,   max: 13999 },
  { nome: 'Tasker Platina',    cls: 'nivel-platina',    min: 14000,  max: 29999 },
  { nome: 'Tasker Diamante',   cls: 'nivel-diamante',   min: 30000,  max: 57999 },
  { nome: 'Tasker Mestre',     cls: 'nivel-mestre',     min: 58000,  max: 99999 },
  { nome: 'Tasker Grão-mestre',cls: 'nivel-graomestre', min: 100000, max: 149999},
  { nome: 'Tasker Supremo',    cls: 'nivel-supremo',    min: 150000, max: Infinity },
];

function getNivelInfo(xp) {
  return NIVEIS_XP.find(n => xp >= n.min && xp <= n.max) || NIVEIS_XP[0];
}

// ─────────────────────────────────────────────
// CÁLCULO DE XP — tabela de pontuação
// xp_base: facil=8 | medio=20 | dificil=40
// modificador score: <50 → ×1.0 | 50-70 → ×1.2 | >70 → ×1.4
// bônus consistência (+7 dias sem atraso): ×1.2
// tarefa atrasada: 0 XP
// ─────────────────────────────────────────────
const XP_BASE = { facil: 8, medio: 20, dificil: 40 };

function calcularXP(dificuldade, score, consistente = false, atrasada = false) {
  if (atrasada) return 0;
  const base = XP_BASE[dificuldade] || 20;
  const sc = parseInt(score) || 60;
  const modScore = sc < 50 ? 1.0 : sc <= 70 ? 1.2 : 1.4;
  const modConsistencia = consistente ? 1.2 : 1.0;
  return parseFloat((base * modScore * modConsistencia).toFixed(1));
}

function getScoreColor(pct) {
  const n = parseInt(pct);
  if (n < 50) return '#ef4444';
  if (n < 70) return '#f59e0b';
  if (n < 90) return '#22c55e';
  return '#7c3aed';
}

function getIniciais(nome) {
  if (!nome) return '??';
  const parts = nome.replace('@', '').split(/[._\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0][0] + (parts[0][1] || parts[0][0])).toUpperCase();
}

// ─────────────────────────────────────────────
// ATUALIZA TODA A UI COM DADOS DO USUÁRIO
// ─────────────────────────────────────────────
function aplicarUsuarioNaUI(u) {
  if (!u) return;
  usuarioAtual = u;

  const iniciais = getIniciais(u.nome);
  const nivel    = getNivelInfo(u.xp_total || 0);
  const score    = u.score || 60;
  const scColor  = getScoreColor(score);
  const xp       = u.xp_total || 0;
  const xpPct    = calcXpPorcentagem(xp);
  const nivelAtual = NIVEIS_XP.find(n => xp >= n.min && xp <= n.max) || NIVEIS_XP[0];
  const nivelProx  = NIVEIS_XP[NIVEIS_XP.indexOf(nivelAtual) + 1];

  // — Sidebar: avatar + nome + nível
  const sideAvatar = document.getElementById('sidebar-avatar');
  const sideNome   = document.getElementById('sidebar-nome');
  const sideNivel  = document.getElementById('sidebar-nivel');
  if (sideAvatar) sideAvatar.textContent = iniciais;
  if (sideNome)   sideNome.textContent   = '@' + u.nome;
  if (sideNivel) {
    sideNivel.textContent  = '✦ ' + nivel.nome;
    sideNivel.className    = 'nivel-tag ' + nivel.cls;
  }

  // — Perfil: nome, badge adm, score, nível, barra XP
  const perfNome  = document.getElementById('perfil-nome');
  const perfAdm   = document.getElementById('perfil-adm-badge');
  const perfScore = document.getElementById('meu-score-badge');
  const perfNivel = document.getElementById('perfil-nivel-tag');
  const perfXpMin = document.getElementById('perfil-xp-min');
  const perfXpMax = document.getElementById('perfil-xp-max');
  const perfXpVal = document.getElementById('perfil-xp-valor');
  const perfXpBar = document.getElementById('perfil-xp-fill');

  if (perfNome)  perfNome.textContent  = '@' + u.nome;
  if (perfAdm)   perfAdm.style.display = u.is_admin ? 'inline' : 'none';
  if (perfScore) {
    perfScore.textContent   = 'SCORE ' + score + '%';
    perfScore.style.background = scColor;
    perfScore.style.color   = '#fff';
  }
  if (perfNivel) {
    perfNivel.textContent = '✦ ' + nivel.nome;
    perfNivel.className   = 'nivel-tag ' + nivel.cls;
  }
  if (perfXpMin)  perfXpMin.textContent  = nivelAtual.min.toLocaleString() + ' XP';
  if (perfXpMax)  perfXpMax.textContent  = (nivelProx ? nivelProx.min.toLocaleString() : '—') + ' XP → ' + (nivelProx ? nivelProx.nome : 'Máximo');
  if (perfXpVal)  perfXpVal.textContent  = xp.toLocaleString() + ' XP';
  if (perfXpBar)  perfXpBar.style.width  = xpPct + '%';

  // — Configurações: preenche campos
  preencherConfiguracoes(u);

  // — Painel ADM: só aparece para admins
  const navAdm = document.getElementById('nav-painel-adm');
  if (navAdm) navAdm.style.display = u.is_admin ? 'block' : 'none';
}

function calcXpPorcentagem(xp) {
  const nivel = NIVEIS_XP.find(n => xp >= n.min && xp <= n.max) || NIVEIS_XP[0];
  const prox  = NIVEIS_XP[NIVEIS_XP.indexOf(nivel) + 1];
  if (!prox) return 100;
  return Math.round(((xp - nivel.min) / (prox.min - nivel.min)) * 100);
}

// ─────────────────────────────────────────────
// CONFIGURAÇÕES — preenche e salva
// ─────────────────────────────────────────────
function preencherConfiguracoes(u) {
  const sfUsername = document.getElementById('sf-username');
  const sfEmail    = document.getElementById('sf-email');
  if (sfUsername) sfUsername.value = '@' + u.nome;
  if (sfEmail)    sfEmail.value    = u.email || '';
}

// Salva alterações de perfil ao sair do campo
function editarCampoInline(id) {
  const input = document.getElementById(id);
  if (!input) return;
  if (input.readOnly) {
    input.readOnly = false;
    input.style.borderBottom = '1px solid #7c3aed';
    if (input.type === 'password') input.type = 'text';
    input.focus();
    input.addEventListener('blur', async () => {
      input.readOnly = true;
      input.style.borderBottom = '';
      if (id === 'sf-senha') input.type = 'password';
      await salvarConfiguracoes();
    }, { once: true });
  }
}

async function salvarConfiguracoes() {
  const nome  = document.getElementById('sf-username')?.value?.replace('@', '').trim();
  const senha = document.getElementById('sf-senha')?.value;
  const bio   = document.getElementById('sf-bio')?.value;

  const body = {};
  if (nome)  body.nome = nome;
  if (bio)   body.biografia = bio;
  if (senha && senha.length >= 4) body.senha = senha;

  if (Object.keys(body).length === 0) return;

  const { ok, data } = await apiFetch('/usuario/me', 'PUT', body);
  if (ok) {
    // Atualiza localStorage
    const u = JSON.parse(localStorage.getItem('usuario') || '{}');
    if (body.nome) u.nome = body.nome;
    localStorage.setItem('usuario', JSON.stringify(u));
    mostrarToast('Perfil atualizado ✓');
  } else {
    mostrarToast('Erro ao salvar: ' + (data.mensagem || 'tente novamente'), true);
  }
}

// ─────────────────────────────────────────────
// PRIVACIDADE
// ─────────────────────────────────────────────
function setPrivacidade(priv) {
  perfilPrivado = priv;
  const feedNotice    = document.getElementById('private-feed-notice');
  const rankingNotice = document.getElementById('private-ranking-notice');
  if (feedNotice)    feedNotice.style.display    = priv ? 'block' : 'none';
  if (rankingNotice) rankingNotice.style.display = priv ? 'block' : 'none';
  const radioPub  = document.getElementById('radio-publico');
  const radioPriv = document.getElementById('radio-privado');
  if (priv) { if (radioPriv) radioPriv.checked = true; }
  else      { if (radioPub)  radioPub.checked  = true; }
}

// ─────────────────────────────────────────────
// AUTENTICAÇÃO
// ─────────────────────────────────────────────
function mostrarForm(tipo) {
  ['login', 'cadastro', 'esqueceu', 'codigo'].forEach(f => {
    const el = document.getElementById('form-' + f);
    if (el) el.style.display = 'none';
  });
  const alvo = document.getElementById('form-' + tipo);
  if (alvo) alvo.style.display = 'block';
}

function mostrarErroAuth(msg) {
  let el = document.getElementById('auth-erro');
  if (!el) {
    el = document.createElement('p');
    el.id = 'auth-erro';
    el.style.cssText = 'color:#f87171;font-size:13px;text-align:center;margin-top:10px;';
    document.getElementById('form-login')?.appendChild(el);
  }
  el.textContent = msg;
}

function mostrarErroCadastro(msg) {
  let el = document.getElementById('cadastro-erro');
  if (!el) {
    el = document.createElement('p');
    el.id = 'cadastro-erro';
    el.style.cssText = 'color:#f87171;font-size:13px;text-align:center;margin-top:10px;';
    document.getElementById('form-cadastro')?.appendChild(el);
  }
  el.textContent = msg;
}

async function entrar() {
  const email = document.querySelector('#form-login input[type="email"]')?.value?.trim();
  const senha = document.querySelector('#form-login input[type="password"]')?.value;
  if (!email || !senha) { mostrarErroAuth('Preencha todos os campos'); return; }

  const btnEntrar = document.querySelector('#form-login .btn-green');
  if (btnEntrar) { btnEntrar.textContent = 'Entrando...'; btnEntrar.disabled = true; }

  try {
    const res  = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });
    const dados = await res.json();

    if (res.ok && dados.token) {
      localStorage.setItem('token', dados.token);
      localStorage.setItem('usuario', JSON.stringify(dados.usuario));
      abrirApp(dados.usuario);
    } else {
      mostrarErroAuth(dados.mensagem || 'Credenciais inválidas');
    }
  } catch (e) {
    mostrarErroAuth('Não foi possível conectar ao servidor');
  } finally {
    if (btnEntrar) { btnEntrar.textContent = 'Entrar'; btnEntrar.disabled = false; }
  }
}

async function cadastrar() {
  const nome      = document.querySelector('#form-cadastro input[type="text"]')?.value?.trim();
  const email     = document.querySelector('#form-cadastro input[type="email"]')?.value?.trim();
  const senhas    = document.querySelectorAll('#form-cadastro input[type="password"]');
  const senha     = senhas[0]?.value;
  const confirmar = senhas[1]?.value;

  if (!nome || !email || !senha) { mostrarErroCadastro('Preencha todos os campos'); return; }
  if (senha !== confirmar) { mostrarErroCadastro('As senhas não coincidem'); return; }
  if (senha.length < 6) { mostrarErroCadastro('Senha deve ter ao menos 6 caracteres'); return; }

  const btnCadastrar = document.querySelector('#form-cadastro .btn-green');
  if (btnCadastrar) { btnCadastrar.textContent = 'Cadastrando...'; btnCadastrar.disabled = true; }

  try {
    const res  = await fetch(API + '/auth/cadastro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha })
    });
    const dados = await res.json();

    if (res.ok && dados.token) {
      localStorage.setItem('token', dados.token);
      localStorage.setItem('usuario', JSON.stringify(dados.usuario));
      abrirApp(dados.usuario);
    } else {
      mostrarErroCadastro(dados.mensagem || 'Erro no cadastro');
    }
  } catch (e) {
    mostrarErroCadastro('Não foi possível conectar ao servidor');
  } finally {
    if (btnCadastrar) { btnCadastrar.textContent = 'Cadastrar'; btnCadastrar.disabled = false; }
  }
}

function sair() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  usuarioAtual = null;
  document.getElementById('app').classList.remove('active');
  document.getElementById('auth-screen').classList.add('active');
  mostrarForm('login');
}

// ─────────────────────────────────────────────
// ABRIR APP — carrega tudo após login
// ─────────────────────────────────────────────
async function abrirApp(usuario) {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('app').classList.add('active');

  aplicarUsuarioNaUI(usuario);

  // Carrega dados em paralelo
  await Promise.all([
    carregarTarefas(),
    carregarFeed(),
    carregarConquistas(),
    carregarRanking(),
  ]);

  // Atualiza métricas do dashboard com dados frescos do servidor
  await atualizarMeuPerfil();
}

// ─────────────────────────────────────────────
// PERFIL ATUALIZADO DO SERVIDOR
// ─────────────────────────────────────────────
async function atualizarMeuPerfil() {
  const { ok, data } = await apiFetch('/usuario/me');
  if (!ok) return;

  // Mescla com o que já tínhamos (is_admin vem do token, não do /me)
  const uLocal = JSON.parse(localStorage.getItem('usuario') || '{}');
  const u = { ...uLocal, ...data };
  localStorage.setItem('usuario', JSON.stringify(u));
  aplicarUsuarioNaUI(u);
  atualizarDashboard(u);
}

function atualizarDashboard(u) {
  // Tarefas concluídas
  const concluidas = tarefasCache.filter(t => t.status === 'concluida').length;
  const elConc = document.querySelector('#page-dashboard [data-metric="concluidas"]');
  if (elConc) elConc.textContent = concluidas;

  // XP total
  const elXP = document.querySelector('#page-dashboard [data-metric="xp-total"]');
  if (elXP) elXP.innerHTML = (u.xp_total || 0) + ' <span style="font-size:14px;color:#7c3aed;">XP</span>';

  // Score
  const elScore = document.querySelector('#page-dashboard [data-metric="score"]');
  if (elScore) elScore.innerHTML = '+' + ((u.score || 60) - 60).toFixed(1) + '<span style="font-size:14px;">%</span>';
}

// ─────────────────────────────────────────────
// TAREFAS
// ─────────────────────────────────────────────
async function carregarTarefas() {
  const { ok, data } = await apiFetch('/tarefas');
  if (!ok) return;
  tarefasCache = data;
  renderizarKanban(data);
  renderizarTarefasDashboard(data);
}

function renderizarTarefasDashboard(tarefas) {
  const container = document.getElementById('dash-tasks-inner');
  if (!container) return;

  const u = usuarioAtual || JSON.parse(localStorage.getItem('usuario') || '{}');
  const score = u.score || 60;

  // Mostra as 5 mais recentes não concluídas
  const visiveis = tarefas
    .filter(t => t.status !== 'concluida')
    .slice(0, 5);

  container.innerHTML = visiveis.map(t => {
    const atrasada = t.esta_atrasada;
    const xp = calcularXP(t.dificuldade, score, false, atrasada);
    const prazo = t.prazo ? t.prazo.substring(5, 10).split('-').reverse().join('/') : '—';
    const borderStyle = atrasada ? 'border-color:rgba(239,68,68,0.3);' : '';
    return `<div class="task-card" onclick="abrirTarefa(${JSON.stringify(t).replace(/"/g, '&quot;')})" style="${borderStyle}">
      <div class="badge-cat" style="margin-bottom:8px;">${t.categoria_icone || '📌'} ${t.categoria_nome || 'Geral'}</div>
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">${t.titulo}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:11px;color:#64748b;">⏱ ${prazo}</span>
        ${atrasada ? '<span class="badge badge-atrasada">ATRASADA</span>' : ''}
        <span class="badge badge-${t.dificuldade}">${{facil:'Fácil',medio:'Médio',dificil:'Difícil'}[t.dificuldade]}</span>
        <span style="margin-left:auto;font-size:11px;color:${atrasada?'#64748b':'#22c55e'};font-weight:600;">${atrasada?'+0':'+'+xp} XP</span>
      </div>
    </div>`;
  }).join('');
}

function renderizarKanban(tarefas) {
  const colunas = {
    'pendente':  document.getElementById('col-afazer'),
    'em_andamento': document.getElementById('col-fazendo'),
    'concluida': document.getElementById('col-concluido'),
  };

  // Limpa colunas (mantém header)
  Object.values(colunas).forEach(col => {
    if (!col) return;
    const header = col.querySelector('.kanban-header');
    col.innerHTML = '';
    if (header) col.appendChild(header);
  });

  const u = usuarioAtual || JSON.parse(localStorage.getItem('usuario') || '{}');
  const score = u.score || 60;

  tarefas.forEach(t => {
    const colKey = t.status === 'concluida' ? 'concluida' : t.status === 'em_andamento' ? 'em_andamento' : 'pendente';
    const col = colunas[colKey];
    if (!col) return;

    const atrasada = t.esta_atrasada;
    const xp = calcularXP(t.dificuldade, score, false, atrasada);
    const prazo = t.prazo ? t.prazo.substring(5, 10).split('-').reverse().join('/') : '—';
    const borderStyle = atrasada ? 'border-color:rgba(239,68,68,0.3);' : '';
    const concluida = t.status === 'concluida';

    const card = document.createElement('div');
    card.className = 'task-card';
    card.setAttribute('style', borderStyle);
    card.setAttribute('data-id', t.id);
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div class="badge-cat">${t.categoria_icone || '📌'} ${t.categoria_nome || 'Geral'}</div>
        ${atrasada ? '<span class="badge badge-atrasada">ATRASADA</span>' : ''}
      </div>
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">${t.titulo}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:11px;color:#64748b;">⏱ ${prazo}</span>
        <span class="badge badge-${t.dificuldade}">${{facil:'Fácil',medio:'Médio',dificil:'Difícil'}[t.dificuldade]}</span>
        <span style="margin-left:auto;font-size:11px;color:${atrasada?'#64748b':'#22c55e'};font-weight:600;">${atrasada?'+0':'+'+xp} XP</span>
      </div>
      ${concluida ? `<div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button onclick="event.stopPropagation();abrirEditor(${t.id})" style="padding:5px 12px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">Postar</button>
      </div>` : ''}
    `;

    card.onclick = () => abrirTarefaById(t);
    col.appendChild(card);
  });

  // Reinicia drag & drop
  iniciarSortable();
}

function abrirTarefaById(t) {
  const u = usuarioAtual || {};
  const score = u.score || 60;
  const atrasada = t.esta_atrasada;
  const xp = calcularXP(t.dificuldade, score, false, atrasada);
  const prazo = t.prazo ? t.prazo.substring(5, 10).split('-').reverse().join('/') : '—';

  document.getElementById('mt-titulo').textContent = t.titulo;
  const catEl = document.getElementById('mt-cat');
  if (catEl) catEl.textContent = (t.categoria_icone || '📌') + ' ' + (t.categoria_nome || 'Geral');
  document.getElementById('mt-prazo').textContent = '⏱ ' + prazo;
  const atEl = document.getElementById('mt-atrasada');
  if (atEl) atEl.style.display = atrasada ? 'inline-flex' : 'none';
  const difEl = document.getElementById('mt-dif');
  if (difEl) { difEl.className = 'badge badge-' + t.dificuldade; difEl.textContent = {facil:'Fácil',medio:'Médio',dificil:'Difícil'}[t.dificuldade]; }
  document.getElementById('mt-xp').textContent = atrasada ? '+0 XP' : '+' + xp + ' XP';

  const acaoEl = document.getElementById('mt-acao');
  if (acaoEl) {
    if (t.status === 'concluida') {
      acaoEl.innerHTML = `<button class="btn-primary" onclick="fecharModal('modal-tarefa');abrirEditor(${t.id})">Postar</button>`;
    } else if (t.status !== 'concluida' && !atrasada) {
      acaoEl.innerHTML = `<button class="btn-green" onclick="concluirTarefa(${t.id})">Concluir tarefa ✓</button>`;
    } else {
      acaoEl.innerHTML = '';
    }
  }

  document.getElementById('modal-tarefa').classList.add('open');
}

// Mantém compatibilidade com chamadas antigas inline no HTML
function abrirTarefa(t) { abrirTarefaById(t); }

async function concluirTarefa(id) {
  const { ok, data } = await apiFetch(`/tarefas/${id}/concluir`, 'POST');
  fecharModal('modal-tarefa');
  if (ok) {
    mostrarToast(`+${data.xp_ganho} XP ganhos! 🎉`);
    // Atualiza localmente
    const u = JSON.parse(localStorage.getItem('usuario') || '{}');
    u.xp_total = data.xp_total;
    localStorage.setItem('usuario', JSON.stringify(u));
    await Promise.all([carregarTarefas(), atualizarMeuPerfil()]);
  } else {
    mostrarToast(data.mensagem || 'Erro ao concluir tarefa', true);
  }
}

// Nova tarefa
async function criarTarefa() {
  const titulo = document.getElementById('nova-titulo')?.value?.trim();
  const descricao  = document.getElementById('nt-descricao')?.value?.trim();
  const prazo      = document.getElementById('nt-prazo')?.value;
  const dificuldade = difAtual || 'medio';
  const id_categoria = categoriaAtual || 1;

  if (!titulo) { mostrarToast('Título é obrigatório', true); return; }

  const { ok, data } = await apiFetch('/tarefas', 'POST', {
    titulo, descricao, prazo, dificuldade, id_categoria
  });

  if (ok) {
    fecharModal('modal-nova-tarefa');
    mostrarToast('Tarefa criada! ✓');
    await carregarTarefas();
  } else {
    mostrarToast(data.mensagem || 'Erro ao criar tarefa', true);
  }
}

// ─────────────────────────────────────────────
// DRAG & DROP KANBAN
// ─────────────────────────────────────────────
function iniciarSortable() {
  if (typeof Sortable === 'undefined') return;
  const mapStatus = {
    'col-afazer':   'pendente',
    'col-fazendo':  'em_andamento',
    'col-concluido':'concluida',
  };
  ['col-afazer', 'col-fazendo', 'col-concluido'].forEach(colId => {
    const el = document.getElementById(colId);
    if (!el || el._sortable) return;
    el._sortable = new Sortable(el, {
      group: 'kanban',
      animation: 150,
      handle: '.task-card',
       filter: '.kanban-header',
      ghostClass: 'opacity-50',
      onAdd: async (evt) => {
        const card   = evt.item;
        const taskId = card.getAttribute('data-id');
        const novoStatus = mapStatus[evt.to.id];
        if (taskId && novoStatus) {
          await apiFetch(`/tarefas/${taskId}`, 'PUT', { status: novoStatus });
          await carregarTarefas();
        }
      }
    });
  });
}

// ─────────────────────────────────────────────
// FEED
// ─────────────────────────────────────────────
async function carregarFeed() {
  const { ok, data } = await apiFetch('/feed');
  if (!ok) return;
  renderizarFeed(data);
}

function renderizarFeed(posts) {
  const container = document.getElementById('feed-posts');
  if (!container) return;
  if (!posts || posts.length === 0) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:32px;">Nenhuma postagem ainda.</p>';
    return;
  }

  const u = usuarioAtual || {};

  container.innerHTML = posts.map((p, idx) => {
    const iniciais  = getIniciais(p.usuario_nome);
    const sc        = getScoreColor(p.usuario_score || 60);
    const scText    = sc === '#f59e0b' ? '#000' : '#fff';
    const difLabel  = {facil:'Fácil',medio:'Médio',dificil:'Difícil'}[p.tarefa_dificuldade] || '—';
    const isYou     = p.id_usuario === u.id;
    const menuBtn   = isYou ? `
      <div style="position:relative;display:inline-block;">
        <button onclick="togglePostMenu(${idx})" style="background:none;border:none;color:#64748b;cursor:pointer;padding:4px 6px;font-size:18px;line-height:1;border-radius:6px;">⋯</button>
        <div id="post-menu-${idx}" style="display:none;position:absolute;right:0;top:100%;background:#1c2333;border:1px solid #2a3347;border-radius:10px;min-width:160px;z-index:100;overflow:hidden;">
          <div onclick="excluirPostFeed(${p.id},${idx})" style="padding:10px 14px;font-size:13px;cursor:pointer;color:#f87171;" onmouseenter="this.style.background='rgba(239,68,68,0.08)'" onmouseleave="this.style.background=''">🗑 Excluir post</div>
        </div>
      </div>` : '';

    const mediaHtml = p.url_imagem
      ? `<img src="${p.url_imagem}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">`
      : `<span style="font-size:48px;">${p.categoria_icone || '📌'}</span>`;

    return `<div class="post-card" id="post-card-${idx}">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px 8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:30px;height:30px;border-radius:100px;background:linear-gradient(135deg,#7c3aed,#3b82f6);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">${iniciais}</div>
          <span style="font-size:13px;font-weight:600;">${p.usuario_nome}${isYou?' <span style="background:#7c3aed;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;">você</span>':''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="score-badge" style="background:${sc};color:${scText};">SCORE ${p.usuario_score || 60}%</span>
          ${menuBtn}
        </div>
      </div>
      <div style="height:240px;background:linear-gradient(135deg,#1c2333,#2a1a4e);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">
        ${mediaHtml}
        <div style="position:absolute;bottom:9px;left:9px;right:9px;">
          <div style="margin-bottom:3px;"><span class="badge-cat" style="font-size:9px;padding:2px 8px;">${p.categoria_icone || '📌'} ${p.categoria_nome || 'Geral'}</span></div>
          <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);border-radius:8px;padding:4px 9px;">
            <span style="font-size:11px;font-weight:600;">${p.tarefa_titulo}</span>
            <span class="badge badge-${p.tarefa_dificuldade}" style="font-size:9px;padding:1px 6px;">${difLabel}</span>
          </div>
        </div>
      </div>
      <div style="padding:10px 14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <button class="react-btn like" data-post="${p.id}" onclick="reagirPostAPI(${p.id},'like',this)">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            <span>${p.reacoes?.like || 0}</span>
          </button>
          <button class="react-btn dislike" data-post="${p.id}" onclick="reagirPostAPI(${p.id},'dislike',this)">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
            <span>${p.reacoes?.dislike || 0}</span>
          </button>
          <button class="react-btn heart" data-post="${p.id}" onclick="reagirPostAPI(${p.id},'coracao',this)" style="margin-left:auto;">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span>${p.reacoes?.coracao || 0}</span>
          </button>
        </div>
        ${p.legenda ? `<p style="font-size:13px;color:#94a3b8;">${p.legenda}</p>` : ''}
      </div>
    </div>`;
  }).join('');
}

// Reação real na API
const reacoesPendentes = {};
async function reagirPostAPI(postId, tipo, btn) {
  if (perfilPrivado) { mostrarToast('Perfil privado: reações desabilitadas.', true); return; }

  // Otimistic UI: atualiza contador imediatamente
  const span = btn.querySelector('span');
  const tipoMap = { like: 'like', dislike: 'dislike', coracao: 'coracao' };
  const jaAtivo = btn.classList.contains('active');
  btn.classList.toggle('active');
  if (span) span.textContent = parseInt(span.textContent) + (jaAtivo ? -1 : 1);

  // Debounce para evitar spam
  clearTimeout(reacoesPendentes[postId]);
  reacoesPendentes[postId] = setTimeout(async () => {
    if (!jaAtivo) {
      await apiFetch(`/feed/${postId}/reagir`, 'POST', { tipo });
    }
  }, 500);
}

async function excluirPostFeed(postId, idx) {
  if (!confirm('Excluir este post?')) return;
  // (backend não tem endpoint de delete de post, remove só da UI por ora)
  document.getElementById('post-card-' + idx)?.remove();
}

function togglePostMenu(idx) {
  const m = document.getElementById('post-menu-' + idx);
  if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

// ─────────────────────────────────────────────
// CONQUISTAS
// ─────────────────────────────────────────────
async function carregarConquistas() {
  const { ok, data } = await apiFetch('/conquistas');
  if (!ok) return;
  renderizarConquistas(data);
  renderizarConquistasPerfil(data);
}

function nomeArquivo(nome) {
  return nome
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(([a-z])\)/g, '-$1')  // (a) → -a
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function renderizarConquistas(conquistas) {
  const grid = document.getElementById('conquistas-grid');
  if (!grid) return;

  const total       = conquistas.length;
  const desbloqueadas = conquistas.filter(c => c.desbloqueada).length;
  const pct         = total ? Math.round((desbloqueadas / total) * 100) : 0;

  // Atualiza barra de progresso geral
  const progBar  = document.querySelector('#page-conquistas .xp-fill');
  const progPct  = document.querySelector('#page-conquistas .xp-bar + span, #page-conquistas [data-pct]');
  if (progBar)  progBar.style.width = pct + '%';
  if (progPct)  progPct.textContent = pct + '%';

  grid.innerHTML = conquistas.map(c => `
    <div class="conquista-card ${c.desbloqueada ? 'unlocked' : ''}">
      <img class="conquista-img ${c.desbloqueada ? '' : 'locked'}" src="assets/${nomeArquivo(c.nome)}.png" alt="${c.nome}" onerror="this.style.display='none'">
      <div style="font-size:13px;font-weight:700;font-family:'Sora';">${c.nome}</div>
      <div style="font-size:11px;color:#64748b;text-align:center;">${c.descricao}</div>
      <span class="xp-tag-c ${c.desbloqueada ? 'unlocked' : 'locked'}">+${c.xp_de_resgate} XP</span>
      ${!c.desbloqueada ? `<div class="prog-bar"><div class="prog-fill" style="width:${c.progresso || 0}%;"></div></div>` : ''}
    </div>
  `).join('');
}

function renderizarConquistasPerfil(conquistas) {
  const container = document.getElementById('perfil-conquistas');
  if (!container) return;
  const desbloqueadas = conquistas.filter(c => c.desbloqueada).slice(0, 8);
  container.innerHTML = desbloqueadas.map(c => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:3px;width:50px;text-align:center;">
      src="assets/${nomeArquivo(c.nome)}.png"
 alt="${c.nome}" style="width:42px;height:42px;object-fit:contain;" onerror="this.style.display='none'">
      <span style="font-size:9px;color:#94a3b8;line-height:1.3;">${c.nome}</span>
    </div>
  `).join('');
}

// ─────────────────────────────────────────────
// RANKING
// ─────────────────────────────────────────────
async function carregarRanking() {
  const { ok, data } = await apiFetch('/ranking');
  if (!ok) return;

  // Contador de tempo restante
  if (data.competicao?.fim) {
    atualizarContadorRanking(data.competicao.fim);
  }

  renderizarRanking(data.ranking || []);
}

function atualizarContadorRanking(fimISO) {
  const el = document.getElementById('ranking-timer');
  function tick() {
    const diff = new Date(fimISO) - new Date();
    if (diff <= 0) { if (el) el.textContent = 'Encerrado'; return; }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (el) el.textContent = `Termina em ${d}d ${h}h ${m}min`;
  }
  tick();
  setInterval(tick, 60000);
}

function renderizarRanking(rows) {
  const container = document.getElementById('ranking-rows');
  if (!container) return;

  const u = usuarioAtual || {};

  if (rows.length === 0) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:32px;">Nenhuma competição ativa no momento.</p>';
    return;
  }

  container.innerHTML = rows.map((r, i) => {
    const isYou = r.id_usuario === u.id;
    const iniciais = getIniciais(r.nome);
    return `<div class="ranking-row" style="display:flex;gap:16px;padding:12px 20px;border-top:1px solid #2a3347;font-size:13px;${isYou ? 'background:rgba(124,58,237,0.08);' : ''}">
      <span style="width:54px;font-weight:700;font-family:'Sora';">${i + 1}º</span>
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <div style="width:26px;height:26px;border-radius:100px;background:linear-gradient(135deg,#7c3aed,#3b82f6);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;">${iniciais}</div>
        <span>${r.nome}${isYou ? ' <span style="background:#7c3aed;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;">você</span>' : ''}</span>
      </div>
      <span style="width:90px;font-weight:600;">${r.xp_obtido} XP</span>
      <span style="width:90px;font-weight:700;color:#22c55e;">+${Math.floor(r.xp_obtido * 0.1)} XP</span>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// PAINEL ADM
// ─────────────────────────────────────────────
async function carregarPainelAdm() {
  const u = usuarioAtual || JSON.parse(localStorage.getItem('usuario') || '{}');
  if (!u.is_admin) {
    navTo('dashboard');
    mostrarToast('Acesso restrito a administradores.', true);
    return;
  }

  const { ok, data } = await apiFetch('/admin/metricas');
  if (!ok) return;

  const elAtivos  = document.querySelector('#page-painel-adm [data-adm="usuarios"]');
  const elNovos   = document.querySelector('#page-painel-adm [data-adm="novos"]');
  const elPend    = document.getElementById('pendencias-num');

  if (elAtivos)  elAtivos.textContent  = data.usuarios_ativos;
  if (elNovos)   elNovos.textContent   = data.novos_hoje;
  if (elPend)    elPend.textContent    = data.pendencias;

  await carregarAlertasAdm();
}

async function carregarAlertasAdm() {
  const { ok, data } = await apiFetch('/admin/alertas');
  if (!ok) return;

  const container = document.getElementById('adm-rows');
  if (!container) return;
  if (data.length === 0) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:24px;">Nenhuma pendência.</p>';
    return;
  }

  container.innerHTML = data.map(a => `
    <div id="adm-row-${a.id}" style="display:grid;grid-template-columns:70px 1fr 120px 1fr;padding:14px 20px;border-top:1px solid #2a3347;align-items:center;transition:all 0.4s;">
      <span style="font-size:13px;color:#64748b;">#${a.id}</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:28px;height:28px;border-radius:100px;background:#2a3347;"></div>
        <span style="font-size:13px;font-weight:600;">@${a.usuario_nome}</span>
      </div>
      <span style="font-size:14px;font-weight:700;color:#f87171;">${a.quantia_tarefas_suspeitas}</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <button onclick="descartarAlerta(${a.id})" style="padding:6px 14px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Descartar</button>
      </div>
    </div>
  `).join('');
}

function descartarAlerta(id) {
  const row = document.getElementById('adm-row-' + id);
  if (row) { row.style.opacity = '0'; setTimeout(() => row.remove(), 400); }
  pendenciasCount = Math.max(0, pendenciasCount - 1);
  const el = document.getElementById('pendencias-num');
  if (el) el.textContent = pendenciasCount;
}

// ─────────────────────────────────────────────
// NAVEGAÇÃO
// ─────────────────────────────────────────────
const NAV_MAP = {
  'dashboard':   'Início',
  'tarefas':     'Tarefas',
  'perfil':      'Perfil',
  'ranking':     'Ranking',
  'conquistas':  'Conquistas',
  'instrucoes':  'Instruções',
  'configuracoes':'Configurações',
  'painel-adm':  'Painel Adm',
  'historico-adm':'Painel Adm',
};

function navTo(id) {
  // Protege painel ADM
  if (id === 'painel-adm') {
    const u = usuarioAtual || JSON.parse(localStorage.getItem('usuario') || '{}');
    if (!u.is_admin) { mostrarToast('Acesso restrito a administradores.', true); return; }
    carregarPainelAdm();
  }
  if (id === 'ranking') carregarRanking();

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  const label = NAV_MAP[id];
  if (label) document.querySelectorAll('.nav-item').forEach(n => {
    if (n.textContent.trim() === label) n.classList.add('active');
  });
}

// ─────────────────────────────────────────────
// MODAIS
// ─────────────────────────────────────────────
function fecharModal(id) {
  document.getElementById(id)?.classList.remove('open');
}
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

function abrirModalNovaTarefa() { document.getElementById('modal-nova-tarefa')?.classList.add('open'); }
function abrirModalPostar()     { document.getElementById('modal-postar')?.classList.add('open'); }
function abrirEditor(tarefaId) {
  fecharModal('modal-postar');
  if (tarefaId) document.getElementById('modal-editor')?.setAttribute('data-tarefa', tarefaId);
  document.getElementById('modal-editor')?.classList.add('open');
}

// ─────────────────────────────────────────────
// TOAST (feedback visual rápido)
// ─────────────────────────────────────────────
function mostrarToast(msg, erro = false) {
  let toast = document.getElementById('bt-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bt-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1c2333;border:1px solid #2a3347;border-radius:100px;padding:10px 22px;font-size:13px;font-weight:600;z-index:9999;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.color = erro ? '#f87171' : '#22c55e';
  toast.style.borderColor = erro ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.3)';
  toast.style.opacity = '1';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// ─────────────────────────────────────────────
// NOTIFICAÇÕES
// ─────────────────────────────────────────────
async function carregarNotificacoes() {
  const { ok, data } = await apiFetch('/notificacoes');
  if (!ok) return;

  const panel = document.getElementById('notif-panel');
  if (!panel) return;

  const header = panel.querySelector('div:first-child');
  const items  = data.map(n => `
    <div class="notif-item">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:700;font-size:13px;font-family:'Sora';">${n.titulo}</span>
        <span style="font-size:11px;color:#64748b;">${n.data_notificacao ? n.data_notificacao.substring(0, 10) : ''}</span>
      </div>
      <p style="font-size:12px;color:#94a3b8;">${n.mensagem}</p>
    </div>
  `).join('');

  panel.innerHTML = (header ? header.outerHTML : '') + (items || '<p style="padding:16px;color:#64748b;font-size:13px;">Nenhuma notificação.</p>');
}

function toggleNotif(btn) {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (!visible) {
    document.getElementById('notif-dot').style.display = 'none';
    carregarNotificacoes();
  }
}

document.addEventListener('click', e => {
  const panel = document.getElementById('notif-panel');
  if (panel && !panel.contains(e.target) && !e.target.closest('[onclick*="toggleNotif"]')) {
    panel.style.display = 'none';
  }
});

// ─────────────────────────────────────────────
// SPLASH → checar sessão existente
// ─────────────────────────────────────────────
setTimeout(() => {
  const splash = document.getElementById('splash');
  splash.classList.add('fade-out');
  setTimeout(async () => {
    splash.style.display = 'none';
    const token   = localStorage.getItem('token');
    const usuario = localStorage.getItem('usuario');

    if (token && usuario) {
      // Sessão existente: entra direto
      abrirApp(JSON.parse(usuario));
    } else {
      document.getElementById('auth-screen').classList.add('active');
    }
  }, 600);
}, 2400);

// ─────────────────────────────────────────────
// DIFICULDADE — modal nova tarefa
// ─────────────────────────────────────────────
let difAtual = 'medio';
let categoriaAtual = 1;

function selecionarDif(dif) {
  difAtual = dif;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active-facil', 'active-medio', 'active-dificil'));
  const btn = document.querySelector(`.diff-btn[data-dif="${dif}"]`);
  if (btn) btn.classList.add('active-' + dif);
  // Atualiza XP preview
  const u = usuarioAtual || {};
  const xpPreview = document.getElementById('nt-xp-preview');
  if (xpPreview) xpPreview.textContent = '+' + calcularXP(dif, u.score || 60) + ' XP';
}

// ─────────────────────────────────────────────
// PREVIEW MÍDIA — modal editor de post
// ─────────────────────────────────────────────
function previewMidia(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const prev = document.getElementById('preview-media');
    if (prev) prev.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">`;
  };
  reader.readAsDataURL(file);
}

function atualizarLegendaPreview() {
  const val = document.getElementById('editor-legenda')?.value;
  const container = document.getElementById('preview-legenda-container');
  if (!container) return;
  container.style.display = val ? 'block' : 'none';
  container.textContent = val;
}

// ─────────────────────────────────────────────
// COVER / AVATAR
// ─────────────────────────────────────────────
function previewCapa(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const area = document.getElementById('cover-area');
    if (area) {
      area.style.backgroundImage = `url(${e.target.result})`;
      area.style.backgroundSize  = 'cover';
      area.style.backgroundPosition = 'center';
      const btn = document.getElementById('btn-del-capa');
      if (btn) btn.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

function excluirCapa() {
  const area = document.getElementById('cover-area');
  if (area) { area.style.backgroundImage = ''; }
  const btn = document.getElementById('btn-del-capa');
  if (btn) btn.style.display = 'none';
}

function previewAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const av = document.getElementById('avatar-container');
    if (av) { av.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:100px;">`; }
    const btnDel = document.getElementById('btn-del-avatar');
    if (btnDel) btnDel.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function excluirAvatar() {
  const av = document.getElementById('avatar-container');
  const u  = usuarioAtual || {};
  if (av) av.innerHTML = getIniciais(u.nome || 'JW');
  const btnDel = document.getElementById('btn-del-avatar');
  if (btnDel) btnDel.style.display = 'none';
}

// ─────────────────────────────────────────────
// MODAL NOVA TAREFA — funções do HTML
// ─────────────────────────────────────────────
function toggleCatDropdown() {
  const list = document.getElementById('cat-list');
  if (list) list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

function selectCat(nome) {
  const texto = document.getElementById('cat-selected-text');
  if (texto) texto.textContent = nome;
  const list = document.getElementById('cat-list');
  if (list) list.style.display = 'none';
  // Mapeia nome para id (ajuste conforme suas categorias no banco)
  const mapa = {
    '📘 Desenvolvimento Pessoal': 1,
    '💼 Trabalho': 2,
    '📚 Estudo': 3,
    '💪 Saúde & Fitness': 4,
    '🏠 Casa & Rotina': 5,
    '💰 Finanças': 6,
  };
  categoriaAtual = mapa[nome] || 1;
}

function setDif(btn, dif) {
  difAtual = dif;
  document.querySelectorAll('.diff-btn').forEach(b => {
    b.classList.remove('active-facil', 'active-medio', 'active-dificil');
  });
  if (btn) btn.classList.add('active-' + dif);
  const u = usuarioAtual || {};
  const xpPreview = document.getElementById('nova-xp-pr') || document.getElementById('nt-xp-preview');
  if (xpPreview) xpPreview.textContent = '+' + calcularXP(dif, u.score || 60) + ' XP';
}

// ─────────────────────────────────────────────
// INIT após DOM carregado
// ─────────────────────────────────────────────
window.addEventListener('load', () => {
  iniciarSortable();
});