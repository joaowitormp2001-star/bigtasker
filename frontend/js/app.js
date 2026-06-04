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
// bônus consistência (+7 dias sem atraso): ×1.2 adicional
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

// Retorna o XP exibido para preview (sem consistência — é bônus surpresa)
function calcularXPPreview(dificuldade, score) {
  return calcularXP(dificuldade, score, false, false);
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
  const xpLabelContainer = document.getElementById('xp-label-container');
  if (xpLabelContainer) xpLabelContainer.style.left = Math.min(Math.max(xpPct, 5), 92) + '%';

  // — Configurações: preenche campos
  preencherConfiguracoes(u);

  // — Perfil: bio
  const perfilBio = document.getElementById('perfil-bio');
  if (perfilBio) perfilBio.textContent = u.biografia || '';

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
  const sfBio      = document.getElementById('sf-bio');
  if (sfUsername) sfUsername.value = '@' + u.nome;
  if (sfEmail)    sfEmail.value    = u.email || '';
  if (sfBio)      sfBio.value      = u.biografia || '';
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
  if (!getToken()) {
    document.getElementById('auth-screen').classList.add('active');
    return;
  }
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('app').classList.add('active');

  aplicarUsuarioNaUI(usuario);

  // Carrega dados em paralelo
  await Promise.all([
    carregarTarefas(),
    carregarFeed(),
    carregarConquistas(),
  ]);
  await carregarRanking();          // garante posições calculadas antes do /me
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
  const concluidas = tarefasCache.filter(t => t.status === 'concluida').length;
  const elConc = document.getElementById('dash-concluidas');
  if (elConc) elConc.textContent = concluidas;

  const xp = u.xp_total || 0;
  const elXP = document.getElementById('dash-xp-total');
  if (elXP) elXP.innerHTML = xp.toLocaleString() + ' <span style="font-size:14px;color:#7c3aed;">XP</span>';

  // XP semanal — vem do backend via /usuario/me
  const elSemanal = document.getElementById('dash-xp-semanal');
  if (elSemanal) {
    const xpSem = u.xp_semanal !== undefined ? u.xp_semanal : '—';
    elSemanal.innerHTML = xpSem + (xpSem !== '—' ? ' <span style="font-size:14px;color:#7c3aed;">XP</span>' : '');
  }

  const elScore = document.getElementById('dash-score');
  if (elScore) elScore.innerHTML = (u.score || 60) + '<span style="font-size:14px;">%</span>';

  // Ranking — posição vem do /usuario/me
  const elRank = document.getElementById('dash-ranking');
  if (elRank) elRank.textContent = u.posicao_ranking ? u.posicao_ranking + 'º' : '—';
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
        <div style="display:flex;align-items:center;gap:4px;">
          ${atrasada ? '<span class="badge badge-atrasada">ATRASADA</span>' : ''}
          <button onclick="event.stopPropagation();excluirTarefa(${t.id})" style="background:none;border:none;color:#475569;cursor:pointer;font-size:13px;padding:2px;" title="Excluir">🗑</button>
        </div>
      </div>
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">${t.titulo}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:11px;color:#64748b;">⏱ ${prazo}</span>
        <span class="badge badge-${t.dificuldade}">${{facil:'Fácil',medio:'Médio',dificil:'Difícil'}[t.dificuldade]}</span>
        <span style="margin-left:auto;font-size:11px;color:${atrasada?'#64748b':'#22c55e'};font-weight:600;">${atrasada?'+0':'+'+xp} XP</span>
      </div>
      ${concluida ? `<div style="display:flex;justify-content:flex-end;margin-top:8px;">
        ${t.tem_post
          ? `<button onclick="event.stopPropagation();navTo('dashboard')" style="padding:5px 12px;border-radius:8px;border:1px solid #7c3aed;background:transparent;color:#c4b5fd;font-size:11px;font-weight:600;cursor:pointer;">Ver post</button>`
          : `<button onclick="event.stopPropagation();abrirEditor(${t.id})" style="padding:5px 12px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">Postar</button>`
        }
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
    let btns = `<button onclick="excluirTarefa(${t.id})" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(239,68,68,0.4);color:#f87171;background:transparent;font-size:13px;font-weight:600;cursor:pointer;margin-right:auto;">🗑 Excluir</button>`;
    if (t.status === 'concluida') {
      btns += `<button class="btn-primary" onclick="fecharModal('modal-tarefa');abrirEditor(${t.id})">Postar</button>`;
    } else if (t.status !== 'concluida') {
      btns += `<button class="btn-green" onclick="concluirTarefa(${t.id})">Concluir tarefa ✓</button>`;
    }
    acaoEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;width:100%;">${btns}</div>`;
  }

  document.getElementById('modal-tarefa').classList.add('open');
}

// Mantém compatibilidade com chamadas antigas inline no HTML
function abrirTarefa(t) { abrirTarefaById(t); }


async function excluirTarefa(id) {
  if (!confirm('Tem certeza que deseja excluir esta tarefa?')) return;
  const { ok } = await apiFetch(`/tarefas/${id}`, 'DELETE');
  if (ok) { fecharModal('modal-tarefa'); mostrarToast('Tarefa excluída'); await carregarTarefas(); }
  else { mostrarToast('Erro ao excluir tarefa', true); }
}

async function concluirTarefa(id) {
  const { ok, data } = await apiFetch(`/tarefas/${id}/concluir`, 'POST');
  fecharModal('modal-tarefa');
  if (ok) {
    const xpGanho = data.xp_ganho || 0;
    const msg = xpGanho > 0
      ? `+${xpGanho} XP ganhos! 🎉`
      : 'Tarefa concluída (sem XP — estava atrasada)';
    mostrarToast(msg);
    // Atualiza localmente
    const u = JSON.parse(localStorage.getItem('usuario') || '{}');
    u.xp_total = data.xp_total;
    if (data.score !== undefined) u.score = data.score;
    localStorage.setItem('usuario', JSON.stringify(u));
    await carregarRanking();
    await Promise.all([carregarTarefas(), atualizarMeuPerfil(), carregarConquistas()]);
  } else {
    mostrarToast(data.mensagem || 'Erro ao concluir tarefa', true);
  }
}

// Nova tarefa
async function criarTarefa() {
  const titulo      = document.getElementById('nova-titulo')?.value?.trim();
  const descricao   = document.getElementById('nova-descricao')?.value?.trim();
  const prazo       = document.getElementById('nova-prazo')?.value;
  const dificuldade = difAtual || 'medio';
  const id_categoria = categoriaAtual || 1;

  if (!titulo) {
    mostrarToast('Preenche os campos para criar a tarefa.', true);
    return;
  }

  const btnCriar = document.querySelector('#modal-nova-tarefa .btn-primary');
  if (btnCriar) { btnCriar.textContent = 'Criando...'; btnCriar.disabled = true; }

  const { ok, data } = await apiFetch('/tarefas', 'POST', {
    titulo, descricao, prazo, dificuldade, id_categoria
  });

  if (btnCriar) { btnCriar.textContent = 'Criar tarefa'; btnCriar.disabled = false; }

  if (ok) {
    fecharModal('modal-nova-tarefa');
    // Limpa campos
    document.getElementById('nova-titulo').value = '';
    const desc = document.getElementById('nova-descricao');
    if (desc) desc.value = '';
    const prazoEl = document.getElementById('nova-prazo');
    if (prazoEl) prazoEl.value = '';
    categoriaAtual = 1;
    difAtual = 'medio';
    const catText = document.getElementById('cat-selected-text');
    if (catText) catText.textContent = 'Selecionar...';
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active-facil','active-medio','active-dificil'));
    const btnMedio = document.querySelector('.diff-btn[onclick*="medio"]');
    if (btnMedio) btnMedio.classList.add('active-medio');
    mostrarToast('Tarefa criada! ✓');
    await carregarTarefas();
  } else {
    mostrarToast(data.mensagem || 'Preenche os campos para criar a tarefa.', true);
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
          <div onclick="abrirPerfilUsuario(${p.id_usuario})" style="width:30px;height:30px;border-radius:100px;background:linear-gradient(135deg,#7c3aed,#3b82f6);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;cursor:pointer;">${iniciais}</div>
          <span onclick="abrirPerfilUsuario(${p.id_usuario})" style="font-size:13px;font-weight:600;cursor:pointer;">${p.usuario_nome}${isYou?' <span style="background:#7c3aed;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;">você</span>':''}</span>
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
  const { ok } = await apiFetch(`/feed/${postId}`, 'DELETE');
  if (ok) {
    document.getElementById('post-card-' + idx)?.remove();
    mostrarToast('Post excluído');
    await carregarTarefas();
  } else {
    mostrarToast('Erro ao excluir post', true);
  }
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

// Mapa conquista nome → arquivo em assets/
const ARTE_MAP = {
  'primeiros passos':     'primeira-vitoria',
  'produtivo':            'uma-maquina',
  'sem freio':            'sem-freio',
  'maquina de tarefas':   'sem-freio',
  'centenario':           'sem-freio',
  'compromisso em dia':   'compromisso-em-dia',
  '7 dias seguidos':      'constancia-inabalavel',
  'constancia inabalavel':'constancia-inabalavel',
  'disciplina de ferro':  'disciplina-de-ferro',
  'compromisso absoluto': 'compromisso-absoluto',
  'mes consistente':      'compromisso-absoluto',
  'primeiro post':        'primeiro-post',
  'influencer':           'influente',
  'influente':            'influente',
  'inspirador':           'inspirador-a',
  'reputacao solida':     'confiavel',
  'confiavel':            'confiavel',
  'elite':                'referencia',
  'referencia':           'referencia',
  'autoridade':           'autoridade',
  'top 3':                'inalcancavel',
  'campeao':              'inalcancavel',
  'inacancavel':          'inalcancavel',
};

function getArteConquista(c) {
  if (c.arte) return c.arte;
  const norm = (c.nome||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  for (const [k,v] of Object.entries(ARTE_MAP)) {
    if (norm.includes(k) || k.includes(norm)) return v;
  }
  return nomeArquivo(c.nome);
}

function renderizarConquistas(conquistas) {
  const grid = document.getElementById('conquistas-grid');
  if (!grid) return;

  const total = conquistas.length;
  const desbloqueadas = conquistas.filter(c => c.desbloqueada).length;
  const pct = total ? Math.round((desbloqueadas / total) * 100) : 0;

  const progBar = document.getElementById('conquistas-fill');
  const progPct = document.getElementById('conquistas-pct');
  if (progBar) progBar.style.width = pct + '%';
  if (progPct) progPct.textContent = pct + '%';

  const emojis = { tarefas:'✅', consistencia:'🔥', social:'🌟', score:'💎', ranking:'🏆' };

  grid.innerHTML = '';
  conquistas.forEach(c => {
    const arte = getArteConquista(c);
    const bloqueada = !c.desbloqueada;
    const emoji = emojis[c.tipo] || '🎖️';

    // Calcula progresso (estimado pelo valor_necessario e tipo)
    // O backend não retorna valor_atual, então mostramos barra só se desbloqueada
    const div = document.createElement('div');
    div.className = 'conquista-card' + (c.desbloqueada ? ' unlocked' : '');
    div.style.cssText = `
      width:180px;min-width:180px;border-radius:16px;padding:0;overflow:hidden;
      background:${c.desbloqueada ? 'linear-gradient(135deg,#4c1d95,#2563eb)' : '#1c2333'};
      border:1px solid ${c.desbloqueada ? 'rgba(124,58,237,0.6)' : '#2a3347'};
      display:flex;flex-direction:column;align-items:center;position:relative;cursor:default;
    `;

    // XP badge no topo
    const xpBadge = document.createElement('div');
    xpBadge.style.cssText = `
      position:absolute;top:10px;right:10px;
      background:rgba(0,0,0,0.5);border-radius:100px;
      padding:2px 8px;font-size:10px;font-weight:700;font-family:'Sora';
      color:${c.desbloqueada ? '#22c55e' : '#94a3b8'};
    `;
    xpBadge.textContent = '+' + c.xp_de_resgate + ' XP';

    // Imagem
    const imgWrap = document.createElement('div');
    imgWrap.style.cssText = 'width:100%;height:130px;display:flex;align-items:center;justify-content:center;padding:16px;';
    const img = document.createElement('img');
    img.src = 'assets/' + arte + '.png';
    img.alt = c.nome;
    img.style.cssText = `width:90px;height:90px;object-fit:contain;${bloqueada ? 'filter:grayscale(100%) brightness(0.4);' : ''}`;
    img.onerror = function() {
      this.outerHTML = `<div style="font-size:52px;${bloqueada?'opacity:0.25':''}">${emoji}</div>`;
    };
    imgWrap.appendChild(img);

    // Info
    const info = document.createElement('div');
    info.style.cssText = `
      width:100%;padding:10px 14px 14px;
      background:rgba(0,0,0,0.25);text-align:center;
    `;
    const nomeEl = document.createElement('div');
    nomeEl.style.cssText = "font-size:13px;font-weight:700;font-family:'Sora';color:#e2e8f0;margin-bottom:3px;";
    nomeEl.textContent = c.nome;
    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:11px;color:#94a3b8;line-height:1.4;margin-bottom:8px;';
    descEl.textContent = c.descricao;

    info.append(nomeEl, descEl);

    if (!c.desbloqueada) {
      const pb = document.createElement('div');
      pb.style.cssText = 'background:rgba(255,255,255,0.1);border-radius:100px;height:5px;overflow:hidden;margin-bottom:4px;';
      const pf = document.createElement('div');
      pf.style.cssText = 'width:0%;height:100%;background:linear-gradient(90deg,#7c3aed,#3b82f6);border-radius:100px;';
      pb.appendChild(pf);
      info.appendChild(pb);
      const pctEl = document.createElement('div');
      pctEl.style.cssText = 'font-size:10px;color:#64748b;';
      pctEl.textContent = '0%';
      info.appendChild(pctEl);
    }

    div.append(xpBadge, imgWrap, info);
    grid.appendChild(div);
  });
}

function renderizarConquistasPerfil(conquistas) {
  const container = document.getElementById('perfil-conquistas');
  if (!container) return;
  const desbloqueadas = conquistas.filter(c => c.desbloqueada).slice(0, 8);
  if (desbloqueadas.length === 0) {
    container.innerHTML = '<p style="font-size:12px;color:#64748b;">Nenhuma conquista ainda.</p>';
    return;
  }
  const emojis = { tarefas:'✅', consistencia:'🔥', social:'🌟', score:'💎', ranking:'🏆' };
  container.innerHTML = desbloqueadas.map(c => {
    const nomeImg = c.arte || nomeArquivo(c.nome);
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;width:50px;text-align:center;">
      <img src="assets/${nomeImg}.png" alt="${c.nome}" style="width:42px;height:42px;object-fit:contain;"
           onerror="this.outerHTML='<div style=\\'width:42px;height:42px;display:flex;align-items:center;justify-content:center;font-size:26px;\\'>${emojis[c.tipo]||'🎖️'}</div>'">
      <span style="font-size:9px;color:#94a3b8;line-height:1.3;">${c.nome}</span>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// RANKING
// ─────────────────────────────────────────────
function calcularPremio(posicao) {
  if (posicao === 1) return '2.000';
  if (posicao <= 3) return '1.000';
  if (posicao <= 10) return '500';
  if (posicao <= 20) return '300';
  if (posicao <= 50) return '200';
  if (posicao <= 100) return '100';
  return '50';
}

async function carregarRanking() {
  const { ok, data } = await apiFetch('/ranking');
  if (!ok) return;

  // Contador de tempo restante
  if (true) {
    const agora = new Date();
    // 0=Dom, 1=Seg … 6=Sab → dias até o próximo domingo (se hoje é dom, conta este mesmo domingo)
    const diasParaDomingo = agora.getDay() === 0 ? 0 : 7 - agora.getDay();
    const proximoDomingo = new Date(agora);
    proximoDomingo.setDate(agora.getDate() + diasParaDomingo);
    proximoDomingo.setHours(23, 59, 0, 0);
    atualizarContadorRanking(proximoDomingo.toISOString());
  }

  // Nome da competição
  const nomeEl = document.getElementById('ranking-nome');
  if (nomeEl && data.competicao) nomeEl.textContent = data.competicao.nome;


  renderizarRanking(data.ranking || []);

  // Atualiza posição do usuário na UI
  const u = usuarioAtual || {};
  const meuRank = (data.ranking || []).find(r => r.id_usuario === u.id);
  if (meuRank && u) {
    u.posicao_ranking = meuRank.posicao;
    localStorage.setItem('usuario', JSON.stringify(u));
    const elRank = document.getElementById('dash-ranking');
    if (elRank) elRank.textContent = meuRank.posicao + 'º';
  }

  // Linha do perfil
  const perfilRow = document.getElementById('perfil-ranking-row');
  if (perfilRow && meuRank) {
    const iniciais = getIniciais(u.nome || 'U');
    perfilRow.innerHTML = `
      <span style="width:60px;font-weight:700;font-family:'Sora';">${meuRank.posicao || '1'}º</span>
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <div style="width:24px;height:24px;border-radius:100px;background:linear-gradient(135deg,#7c3aed,#3b82f6);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;">${iniciais}</div>
        <span>@${u.nome}</span>
      </div>
      <span style="width:90px;font-weight:700;color:#22c55e;">+${calcularPremio(meuRank.posicao)} XP</span>`;
  } else if (perfilRow) {
    perfilRow.innerHTML = '<span style="color:#64748b;font-size:13px;padding:8px;">Participe concluindo tarefas!</span>';
  }
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
  const podium    = document.getElementById('ranking-podium');
  if (!container) return;

  const u = usuarioAtual || {};

  if (rows.length === 0) {
    container.innerHTML = '<p style="color:#64748b;text-align:center;padding:32px;">Nenhum participante no ranking ainda.</p>';
    if (podium) podium.innerHTML = '';
    return;
  }

  // Podium (top 3)
  if (podium && rows.length >= 1) {
    // Ordena: posição 2, 1, 3 visualmente
    const r1 = rows.find(r => (r.posicao||rows.indexOf(r)+1) === 1) || rows[0];
    const r2 = rows.find(r => (r.posicao||rows.indexOf(r)+1) === 2) || null;
    const r3 = rows.find(r => (r.posicao||rows.indexOf(r)+1) === 3) || null;
    const ordem = [r2, r1, r3];
    const alturas = [88, 116, 70];
    const opacidades = [0.25, 0.45, 0.15];
    const tamanhos  = [38, 46, 34];
    const posicoes  = [2, 1, 3];
    podium.innerHTML = ordem.map((r, idx) => {
      if (!r) return '';
      const ini = getIniciais(r.nome);
      const h   = alturas[idx];
      const op  = opacidades[idx];
      const sz  = tamanhos[idx];
      const pos = posicoes[idx];
      const isYou = r.id_usuario === u.id;
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:5px;">
        <div style="width:${sz}px;height:${sz}px;border-radius:100px;background:linear-gradient(135deg,#7c3aed,#3b82f6);display:flex;align-items:center;justify-content:center;font-size:${sz>40?14:11}px;font-weight:700;font-family:'Sora';">${ini}</div>
        <span style="font-size:11px;font-weight:600;">@${r.nome}${isYou?' <span style="background:#7c3aed;color:#fff;font-size:8px;padding:1px 4px;border-radius:3px;">você</span>':''}</span>
        <span style="font-size:10px;color:${pos===1?'#22c55e':'#64748b'};">${r.xp_obtido} XP</span>
        <div class="podium-block" style="width:${sz+52}px;height:${h}px;background:rgba(124,58,237,${op});border:1px solid rgba(124,58,237,${op+0.15});"><span style="font-size:${pos===1?24:pos===2?20:17}px;font-weight:800;font-family:'Sora';">${pos}º</span></div>
      </div>`;
    }).join('');
  }

  // Lista completa
  container.innerHTML = rows.map((r, i) => {
    const isYou = r.id_usuario === u.id;
    const iniciais = getIniciais(r.nome);
    const posicao = r.posicao || (i + 1);
    const scColor = getScoreColor(r.score || 60);
    const medalha = posicao === 1 ? '🥇' : posicao === 2 ? '🥈' : posicao === 3 ? '🥉' : '';
    return `<div class="ranking-row" style="display:flex;gap:16px;padding:12px 20px;border-top:1px solid #2a3347;font-size:13px;align-items:center;${isYou ? 'background:rgba(124,58,237,0.08);' : ''}">
      <span style="width:54px;font-weight:700;font-family:'Sora';">${medalha || (posicao + 'º')}</span>
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <div style="width:26px;height:26px;border-radius:100px;background:linear-gradient(135deg,#7c3aed,#3b82f6);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;">${iniciais}</div>
        <span style="cursor:pointer;" onclick="abrirPerfilUsuario(${r.id_usuario})">@${r.nome}${isYou ? ' <span style="background:#7c3aed;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;">você</span>' : ''}</span>
      </div>
      <span style="width:90px;font-weight:600;">${r.xp_obtido} XP</span>
      <span style="width:90px;font-weight:700;color:#22c55e;">+${calcularPremio(r.posicao)} XP</span>
    </div>`;
  }).join('');
}


// ─────────────────────────────────────────────
// PERFIL DE OUTRO USUÁRIO
// ─────────────────────────────────────────────
async function abrirPerfilUsuario(uid) {
  const u = usuarioAtual || {};
  if (uid === u.id) { navTo('perfil'); return; }
  const { ok, data } = await apiFetch(`/usuario/${uid}`);
  if (!ok) { mostrarToast('Não foi possível carregar o perfil', true); return; }
  const modal = document.getElementById('modal-perfil-usuario');
  if (!modal) return;
  const nivel = getNivelInfo(data.xp_total || 0);
  const ini = getIniciais(data.nome);
  const sc = getScoreColor(data.score || 60);
  const av = document.getElementById('mpu-avatar');
  if (av) { av.textContent = ini; av.style.background = 'linear-gradient(135deg,#7c3aed,#3b82f6)'; }
  const nm = document.getElementById('mpu-nome');
  if (nm) nm.textContent = '@' + data.nome;
  const scEl = document.getElementById('mpu-score');
  if (scEl) { scEl.textContent = 'SCORE ' + (data.score||60) + '%'; scEl.style.background = sc; }
  const nvEl = document.getElementById('mpu-nivel');
  if (nvEl) { nvEl.textContent = '✦ ' + nivel.nome; nvEl.className = 'nivel-tag ' + nivel.cls; }
  const bio = document.getElementById('mpu-bio');
  if (bio) bio.textContent = data.biografia || '';
  const xpPct = calcXpPorcentagem(data.xp_total || 0);
  const nA = NIVEIS_XP.find(n => (data.xp_total||0) >= n.min && (data.xp_total||0) <= n.max) || NIVEIS_XP[0];
  const nP = NIVEIS_XP[NIVEIS_XP.indexOf(nA)+1];
  const xpAt = document.getElementById('mpu-xp-atual');
  const xpPrx = document.getElementById('mpu-xp-prox');
  const xpFill = document.getElementById('mpu-xp-fill');
  if (xpAt) xpAt.textContent = (data.xp_total||0).toLocaleString() + ' XP';
  if (xpPrx) xpPrx.textContent = nP ? nP.min.toLocaleString() + ' XP' : 'Máximo';
  if (xpFill) xpFill.style.width = xpPct + '%';
  const rankRow = document.getElementById('mpu-ranking');
  if (rankRow) {
    if (data.posicao_ranking) {
      rankRow.innerHTML = `<span style="width:58px;font-weight:700;">${data.posicao_ranking}º</span><span style="flex:1;">@${data.nome}</span><span style="width:85px;">${data.xp_ranking} XP</span><span style="width:85px;">${data.tarefas_concluidas} tarefas</span>`;
    } else {
      rankRow.innerHTML = '<span style="color:#64748b;font-size:13px;">Sem dados de ranking</span>';
    }
  }
  document.getElementById('mpu-conquistas').innerHTML = '<span style="font-size:12px;color:#64748b;">—</span>';
  modal.classList.add('open');
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

  const elAtivos  = document.getElementById('adm-usuarios');
  const elNovos   = document.getElementById('adm-novos');
  const elPend    = document.getElementById('pendencias-num');

  if (elAtivos)  elAtivos.textContent  = data.usuarios_ativos;
  if (elNovos)   elNovos.textContent   = data.novos_hoje;
  if (elPend)    elPend.textContent    = data.pendencias;
  pendenciasCount = data.pendencias || 0;

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
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button onclick="penalizarUsuario(${a.id},${a.id_usuario})" style="padding:6px 14px;border-radius:8px;border:none;background:#ef4444;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Penalizar</button>
        <button onclick="descartarAlerta(${a.id})" style="padding:6px 14px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Descartar</button>
        <button onclick="navTo('historico-adm')" style="padding:6px 14px;border-radius:8px;border:1px solid #7c3aed;color:#c4b5fd;font-size:12px;font-weight:600;background:transparent;cursor:pointer;">Ver histórico</button>
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
  apiFetch(`/admin/alertas/${id}/descartar`, 'POST');
}

async function penalizarUsuario(idAlerta, idUsuario) {
  const motivo = prompt('Motivo da penalidade (ex: "Fraude detectada"):');
  if (!motivo) return;
  const { ok, data } = await apiFetch(`/admin/alertas/${idAlerta}/penalizar`, 'POST', {
    id_usuario: idUsuario, motivo
  });
  if (ok) {
    mostrarToast('Penalidade aplicada ✓');
    descartarAlerta(idAlerta);
  } else {
    mostrarToast(data.mensagem || 'Erro ao penalizar', true);
  }
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
async function abrirModalPostar() {
  document.getElementById('modal-postar')?.classList.add('open');
  const lista = document.getElementById('modal-postar-lista');
  if (!lista) return;
  const concluidas = tarefasCache.filter(t => t.status === 'concluida');
  if (concluidas.length === 0) {
    lista.innerHTML = '<p style="color:#64748b;font-size:13px;text-align:center;padding:20px;">Nenhuma tarefa concluída ainda.</p>';
    return;
  }
  const u = usuarioAtual || {};
  const score = u.score || 60;
  lista.innerHTML = concluidas.map(t => {
    const prazo = t.prazo ? t.prazo.substring(5,10).split('-').reverse().join('/') : '—';
    const xp = t.xp_final || calcularXP(t.dificuldade, score, false, t.esta_atrasada);
    const difLabel = {facil:'Fácil',medio:'Médio',dificil:'Difícil'}[t.dificuldade] || t.dificuldade;
    const acaoBtn = t.tem_post
      ? `<button class="btn-primary" onclick="fecharModal('modal-postar');navTo('dashboard')" style="font-size:12px;padding:8px 16px;background:#2a3347;border:1px solid #7c3aed;color:#c4b5fd;">Ver post</button>`
      : `<button class="btn-primary" onclick="fecharModal('modal-postar');abrirEditor(${t.id})" style="font-size:12px;padding:8px 16px;">Postar</button>`;
    return `<div style="margin-bottom:14px;">
      <div class="badge-cat" style="margin-bottom:8px;">${t.categoria_icone||'📌'} ${t.categoria_nome||'Geral'}</div>
      <div style="background:#161b27;border:1px solid #2a3347;border-radius:12px;padding:14px;display:flex;align-items:center;gap:12px;">
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;margin-bottom:5px;">${t.titulo}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:#64748b;">⏱ ${prazo}</span>
            <span class="badge badge-${t.dificuldade}">${difLabel}</span>
            <span style="font-size:11px;color:#22c55e;font-weight:600;">+${xp} XP</span>
          </div>
        </div>
        ${acaoBtn}
      </div>
    </div>`;
  }).join('');
}

async function publicarPost() {
  const modal    = document.getElementById('modal-editor');
  const tarefaId = modal?.getAttribute('data-tarefa');
  const legenda  = document.getElementById('editor-legenda')?.value || '';
  const previewImg = document.getElementById('preview-media')?.querySelector('img');
  const url_imagem = previewImg?.src?.startsWith('data:') ? previewImg.src : '';
  if (!tarefaId) { mostrarToast('Nenhuma tarefa selecionada', true); return; }
  const btn = modal?.querySelector('.btn-primary');
  if (btn) { btn.textContent = 'Publicando...'; btn.disabled = true; }
  const { ok, data } = await apiFetch('/feed', 'POST', { id_tarefa: parseInt(tarefaId), url_imagem, legenda });
  if (btn) { btn.textContent = 'Postar'; btn.disabled = false; }
  if (ok) {
    fecharModal('modal-editor'); fecharModal('modal-postar');
    mostrarToast('Postagem publicada! 🎉');
    const idx2 = tarefasCache.findIndex(t => t.id === parseInt(tarefaId));
    if (idx2 !== -1) tarefasCache[idx2].tem_post = true;
    await Promise.all([carregarTarefas(), carregarFeed()]);
    navTo('dashboard');
  } else { mostrarToast(data.mensagem || 'Erro ao publicar', true); }
}

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


// ─────────────────────────────────────────────
// CATEGORIA — modal nova tarefa
// ─────────────────────────────────────────────
function toggleCatDropdown() {
  const list = document.getElementById('cat-list');
  if (!list) return;
  list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

function selectCat(nome) {
  const texto = document.getElementById('cat-selected-text');
  if (texto) texto.textContent = nome;
  const list = document.getElementById('cat-list');
  if (list) list.style.display = 'none';
  const mapa = {
    '📘 Desenvolvimento Pessoal': 1,
    '💼 Trabalho': 2,
    '📚 Estudo': 3,
    '💪 Saúde & Fitness': 4,
    '💰 Finanças': 5,
    '🏠 Casa & Rotina': 6,
  };
  categoriaAtual = mapa[nome] || 1;
}

// Fecha dropdown ao clicar fora
document.addEventListener('click', function(e) {
  const dd = document.getElementById('cat-dropdown');
  const list = document.getElementById('cat-list');
  if (dd && list && !dd.contains(e.target)) {
    list.style.display = 'none';
  }
});

function selecionarDif(dif) { setDif(null, dif); }

function setDif(btn, dif) {
  difAtual = dif;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active-facil', 'active-medio', 'active-dificil'));
  if (btn) btn.classList.add('active-' + dif);
  else {
    const b = document.querySelector('.diff-btn[onclick*="' + dif + '"]');
    if (b) b.classList.add('active-' + dif);
  }
  const u = usuarioAtual || {};
  const xpPreview = document.getElementById('nova-xp-preview');
  if (xpPreview) xpPreview.textContent = '+' + calcularXPPreview(dif, u.score || 60) + ' XP';
}

function nomeArquivo(nome) {
  return nome
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(([a-z])\)/g, '-$1')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
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
// INIT após DOM carregado
// ─────────────────────────────────────────────
window.addEventListener('load', () => {
  iniciarSortable();
});
