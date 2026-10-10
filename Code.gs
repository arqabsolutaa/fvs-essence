/**
 * FVS Essence — Backend (Google Apps Script)
 * Sistema de Ficha de Verificação de Serviço — Essence Residence / Absoluta Construtora
 *
 * Publicar como Web App: Executar como "Eu" · Quem tem acesso: "Qualquer pessoa".
 * Este arquivo NÃO contém senhas. As senhas são gravadas (com hash) nas Propriedades
 * do Script pela função configurarSenhas(), rodada uma única vez no editor.
 *
 * Primeira vez: rodar setup() e depois configurarSenhas() e criarGatilhoBackupDiario().
 * Ao colar uma versão nova deste arquivo: rodar setup() de novo (cria abas novas e repara
 * cabeçalhos sem apagar dados) e reimplantar o Web App com "Nova versão".
 *
 * Perfis: admin (Bárbara) · consulta (Gabriel e Jailton, só leitura) · encarregado (criados pela Bárbara na tela
 * Cadastros → Usuários; só registram e veem as próprias fotos de andamento).
 */

const VERSAO = '1.8.0';
/** Enquanto true, usuário que AINDA NÃO tem senha definida entra sem senha. Quem já tem senha continua exigindo. */
const PERMITIR_SEM_SENHA = false;
const TZ = 'America/Sao_Paulo';
const USUARIOS = ['Bárbara', 'Gabriel']; // usuários fixos; encarregados ficam na aba Usuarios
const ADMIN = 'Bárbara';
const MAX_FOTOS_REGISTRO = 12;
const SESSAO_SEGUNDOS = 21600; // 6 h (máximo do CacheService), renovada a cada uso
const PASTA_FOTOS = 'FVS_Essence_Fotos';
const PASTA_BACKUP = 'Backup_FVS_Essence';
const MAX_FOTO_BYTES = 6 * 1024 * 1024;

const ABAS = {
  Modelos: ['id', 'nome', 'descricao', 'ativo', 'criado_em', 'atualizado_em', 'disciplina_id', 'escopo', 'encarregado'],
  ModeloItens: ['id', 'modelo_id', 'ordem', 'descricao', 'criterio', 'exige_foto'],
  Fornecedores: ['id', 'nome', 'servicos', 'contato', 'ativo'],
  Apartamentos: ['id', 'codigo', 'tipo', 'ativo'],
  FVS: ['id', 'numero', 'data', 'apartamento', 'modelo_id', 'modelo_nome', 'fornecedor_id', 'fornecedor_nome',
        'responsavel_obra', 'status', 'observacao', 'assinatura_nome', 'criado_por', 'criado_em', 'atualizado_em', 'disciplina_id'],
  FVS_Itens: ['id', 'fvs_id', 'item_id', 'ordem', 'descricao', 'criterio', 'resultado', 'observacao'],
  Pendencias: ['id', 'fvs_id', 'fvs_item_id', 'apartamento', 'servico', 'fornecedor_nome', 'descricao', 'responsavel',
               'prazo', 'status', 'reinspecoes', 'reinspecao_data', 'reinspecao_obs', 'criado_em', 'resolvido_em', 'resolvido_por'],
  Fotos: ['id', 'fvs_id', 'fvs_item_id', 'pendencia_id', 'tipo', 'drive_id', 'criado_em', 'criado_por', 'registro_id', 'observacao_id'],
  Disciplinas: ['id', 'nome', 'ativo'],
  PontosAndamento: ['id', 'disciplina_id', 'ordem', 'nome', 'descricao'],
  Registros: ['id', 'apartamento', 'disciplina_id', 'disciplina_nome', 'ponto_id', 'ponto_nome', 'ambiente', 'legenda',
              'capturado_em', 'criado_por', 'criado_em'],
  ObservacoesGerais: ['id', 'disciplina_id', 'disciplina_nome', 'local', 'relacionada', 'texto', 'status', 'criado_por', 'criado_em', 'resolvido_em'],
  Usuarios: ['id', 'nome', 'perfil', 'disciplinas', 'ativo'],
  Log: ['data', 'usuario', 'acao', 'ref', 'detalhe'],
  Auditoria_Excluidos: ['data', 'usuario', 'aba', 'id', 'linha_json']
};

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function props_() { return PropertiesService.getScriptProperties(); }

function ss_() {
  const id = props_().getProperty('SS_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function aba_(nome) {
  const sh = ss_().getSheetByName(nome);
  if (!sh) throw new Error('Aba "' + nome + '" não encontrada. Rode setup() no Apps Script.');
  return sh;
}

function agora_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function erro_(msg) { return { ok: false, erro: msg }; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function texto_(v, max) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return s.length > (max || 2000) ? s.slice(0, max || 2000) : s;
}

function idValido_(id) { return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id); }

function novoId_() { return Utilities.getUuid(); }

function dataValida_(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function lerAba_(nome) {
  const sh = aba_(nome);
  const cab = ABAS[nome];
  const n = sh.getLastRow();
  if (n < 2) return [];
  const v = sh.getRange(2, 1, n - 1, cab.length).getValues();
  return v.map(function (linha, i) {
    const o = {};
    cab.forEach(function (c, j) {
      let x = linha[j];
      if (x instanceof Date) x = Utilities.formatDate(x, TZ, 'yyyy-MM-dd HH:mm:ss');
      o[c] = (x === null || x === undefined) ? '' : x;
    });
    o._linha = i + 2;
    return o;
  });
}

function limpar_(o) { const c = {}; Object.keys(o).forEach(function (k) { if (k !== '_linha') c[k] = o[k]; }); return c; }

function linhaDe_(nome, obj) { return ABAS[nome].map(function (c) { const v = obj[c]; return (v === undefined || v === null) ? '' : v; }); }

function inserir_(nome, obj) {
  const sh = aba_(nome);
  const linha = linhaDe_(nome, obj);
  sh.getRange(sh.getLastRow() + 1, 1, 1, linha.length).setValues([linha]);
}

function achar_(nome, id) {
  const sh = aba_(nome);
  const n = sh.getLastRow();
  if (n < 2) return null;
  const ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return { sh: sh, linha: i + 2 };
  }
  return null;
}

function atualizar_(nome, id, patch) {
  const f = achar_(nome, id);
  if (!f) throw new Error('Registro não encontrado em ' + nome + '.');
  const cab = ABAS[nome];
  const atual = f.sh.getRange(f.linha, 1, 1, cab.length).getValues()[0];
  cab.forEach(function (c, j) { if (Object.prototype.hasOwnProperty.call(patch, c)) atual[j] = patch[c]; });
  f.sh.getRange(f.linha, 1, 1, cab.length).setValues([atual]);
}

/** Reescreve todas as linhas de dados de uma aba (usado só para abas filhas pequenas). */
function reescrever_(nome, objs) {
  const sh = aba_(nome);
  const cab = ABAS[nome];
  const n = sh.getLastRow();
  if (n >= 2) sh.getRange(2, 1, n - 1, cab.length).clearContent();
  if (objs.length) {
    const v = objs.map(function (o) { return linhaDe_(nome, o); });
    sh.getRange(2, 1, v.length, cab.length).setValues(v);
  }
}

function registrarLog_(usuario, acao, ref, detalhe) {
  try {
    inserir_('Log', { data: agora_(), usuario: usuario, aba: '', acao: acao, ref: ref || '', detalhe: texto_(detalhe, 500) });
  } catch (e) { console.error('Falha ao gravar log: ' + e); }
}

/** Guarda o conteúdo completo de linhas excluídas. Só cresce. */
function auditarExclusao_(usuario, aba, obj) {
  inserir_('Auditoria_Excluidos', {
    data: agora_(), usuario: usuario, aba: aba, id: obj.id || '', linha_json: JSON.stringify(limpar_(obj))
  });
}

function pasta_(nome) {
  const it = DriveApp.getFoldersByName(nome);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nome);
}

function pastaFotos_() {
  const p = props_();
  const id = p.getProperty('PASTA_FOTOS_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recria abaixo */ } }
  const f = pasta_(PASTA_FOTOS);
  p.setProperty('PASTA_FOTOS_ID', f.getId());
  return f;
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

function copiarPlanilha_(rotulo) {
  const nome = 'FVS_Essence_' + rotulo + '_' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd_HHmm');
  DriveApp.getFileById(ss_().getId()).makeCopy(nome, pasta_(PASTA_BACKUP));
}

/** Cópia da planilha antes de exclusões (no máximo 1 a cada 10 minutos). */
function backupAntes_() {
  const p = props_();
  const ult = Number(p.getProperty('ULT_BACKUP') || 0);
  if (Date.now() - ult < 10 * 60 * 1000) return;
  try { copiarPlanilha_('antes-exclusao'); p.setProperty('ULT_BACKUP', String(Date.now())); }
  catch (e) { console.error('Falha no backup: ' + e); }
}

function backupDiario() {
  copiarPlanilha_('diario');
  const limite = Date.now() - 30 * 24 * 3600 * 1000;
  const arquivos = pasta_(PASTA_BACKUP).getFiles();
  while (arquivos.hasNext()) {
    const a = arquivos.next();
    if (a.getDateCreated().getTime() < limite) a.setTrashed(true);
  }
}

function criarGatilhoBackupDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupDiario').timeBased().everyDays(1).atHour(2).create();
  Logger.log('Backup diário agendado (cerca de 2h). Cópias com mais de 30 dias vão para a lixeira.');
}

/* ------------------------------------------------------------------ */
/* Autenticação (tudo conferido no servidor)                           */
/* ------------------------------------------------------------------ */

function hashSenha_(senha, sal) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + '|' + senha, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/**
 * Rodar UMA vez no editor: digite as senhas abaixo, rode a função e DEPOIS APAGUE
 * as senhas do código (volte para '') e salve. Só o hash fica guardado.
 */
function configurarSenhas() {
  const SENHAS = { 'Bárbara': '', 'Gabriel': '' };
  let feitos = [];
  USUARIOS.forEach(function (u) {
    const s = SENHAS[u];
    if (!s) return;
    validarPin_(s);
    const sal = Utilities.getUuid();
    props_().setProperty('SENHA_' + u, sal + ':' + hashSenha_(s, sal));
    feitos.push(u);
  });
  Logger.log(feitos.length ? 'Senhas gravadas para: ' + feitos.join(', ') + '. Agora apague as senhas do código e salve.'
                           : 'Nenhuma senha preenchida. Digite as senhas em SENHAS, rode de novo e depois apague.');
}


/**
 * Menu "FVS" na planilha: define as senhas por janelas de pergunta, sem editar o código.
 * Aparece ao recarregar a planilha (depois de colar este arquivo).
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('FVS')
    .addItem('Definir senhas', 'definirSenhasPeloMenu')
    .addItem('Ativar backup diário', 'criarGatilhoBackupDiario')
    .addToUi();
}

function definirSenhasPeloMenu() {
  const ui = SpreadsheetApp.getUi();
  const feitos = [];
  for (let i = 0; i < USUARIOS.length; i++) {
    const u = USUARIOS[i];
    const r = ui.prompt('Senha de ' + u, 'Digite a senha de ' + u + ' (só números, de 4 a 8 dígitos). Cancele para pular.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) continue;
    const s = String(r.getResponseText() || '');
    if (!/^\d{4,8}$/.test(s)) { ui.alert('A senha de ' + u + ' deve ter de 4 a 8 números. Rode "Definir senhas" de novo.'); return; }
    definirSenha_(u, s); feitos.push(u);
  }
  ui.alert(feitos.length ? 'Senhas definidas para: ' + feitos.join(', ') + '.' : 'Nenhuma senha foi alterada.');
}

/** Senha numérica de 4 a 8 dígitos. */
function validarPin_(s) { if (!/^\d{4,8}$/.test(String(s))) throw new Error('A senha deve ter de 4 a 8 números.'); }

function definirSenha_(nome, senha) {
  validarPin_(senha);
  const sal = Utilities.getUuid();
  props_().setProperty('SENHA_' + nome, sal + ':' + hashSenha_(senha, sal));
}

/** Perfil e restrições do usuário. null se não existir ou estiver arquivado. */
function infoUsuario_(nome) {
  if (nome === ADMIN) return { nome: nome, perfil: 'admin', disciplinas: [] };
  if (USUARIOS.indexOf(nome) >= 0) return { nome: nome, perfil: 'consulta', disciplinas: [] };
  const r = lerAba_('Usuarios').filter(function (x) { return x.nome === nome && x.ativo !== 'nao'; })[0];
  if (!r) return null;
  if (r.perfil === 'completo' || r.perfil === 'consulta') return { nome: nome, perfil: 'consulta', disciplinas: String(r.disciplinas || '').split(',').filter(Boolean) }; // lê tudo; escreve só nas disciplinas listadas
  return { nome: nome, perfil: 'encarregado', disciplinas: String(r.disciplinas || '').split(',').filter(Boolean) };
}

/** Lista pública de nomes para a tela de login (só nomes, nada mais). */
function listarUsuarios_() {
  const discs = lerAba_('Disciplinas').filter(function (d) { return d.ativo !== 'nao'; });
  const nomeDisc = {}; discs.forEach(function (d) { nomeDisc[d.id] = d.nome; });
  const lista = USUARIOS.map(function (n) { return { nome: n, competencias: ['Administração'] }; });
  lerAba_('Usuarios').forEach(function (x) {
    if (x.ativo === 'nao' || !x.nome) return;
    if (x.perfil === 'completo' || x.perfil === 'consulta') {
      const extra = String(x.disciplinas || '').split(',').filter(function (id) { return nomeDisc[id]; }).map(function (id) { return nomeDisc[id]; });
      lista.push({ nome: x.nome, competencias: ['Administração'].concat(extra) }); return;
    }
    const comp = String(x.disciplinas || '').split(',').filter(function (id) { return nomeDisc[id]; }).map(function (id) { return nomeDisc[id]; });
    if (comp.length) lista.push({ nome: x.nome, competencias: comp });
  });
  const competencias = ['Administração'];
  discs.forEach(function (d) { if (lista.some(function (u) { return u.competencias.indexOf(d.nome) >= 0; })) competencias.push(d.nome); });
  const sem = PERMITIR_SEM_SENHA ? lista.map(function (u) { return u.nome; }).filter(function (n) { return !props_().getProperty('SENHA_' + n); }) : [];
  return { ok: true, usuarios: lista.map(function (u) { return u.nome; }), lista: lista, competencias: competencias, semSenha: sem };
}

function login_(req) {
  const u = String(req.usuario || '').trim();
  const info = u ? infoUsuario_(u) : null;
  if (!info) return erro_('Usuário inválido.');
  const cache = CacheService.getScriptCache();
  if (cache.get('BLOQ_' + u)) return erro_('Muitas tentativas. Aguarde 10 minutos.');
  const reg = props_().getProperty('SENHA_' + u);
  if (!reg && PERMITIR_SEM_SENHA) {
    const tk = Utilities.getUuid() + Utilities.getUuid();
    cache.put('TK_' + tk, u, SESSAO_SEGUNDOS);
    registrarLog_(u, 'login', '', 'sem senha');
    return { ok: true, token: tk, usuario: u, perfil: info.perfil, admin: info.perfil === 'admin', disciplinas: info.disciplinas };
  }
  if (!reg) return erro_(info.perfil === 'encarregado' ? 'Senha não definida. Peça para a Bárbara redefinir.' : 'Senha ainda não configurada. Rode configurarSenhas() no Apps Script.');
  const partes = reg.split(':');
  if (hashSenha_(String(req.senha || ''), partes[0]) !== partes[1]) {
    const n = Number(cache.get('ERR_' + u) || 0) + 1;
    cache.put('ERR_' + u, String(n), 600);
    registrarLog_(u, 'login_falhou', '', 'tentativa ' + n);
    if (n >= 5) { cache.put('BLOQ_' + u, '1', 600); return erro_('Muitas tentativas. Aguarde 10 minutos.'); }
    return erro_('Senha incorreta.');
  }
  cache.remove('ERR_' + u);
  const token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('TK_' + token, u, SESSAO_SEGUNDOS);
  registrarLog_(u, 'login', '', '');
  return { ok: true, token: token, usuario: u, perfil: info.perfil, admin: info.perfil === 'admin', disciplinas: info.disciplinas };
}

function sessao_(token) {
  if (!token || typeof token !== 'string' || token.length < 40) return null;
  const cache = CacheService.getScriptCache();
  const u = cache.get('TK_' + token);
  if (!u) return null;
  cache.put('TK_' + token, u, SESSAO_SEGUNDOS); // renova enquanto o uso continua
  return u;
}

function exigirAdmin_(u) { if (u !== ADMIN) throw new Error('Acesso restrito.'); }

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setup() {
  const p = props_();
  if (!p.getProperty('SS_ID')) p.setProperty('SS_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  const planilha = ss_();
  Object.keys(ABAS).forEach(function (nome) {
    const cab = ABAS[nome];
    let sh = planilha.getSheetByName(nome);
    if (!sh) sh = planilha.insertSheet(nome);
    // Texto puro: evita que a planilha converta datas/números e quebre os valores
    sh.getRange(1, 1, sh.getMaxRows(), cab.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#6b6f73').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });
  ['Sheet1', 'Página1', 'Planilha1'].forEach(function (n) {
    const sh = planilha.getSheetByName(n);
    if (sh && planilha.getSheets().length > 1 && sh.getLastRow() <= 1 && sh.getLastColumn() <= 1) planilha.deleteSheet(sh);
  });
  pastaFotos_();
  pasta_(PASTA_BACKUP);
  semear_();
  semearAndamento_();
  Logger.log('Setup concluído. Abas, pastas do Drive e exemplos prontos. Se for a primeira vez, o próximo passo é configurarSenhas().');
}

/** Garante as disciplinas básicas (sem pontos): a Bárbara edita a lista depois em Cadastros → Disciplinas. */
function garantirCompetencias_() {
  const nomes = lerAba_('Disciplinas').map(function (d) { return String(d.nome).toLowerCase(); });
  ['Hidráulica', 'Elétrica', 'Civil', 'Estrutura', 'Revestimentos', 'Marmoraria', 'Personalize'].forEach(function (n) {
    if (nomes.indexOf(n.toLowerCase()) < 0) inserir_('Disciplinas', { id: novoId_(), nome: n, ativo: 'sim' });
  });
}

function semearAndamento_() {
  if (lerAba_('Disciplinas').length) { garantirCompetencias_(); return; }
  const base = [
    ['Hidráulica', [
      ['Shaft aberto — prumadas', 'Caminho das prumadas antes de fechar o shaft'],
      ['Ramais de água fria e quente', 'Trajeto das tubulações antes de fechar parede ou piso'],
      ['Nicho do box — ponto e caminho', 'Posição do ponto e caminho da tubulação até o nicho'],
      ['Pontos de água na parede', 'Alturas e posições dos pontos antes do revestimento'],
      ['Esgoto e ralos', 'Ralos, caixas sifonadas e caimentos'],
      ['Teste de pressão', 'Registro do teste com manômetro']
    ]],
    ['Elétrica', [
      ['Eletrodutos na laje', 'Trajeto dos eletrodutos antes da concretagem ou contrapiso'],
      ['Eletrodutos nas paredes', 'Caminhos e caixas antes de fechar a alvenaria'],
      ['Pontos de tomada e interruptor', 'Posição e altura das caixas'],
      ['Quadro de distribuição', 'Quadro aberto, circuitos e identificação'],
      ['Passagem de cabos', 'Fiação nos eletrodutos e identificação dos circuitos']
    ]],
    ['Ar-condicionado', [
      ['Tubulação frigorígena', 'Trajeto das linhas de cobre e do dreno'],
      ['Pontos de dreno', 'Posição e caimento do dreno'],
      ['Infraestrutura elétrica da máquina', 'Ponto de força e comando']
    ]]
  ];
  base.forEach(function (d) {
    const id = novoId_();
    inserir_('Disciplinas', { id: id, nome: d[0], ativo: 'sim' });
    d[1].forEach(function (p, i) {
      inserir_('PontosAndamento', { id: novoId_(), disciplina_id: id, ordem: String(i + 1), nome: p[0], descricao: p[1] });
    });
  });
  garantirCompetencias_();
}

function semear_() {
  if (lerAba_('Modelos').length) return;
  const agora = agora_();
  const modelos = [
    {
      nome: 'Revestimento cerâmico (piso e parede)',
      descricao: 'Modelo de exemplo — edite os itens e critérios conforme o projeto.',
      itens: [
        ['Substrato limpo, nivelado e curado antes do assentamento', 'Sem poeira, óleo ou resíduos; planicidade conferida com régua'],
        ['Argamassa colante conforme especificação do fabricante', 'Tipo adequado à peça; dupla colagem em peças grandes; sem vazios sob a peça'],
        ['Lote e data de fabricação conferidos', 'Etiqueta registrada; tonalidade uniforme dentro do ambiente'],
        ['Peças sem trincas, lascas ou manchas', 'Nenhuma peça com defeito aparente assentada'],
        ['Alinhamento e juntas', 'Juntas uniformes e alinhadas conforme projeto'],
        ['Planicidade e nivelamento', 'Sem degraus entre peças nem ondulações perceptíveis'],
        ['Teste de som cavo', 'Sem som cavo na percussão das peças'],
        ['Cortes, recortes e cantos', 'Cortes limpos e acabamento correto em soleiras, ralos e quinas'],
        ['Caimento em áreas molhadas', 'Caimento para o ralo conforme projeto, sem empoçamento'],
        ['Rejuntamento e limpeza final', 'Rejunte completo e uniforme; superfície limpa e sem respingos']
      ]
    },
    {
      nome: 'Impermeabilização',
      descricao: 'Modelo de exemplo — edite os itens e critérios conforme o projeto.',
      itens: [
        ['Substrato regularizado e preparado', 'Superfície limpa, firme, com cantos arredondados e ralos fixados'],
        ['Sistema e número de demãos conforme especificação', 'Produto e demãos de acordo com o projeto de impermeabilização'],
        ['Tempo de secagem entre demãos respeitado', 'Conforme orientação do fabricante'],
        ['Reforços em ralos, tubulações e cantos', 'Reforço executado conforme projeto'],
        ['Subida nas paredes e rodapés', 'Altura de subida conforme projeto e norma'],
        ['Teste de estanqueidade', 'Realizado e registrado, com duração conforme projeto/norma, sem vazamentos'],
        ['Proteção mecânica executada após o teste', 'Proteção aplicada sem danificar a manta ou a camada impermeável']
      ]
    },
    {
      nome: 'Esquadrias de alumínio',
      descricao: 'Modelo de exemplo — edite os itens e critérios conforme o projeto.',
      itens: [
        ['Vão e contramarco conferidos', 'Dimensões conforme projeto; prumo e nível corretos'],
        ['Fixação firme', 'Esquadria fixada sem folgas ou movimentos'],
        ['Vedação perimetral', 'Selante contínuo e bem acabado em todo o perímetro'],
        ['Funcionamento', 'Abre, fecha e trava suavemente, sem atrito ou ruído'],
        ['Acabamento do perfil', 'Sem riscos, amassados ou manchas; película de proteção preservada'],
        ['Vidros e borrachas', 'Vidros sem trincas ou riscos; borrachas bem assentadas'],
        ['Drenagem dos trilhos', 'Furos de drenagem livres e funcionando'],
        ['Teste de estanqueidade', 'Teste com água sem infiltração']
      ]
    }
  ];
  modelos.forEach(function (m) {
    const id = novoId_();
    inserir_('Modelos', { id: id, nome: m.nome, descricao: m.descricao, ativo: 'sim', criado_em: agora, atualizado_em: agora });
    m.itens.forEach(function (it, i) {
      inserir_('ModeloItens', { id: novoId_(), modelo_id: id, ordem: String(i + 1), descricao: it[0], criterio: it[1] });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

function bootstrap_(req, u, info) {
  const out = function (nome) { return lerAba_(nome).map(limpar_); };
  const base = { ok: true, usuario: u, perfil: info.perfil, admin: info.perfil === 'admin', restricao: info.disciplinas };
  let disc = out('Disciplinas');
  let pontos = out('PontosAndamento');
  if (info.perfil === 'encarregado') {
    // Encarregado só enxerga o necessário para registrar fotos
    disc = disc.filter(function (d) { return info.disciplinas.indexOf(d.id) >= 0; });
    pontos = pontos.filter(function (p) { return info.disciplinas.indexOf(p.disciplina_id) >= 0; });
    disc = disc.filter(function (d) { return d.ativo !== 'nao'; });
    const meus = function (x) { return info.disciplinas.indexOf(x.disciplina_id) >= 0; };
    const modelos = out('Modelos').filter(function (m) { return meus(m) && (!m.encarregado || m.encarregado === u); });
    const mids = {}; modelos.forEach(function (m) { mids[m.id] = true; });
    const fvs = out('FVS').filter(meus);
    const fids = {}; fvs.forEach(function (f) { fids[f.id] = true; });
    return Object.assign(base, {
      apartamentos: out('Apartamentos').filter(function (a) { return a.ativo !== 'nao'; }),
      disciplinas: disc, pontos: pontos,
      modelos: modelos, itens: out('ModeloItens').filter(function (i) { return mids[i.modelo_id]; }),
      fornecedores: out('Fornecedores').filter(function (f) { return f.ativo !== 'nao'; }),
      fvs: fvs, pendencias: out('Pendencias').filter(function (p) { return fids[p.fvs_id]; })
    });
  }
  return Object.assign(base, {
    modelos: out('Modelos'), itens: out('ModeloItens'), fornecedores: out('Fornecedores'),
    apartamentos: out('Apartamentos'), fvs: out('FVS'), pendencias: out('Pendencias'),
    disciplinas: disc, pontos: pontos,
    usuarios: info.perfil === 'admin' ? out('Usuarios') : []
  });
}

/** Encarregado só mexe em checklists das disciplinas dele. */
function podeFVS_(f, info) {
  return info.perfil !== 'encarregado' || info.disciplinas.indexOf(f.disciplina_id) >= 0;
}
/** Quem não é admin só escreve nas disciplinas liberadas para ele. */
function restritoEscrita_(info) { return info.perfil !== 'admin'; }
function podeFVSEscrita_(f, info) { return !restritoEscrita_(info) || info.disciplinas.indexOf(f.disciplina_id) >= 0; }

function getFVS_(req, u, info) {
  const id = String(req.id || '');
  const f = lerAba_('FVS').filter(function (x) { return x.id === id; })[0];
  if (!f || !podeFVS_(f, info)) throw new Error('FVS não encontrada.');
  const itens = lerAba_('FVS_Itens').filter(function (x) { return x.fvs_id === id; })
    .sort(function (a, b) { return Number(a.ordem) - Number(b.ordem); }).map(limpar_);
  const fotos = lerAba_('Fotos').filter(function (x) { return x.fvs_id === id; }).map(function (x) { const c = limpar_(x); delete c.drive_id; return c; });
  const pend = lerAba_('Pendencias').filter(function (x) { return x.fvs_id === id; }).map(limpar_);
  return { ok: true, fvs: limpar_(f), itens: itens, fotos: fotos, pendencias: pend };
}

/** Onde o checklist se aplica: 'Unidade', 'Torre' (áreas comuns) ou '' (os dois). */
function escopoValido_(e) { return e === 'Unidade' || e === 'Torre' ? e : ''; }
/** Encarregado específico (opcional): precisa existir e ter a disciplina. Vazio = todos da disciplina. */
function encarregadoValido_(nome, discId) {
  nome = texto_(nome, 60).trim();
  if (!nome) return '';
  const i = infoUsuario_(nome);
  if (!i || i.perfil !== 'encarregado' || i.disciplinas.indexOf(discId) < 0) throw new Error('O encarregado escolhido não é desta disciplina.');
  return nome;
}

function salvarModelo_(req, u) {
  const m = req.modelo || {};
  const itens = req.itens || [];
  const nome = texto_(m.nome, 120).trim();
  if (!nome) throw new Error('Informe o nome do modelo.');
  if (!itens.length) throw new Error('O modelo precisa de ao menos um item.');
  const id = idValido_(m.id) ? m.id : novoId_();
  const agora = agora_();
  const existe = achar_('Modelos', id);
  const discId = idValido_(m.disciplina_id) && achar_('Disciplinas', m.disciplina_id) ? m.disciplina_id : '';
  const escopo = escopoValido_(m.escopo);
  const enc = encarregadoValido_(m.encarregado, discId);
  if (existe) atualizar_('Modelos', id, { nome: nome, descricao: texto_(m.descricao, 500), atualizado_em: agora, disciplina_id: discId, escopo: escopo, encarregado: enc });
  else inserir_('Modelos', { id: id, nome: nome, descricao: texto_(m.descricao, 500), ativo: 'sim', criado_em: agora, atualizado_em: agora, disciplina_id: discId, escopo: escopo, encarregado: enc });
  const outros = lerAba_('ModeloItens').filter(function (x) { return x.modelo_id !== id; }).map(limpar_);
  const novos = [];
  itens.forEach(function (it, i) {
    const d = texto_(it.descricao, 300).trim();
    if (!d) return;
    novos.push({ id: idValido_(it.id) ? it.id : novoId_(), modelo_id: id, ordem: String(novos.length + 1), descricao: d, criterio: texto_(it.criterio, 500).trim(), exige_foto: it.exige_foto ? 'sim' : '' });
  });
  if (!novos.length) throw new Error('O modelo precisa de ao menos um item com descrição.');
  reescrever_('ModeloItens', outros.concat(novos));
  registrarLog_(u, existe ? 'modelo_editado' : 'modelo_criado', id, nome);
  return { ok: true, id: id };
}

function alterarAtivo_(req, u) {
  const aba = String(req.aba || '');
  if (['Modelos', 'Fornecedores', 'Apartamentos', 'Disciplinas', 'Usuarios'].indexOf(aba) < 0) throw new Error('Aba inválida.');
  if (aba === 'Usuarios') exigirAdmin_(u);
  const ativo = req.ativo ? 'sim' : 'nao';
  atualizar_(aba, String(req.id || ''), { ativo: ativo });
  registrarLog_(u, ativo === 'sim' ? 'reativado' : 'arquivado', String(req.id), aba);
  return { ok: true };
}

function salvarFornecedor_(req, u) {
  const f = req.fornecedor || {};
  const nome = texto_(f.nome, 120).trim();
  if (!nome) throw new Error('Informe o nome do fornecedor.');
  const id = idValido_(f.id) ? f.id : novoId_();
  const dados = { nome: nome, servicos: texto_(f.servicos, 300), contato: texto_(f.contato, 200) };
  if (achar_('Fornecedores', id)) atualizar_('Fornecedores', id, dados);
  else inserir_('Fornecedores', Object.assign({ id: id, ativo: 'sim' }, dados));
  registrarLog_(u, 'fornecedor_salvo', id, nome);
  return { ok: true, id: id };
}

function salvarApartamentos_(req, u) {
  const tipo = req.tipo === 'Área comum' ? 'Área comum' : 'Apartamento';
  const codigos = (req.codigos || []).map(function (c) { return texto_(c, 60).trim(); }).filter(Boolean);
  const existentes = {};
  lerAba_('Apartamentos').forEach(function (a) { existentes[String(a.codigo).toLowerCase()] = true; });
  let criados = 0;
  codigos.forEach(function (c) {
    if (existentes[c.toLowerCase()]) return;
    existentes[c.toLowerCase()] = true;
    inserir_('Apartamentos', { id: novoId_(), codigo: c, tipo: tipo, ativo: 'sim' });
    criados++;
  });
  registrarLog_(u, 'apartamentos_adicionados', '', criados + ' novo(s)');
  return { ok: true, criados: criados };
}

const SIGLAS = { hidraulica: 'HID', eletrica: 'ELE', civil: 'CIV', revestimentos: 'REV', marmoraria: 'MAR', estrutura: 'EST', personalize: 'PER', 'ar-condicionado': 'ARC', 'ar condicionado': 'ARC' };
/** Sigla de 3 letras da disciplina (usada no número da FVS e no nome do PDF). */
function siglaDisc_(nome) {
  const n = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (SIGLAS[n]) return SIGLAS[n];
  return n.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase();
}
/** Numeração por disciplina: FVS-HID-0001, FVS-ELE-0001… Sem disciplina: FVS-0001. */
function proximoNumero_(sigla) {
  const p = props_();
  const chave = sigla ? 'SEQ_' + sigla : 'SEQ_FVS';
  const n = Number(p.getProperty(chave) || 0) + 1;
  p.setProperty(chave, String(n));
  return 'FVS-' + (sigla ? sigla + '-' : '') + ('0000' + n).slice(-4);
}

function recalcStatus_(fvsId) {
  const pend = lerAba_('Pendencias').filter(function (p) { return p.fvs_id === fvsId && p.status !== 'Cancelada'; });
  let st = 'Aprovada';
  if (pend.length) st = pend.some(function (p) { return p.status === 'Aberta'; }) ? 'Com pendência' : 'Reinspecionada';
  atualizar_('FVS', fvsId, { status: st, atualizado_em: agora_() });
  return st;
}

function salvarFVS_(req, u, info) {
  const f = req.fvs || {};
  const itens = req.itens || [];
  const pend = req.pendencias || {};
  if (!idValido_(f.id)) throw new Error('Identificador da FVS inválido.');
  if (!dataValida_(f.data)) throw new Error('Informe a data da verificação.');
  const apto = texto_(f.apartamento, 60).trim();
  if (!apto) throw new Error('Informe o apartamento.');
  if (!itens.length) throw new Error('A FVS não tem itens.');
  const nomeServico = texto_(f.modelo_nome, 120);
  const modelo = f.modelo_id ? lerAba_('Modelos').filter(function (x) { return x.id === f.modelo_id; })[0] : null;
  const discFVS = modelo ? String(modelo.disciplina_id || '') : '';
  if (restritoEscrita_(info)) {
    if (info.disciplinas.indexOf(discFVS) < 0 || (modelo && modelo.encarregado && modelo.encarregado !== u)) throw new Error('Você não tem acesso a este checklist.');
    const ja = lerAba_('FVS').filter(function (x) { return x.id === f.id; })[0];
    if (ja && info.disciplinas.indexOf(ja.disciplina_id) < 0) throw new Error('Acesso restrito.');
  }
  const ids = {};
  itens.forEach(function (it, i) {
    if (!idValido_(it.id) || ids[it.id]) throw new Error('Item ' + (i + 1) + ' com identificador inválido.');
    ids[it.id] = true;
    if (['C', 'NC', 'NA'].indexOf(it.resultado) < 0) throw new Error('O item ' + (i + 1) + ' não foi avaliado.');
    if (it.resultado === 'NC') {
      const d = pend[it.id] || {};
      if (!texto_(d.responsavel, 120).trim()) throw new Error('Informe o responsável pela correção no item ' + (i + 1) + '.');
      if (!dataValida_(d.prazo)) throw new Error('Informe o prazo da correção no item ' + (i + 1) + '.');
    }
  });

  const agora = agora_();
  const existente = achar_('FVS', f.id);
  const cab = {
    data: f.data, apartamento: apto, modelo_id: texto_(f.modelo_id, 64), modelo_nome: nomeServico,
    fornecedor_id: texto_(f.fornecedor_id, 64), fornecedor_nome: texto_(f.fornecedor_nome, 120),
    responsavel_obra: texto_(f.responsavel_obra, 120), observacao: texto_(f.observacao, 2000),
    assinatura_nome: texto_(f.assinatura_nome, 120), atualizado_em: agora, disciplina_id: discFVS
  };
  if (existente) {
    atualizar_('FVS', f.id, cab);
  } else {
    inserir_('FVS', Object.assign({ id: f.id, numero: proximoNumero_(discFVS ? siglaDisc_((lerAba_('Disciplinas').filter(function (d) { return d.id === discFVS; })[0] || {}).nome) : ''), status: 'Aprovada', criado_por: u, criado_em: agora }, cab));
  }

  // Itens: substitui os da FVS
  const outrosItens = lerAba_('FVS_Itens').filter(function (x) { return x.fvs_id !== f.id; }).map(limpar_);
  const novosItens = itens.map(function (it, i) {
    return {
      id: it.id, fvs_id: f.id, item_id: texto_(it.item_id, 64), ordem: String(i + 1),
      descricao: texto_(it.descricao, 300), criterio: texto_(it.criterio, 500),
      resultado: it.resultado, observacao: texto_(it.observacao, 1000)
    };
  });
  reescrever_('FVS_Itens', outrosItens.concat(novosItens));

  // Pendências: uma por item não conforme
  const atuais = lerAba_('Pendencias').filter(function (p) { return p.fvs_id === f.id; });
  itens.forEach(function (it) {
    const p = atuais.filter(function (x) { return x.fvs_item_id === it.id; })[0];
    if (it.resultado === 'NC') {
      const d = pend[it.id];
      const dados = {
        apartamento: apto, servico: nomeServico, fornecedor_nome: cab.fornecedor_nome,
        descricao: texto_(d.descricao || it.descricao, 600), responsavel: texto_(d.responsavel, 120).trim(), prazo: d.prazo
      };
      if (!p) {
        inserir_('Pendencias', Object.assign({
          id: novoId_(), fvs_id: f.id, fvs_item_id: it.id, status: 'Aberta', reinspecoes: '0', criado_em: agora
        }, dados));
      } else if (p.status === 'Aberta') {
        atualizar_('Pendencias', p.id, dados);
      } else if (p.status === 'Cancelada') {
        atualizar_('Pendencias', p.id, Object.assign({ status: 'Aberta' }, dados));
      }
    } else if (p && p.status === 'Aberta') {
      atualizar_('Pendencias', p.id, { status: 'Cancelada' });
    }
  });
  const status = recalcStatus_(f.id);
  const numero = lerAba_('FVS').filter(function (x) { return x.id === f.id; })[0].numero;
  registrarLog_(u, existente ? 'fvs_editada' : 'fvs_criada', f.id, numero + ' · apto ' + apto + ' · ' + nomeServico);
  return { ok: true, id: f.id, numero: numero, status: status };
}

function reinspecionar_(req, u, info) {
  const id = String(req.id || '');
  const p = lerAba_('Pendencias').filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('Pendência não encontrada.');
  if (p.status !== 'Aberta') throw new Error('Esta pendência não está aberta.');
  if (restritoEscrita_(info)) {
    const fv = lerAba_('FVS').filter(function (x) { return x.id === p.fvs_id; })[0];
    if (!fv || !podeFVSEscrita_(fv, info)) throw new Error('Acesso restrito.');
  }
  const agora = agora_();
  const obs = texto_(req.obs, 1000);
  const n = String(Number(p.reinspecoes || 0) + 1);
  let patch;
  if (req.resultado === 'ok') {
    patch = { status: 'Resolvida', reinspecoes: n, reinspecao_data: agora, reinspecao_obs: obs, resolvido_em: agora, resolvido_por: u };
  } else if (req.resultado === 'nok') {
    patch = { reinspecoes: n, reinspecao_data: agora, reinspecao_obs: obs };
    if (req.novo_prazo) {
      if (!dataValida_(req.novo_prazo)) throw new Error('Novo prazo inválido.');
      patch.prazo = req.novo_prazo;
    }
  } else {
    throw new Error('Informe o resultado da reinspeção.');
  }
  atualizar_('Pendencias', id, patch);
  const status = recalcStatus_(p.fvs_id);
  registrarLog_(u, req.resultado === 'ok' ? 'pendencia_resolvida' : 'pendencia_reprovada', id, p.apartamento + ' · ' + texto_(p.descricao, 120));
  return { ok: true, status: status };
}

function uploadFoto_(req, u, info) {
  const id = req.id;
  if (!idValido_(id)) throw new Error('Identificador da foto inválido.');
  const tipos = ['item', 'assinatura', 'reinspecao', 'andamento', 'observacao'];
  if (tipos.indexOf(req.tipo) < 0) throw new Error('Tipo de foto inválido.');
  if (achar_('Fotos', id)) return { ok: true, id: id, repetida: true }; // reenvio seguro
  let fvsId = '';
  let registroId = '';
  let obsId = '';
  if (req.tipo === 'andamento') {
    registroId = String(req.registro_id || '');
    const reg = lerAba_('Registros').filter(function (x) { return x.id === registroId; })[0];
    if (!reg) throw new Error('Registro não encontrado para a foto.');
    if (restritoEscrita_(info) && info.disciplinas.indexOf(reg.disciplina_id) < 0) throw new Error('Acesso restrito.');
    const qtd = lerAba_('Fotos').filter(function (x) { return x.registro_id === registroId; }).length;
    if (qtd >= MAX_FOTOS_REGISTRO) throw new Error('Limite de ' + MAX_FOTOS_REGISTRO + ' fotos por registro.');
  } else if (req.tipo === 'observacao') {
    obsId = String(req.observacao_id || '');
    const ob = lerAba_('ObservacoesGerais').filter(function (x) { return x.id === obsId; })[0];
    if (!ob) throw new Error('Observação não encontrada para a foto.');
    if (restritoEscrita_(info) && info.disciplinas.indexOf(ob.disciplina_id) < 0) throw new Error('Acesso restrito.');
    const qo = lerAba_('Fotos').filter(function (x) { return x.observacao_id === obsId; }).length;
    if (qo >= MAX_FOTOS_REGISTRO) throw new Error('Limite de ' + MAX_FOTOS_REGISTRO + ' fotos por observação.');
  } else {
    fvsId = String(req.fvs_id || '');
    const fv = lerAba_('FVS').filter(function (x) { return x.id === fvsId; })[0];
    if (!fv) throw new Error('FVS não encontrada para a foto.');
    if (!podeFVSEscrita_(fv, info)) throw new Error('Acesso restrito.');
  }
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+\/=]+)$/.exec(String(req.dataUrl || ''));
  if (!m) throw new Error('Imagem inválida.');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_FOTO_BYTES) throw new Error('Imagem muito grande.');
  const ext = m[1] === 'image/png' ? '.png' : '.jpg';
  const arquivo = pastaFotos_().createFile(Utilities.newBlob(bytes, m[1], (registroId ? 'andamento_' : obsId ? 'obs_' : 'fvs_') + id + ext));
  inserir_('Fotos', {
    id: id, fvs_id: fvsId, fvs_item_id: texto_(req.fvs_item_id, 64), pendencia_id: texto_(req.pendencia_id, 64),
    tipo: req.tipo, drive_id: arquivo.getId(), criado_em: agora_(), criado_por: u, registro_id: registroId, observacao_id: obsId
  });
  return { ok: true, id: id };
}

/** Encarregado só lê fotos de andamento das disciplinas dele. */
function podeVerFoto_(foto, u, info, regsCache) {
  if (info.perfil !== 'encarregado') return true;
  if (foto.tipo === 'andamento') {
    if (!regsCache.mapa) { regsCache.mapa = {}; lerAba_('Registros').forEach(function (r) { regsCache.mapa[r.id] = r; }); }
    const r = regsCache.mapa[foto.registro_id];
    return !!r && info.disciplinas.indexOf(r.disciplina_id) >= 0;
  }
  if (foto.tipo === 'observacao') {
    if (!regsCache.obs) { regsCache.obs = {}; lerAba_('ObservacoesGerais').forEach(function (o) { regsCache.obs[o.id] = o; }); }
    const o = regsCache.obs[foto.observacao_id];
    return !!o && info.disciplinas.indexOf(o.disciplina_id) >= 0;
  }
  if (!regsCache.fvs) { regsCache.fvs = {}; lerAba_('FVS').forEach(function (x) { regsCache.fvs[x.id] = x; }); }
  const fv = regsCache.fvs[foto.fvs_id];
  return !!fv && info.disciplinas.indexOf(fv.disciplina_id) >= 0;
}

function dataUrlDaFoto_(foto) {
  const blob = DriveApp.getFileById(foto.drive_id).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function getFoto_(req, u, info) {
  const foto = lerAba_('Fotos').filter(function (x) { return x.id === String(req.id || ''); })[0];
  if (!foto || !podeVerFoto_(foto, u, info, {})) throw new Error('Foto não encontrada.');
  return { ok: true, id: foto.id, dataUrl: dataUrlDaFoto_(foto) };
}

/** Várias fotos numa chamada só (máx. 6), para carregar galerias mais rápido. */
function getFotos_(req, u, info) {
  const ids = (req.ids || []).slice(0, 6).map(String);
  const todas = lerAba_('Fotos');
  const fotos = {}; const falhas = []; const cacheR = {};
  ids.forEach(function (id) {
    const foto = todas.filter(function (x) { return x.id === id; })[0];
    if (!foto || !podeVerFoto_(foto, u, info, cacheR)) { falhas.push(id); return; }
    try { fotos[id] = dataUrlDaFoto_(foto); } catch (e) { falhas.push(id); }
  });
  return { ok: true, fotos: fotos, falhas: falhas };
}

function excluirFoto_(req, u) {
  const id = String(req.id || '');
  const foto = lerAba_('Fotos').filter(function (x) { return x.id === id; })[0];
  if (!foto) return { ok: true };
  backupAntes_();
  auditarExclusao_(u, 'Fotos', foto); // o arquivo continua guardado no Drive
  const f = achar_('Fotos', id);
  if (f) f.sh.deleteRow(f.linha);
  registrarLog_(u, 'foto_excluida', id, foto.tipo);
  return { ok: true };
}

function removerLinhas_(nome, coluna, valor, u) {
  const linhas = lerAba_(nome).filter(function (x) { return String(x[coluna]) === String(valor); });
  linhas.forEach(function (x) { auditarExclusao_(u, nome, x); });
  linhas.map(function (x) { return x._linha; }).sort(function (a, b) { return b - a; })
    .forEach(function (n) { aba_(nome).deleteRow(n); });
}

function excluirFVS_(req, u) {
  exigirAdmin_(u);
  const id = String(req.id || '');
  const f = lerAba_('FVS').filter(function (x) { return x.id === id; })[0];
  if (!f) throw new Error('FVS não encontrada.');
  backupAntes_();
  removerLinhas_('Fotos', 'fvs_id', id, u);
  removerLinhas_('Pendencias', 'fvs_id', id, u);
  removerLinhas_('FVS_Itens', 'fvs_id', id, u);
  removerLinhas_('FVS', 'id', id, u);
  registrarLog_(u, 'fvs_excluida', id, f.numero + ' · apto ' + f.apartamento);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Andamento: disciplinas, pontos e registros de fotos                  */
/* ------------------------------------------------------------------ */

function salvarDisciplina_(req, u) {
  const d = req.disciplina || {};
  const nome = texto_(d.nome, 80).trim();
  if (!nome) throw new Error('Informe o nome da disciplina.');
  const pontos = (req.pontos || []).filter(function (p) { return texto_(p.nome, 120).trim(); });
  if (!pontos.length) throw new Error('Inclua ao menos um ponto com nome.');
  const id = idValido_(d.id) ? d.id : novoId_();
  const existe = achar_('Disciplinas', id);
  if (existe) atualizar_('Disciplinas', id, { nome: nome });
  else inserir_('Disciplinas', { id: id, nome: nome, ativo: 'sim' });
  const outros = lerAba_('PontosAndamento').filter(function (x) { return x.disciplina_id !== id; }).map(limpar_);
  const novos = pontos.map(function (p, i) {
    return { id: idValido_(p.id) ? p.id : novoId_(), disciplina_id: id, ordem: String(i + 1), nome: texto_(p.nome, 120).trim(), descricao: texto_(p.descricao, 300).trim() };
  });
  reescrever_('PontosAndamento', outros.concat(novos));
  registrarLog_(u, existe ? 'disciplina_editada' : 'disciplina_criada', id, nome + ' · ' + novos.length + ' pontos');
  return { ok: true, id: id };
}

const FORMATO_CAPTURA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function salvarRegistro_(req, u, info) {
  const r = req.registro || {};
  if (!idValido_(r.id)) throw new Error('Identificador do registro inválido.');
  const existente = lerAba_('Registros').filter(function (x) { return x.id === r.id; })[0];
  if (existente) { // reenvio da fila: não duplica
    if (restritoEscrita_(info) && info.disciplinas.indexOf(existente.disciplina_id) < 0) throw new Error('Acesso restrito.');
    return { ok: true, id: r.id, repetido: true };
  }
  const apto = texto_(r.apartamento, 60).trim();
  if (!apto) throw new Error('Informe o apartamento.');
  const disc = lerAba_('Disciplinas').filter(function (x) { return x.id === r.disciplina_id; })[0];
  if (!disc) throw new Error('Disciplina não encontrada.');
  if (restritoEscrita_(info) && info.disciplinas.indexOf(disc.id) < 0) {
    throw new Error('Você não tem acesso a esta disciplina.');
  }
  let pontoId = ''; let pontoNome = '';
  const legenda = texto_(r.legenda, 1000).trim();
  if (r.ponto_id) {
    const p = lerAba_('PontosAndamento').filter(function (x) { return x.id === r.ponto_id && x.disciplina_id === disc.id; })[0];
    if (!p) throw new Error('Ponto não encontrado nesta disciplina.');
    pontoId = p.id; pontoNome = p.nome;
  } else {
    pontoNome = texto_(r.ponto_nome, 120).trim();
    if (!pontoNome) throw new Error('Informe o ponto.');
    if (!legenda) throw new Error('Para um ponto fora da lista, descreva na legenda.');
  }
  const captura = FORMATO_CAPTURA.test(String(r.capturado_em || '')) ? r.capturado_em : agora_();
  inserir_('Registros', {
    id: r.id, apartamento: apto, disciplina_id: disc.id, disciplina_nome: disc.nome, ponto_id: pontoId, ponto_nome: pontoNome,
    ambiente: texto_(r.ambiente, 80).trim(), legenda: legenda, capturado_em: captura, criado_por: u, criado_em: agora_()
  });
  registrarLog_(u, 'registro_criado', r.id, 'apto ' + apto + ' · ' + disc.nome + ' · ' + pontoNome);
  return { ok: true, id: r.id };
}

function getAndamento_(req, u, info) {
  let regs = lerAba_('Registros').map(limpar_);
  if (info.perfil === 'encarregado') regs = regs.filter(function (x) { return info.disciplinas.indexOf(x.disciplina_id) >= 0; });
  const ids = {};
  regs.forEach(function (r) { ids[r.id] = true; });
  const fotos = lerAba_('Fotos').filter(function (f) { return f.tipo === 'andamento' && ids[f.registro_id]; })
    .map(function (f) { return { id: f.id, registro_id: f.registro_id, criado_em: f.criado_em }; });
  return { ok: true, registros: regs, fotos: fotos };
}

function excluirRegistro_(req, u) {
  exigirAdmin_(u);
  const id = String(req.id || '');
  const r = lerAba_('Registros').filter(function (x) { return x.id === id; })[0];
  if (!r) throw new Error('Registro não encontrado.');
  backupAntes_();
  removerLinhas_('Fotos', 'registro_id', id, u);
  removerLinhas_('Registros', 'id', id, u);
  registrarLog_(u, 'registro_excluido', id, 'apto ' + r.apartamento + ' · ' + r.disciplina_nome + ' · ' + r.ponto_nome);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Usuários encarregados (só a Bárbara)                                */
/* ------------------------------------------------------------------ */

function salvarUsuario_(req, u) {
  exigirAdmin_(u);
  const d = req.usuario || {};
  const todos = lerAba_('Usuarios');
  const existente = idValido_(d.id) ? todos.filter(function (x) { return x.id === d.id; })[0] : null;
  const nome = existente ? existente.nome : texto_(d.nome, 60).trim(); // o nome não muda: os registros ficam ligados a ele
  if (nome.length < 2) throw new Error('Informe o nome do encarregado.');
  const lower = nome.toLowerCase();
  if (!existente) {
    if (USUARIOS.some(function (x) { return x.toLowerCase() === lower; })) throw new Error('Este nome é reservado.');
    if (todos.some(function (x) { return String(x.nome).toLowerCase() === lower; })) throw new Error('Já existe um usuário com esse nome.');
  }
  const pedido = existente ? existente.perfil : d.perfil;
  const perfil = (pedido === 'completo' || pedido === 'consulta' || d.perfil === 'consulta') ? 'consulta' : 'encarregado';
  const disciplinas = (d.disciplinas || []).map(String).filter(idValido_);
  const senha = String(d.senha || '');
  if (!existente && !senha && !PERMITIR_SEM_SENHA) throw new Error('Informe a senha (4 a 8 números).');
  if (senha) validarPin_(senha);
  let id;
  if (existente) {
    id = existente.id;
    atualizar_('Usuarios', id, { disciplinas: disciplinas.join(','), perfil: perfil });
  } else {
    id = novoId_();
    inserir_('Usuarios', { id: id, nome: nome, perfil: perfil, disciplinas: disciplinas.join(','), ativo: 'sim' });
  }
  if (senha) definirSenha_(nome, senha);
  registrarLog_(u, existente ? (senha ? 'usuario_editado_senha_redefinida' : 'usuario_editado') : 'usuario_criado', id, nome);
  return { ok: true, id: id };
}

/* ------------------------------------------------------------------ */
/* Observações gerais (reclamações e avisos por disciplina)             */
/* ------------------------------------------------------------------ */

function salvarObservacao_(req, u, info) {
  const o = req.observacao || {};
  if (!idValido_(o.id)) throw new Error('Identificador da observação inválido.');
  const existente = lerAba_('ObservacoesGerais').filter(function (x) { return x.id === o.id; })[0];
  if (existente) { // reenvio da fila: não duplica
    if (restritoEscrita_(info) && info.disciplinas.indexOf(existente.disciplina_id) < 0) throw new Error('Acesso restrito.');
    return { ok: true, id: o.id, repetido: true };
  }
  const disc = lerAba_('Disciplinas').filter(function (x) { return x.id === o.disciplina_id; })[0];
  if (!disc) throw new Error('Disciplina não encontrada.');
  if (restritoEscrita_(info) && info.disciplinas.indexOf(disc.id) < 0) throw new Error('Você não tem acesso a esta disciplina.');
  const texto = texto_(o.texto, 2000).trim();
  if (!texto) throw new Error('Descreva a observação.');
  inserir_('ObservacoesGerais', {
    id: o.id, disciplina_id: disc.id, disciplina_nome: disc.nome, local: texto_(o.local, 100).trim(),
    relacionada: texto_(o.relacionada, 100).trim(), texto: texto, status: 'Aberta', criado_por: u, criado_em: agora_()
  });
  registrarLog_(u, 'observacao_criada', o.id, disc.nome + ' · ' + texto_(texto, 100));
  return { ok: true, id: o.id };
}

function getObservacoes_(req, u, info) {
  let obs = lerAba_('ObservacoesGerais').map(limpar_);
  if (info.perfil === 'encarregado') obs = obs.filter(function (x) { return info.disciplinas.indexOf(x.disciplina_id) >= 0; });
  const ids = {}; obs.forEach(function (x) { ids[x.id] = true; });
  const fotos = lerAba_('Fotos').filter(function (f) { return f.tipo === 'observacao' && ids[f.observacao_id]; })
    .map(function (f) { return { id: f.id, observacao_id: f.observacao_id, criado_em: f.criado_em }; });
  return { ok: true, observacoes: obs, fotos: fotos };
}

function resolverObservacao_(req, u) {
  const id = String(req.id || '');
  const ob = lerAba_('ObservacoesGerais').filter(function (x) { return x.id === id; })[0];
  if (!ob) throw new Error('Observação não encontrada.');
  const resolvida = !!req.resolvida;
  atualizar_('ObservacoesGerais', id, { status: resolvida ? 'Resolvida' : 'Aberta', resolvido_em: resolvida ? agora_() : '' });
  registrarLog_(u, resolvida ? 'observacao_resolvida' : 'observacao_reaberta', id, ob.disciplina_nome);
  return { ok: true };
}

function excluirObservacao_(req, u) {
  const id = String(req.id || '');
  const ob = lerAba_('ObservacoesGerais').filter(function (x) { return x.id === id; })[0];
  if (!ob) throw new Error('Observação não encontrada.');
  backupAntes_();
  removerLinhas_('Fotos', 'observacao_id', id, u);
  removerLinhas_('ObservacoesGerais', 'id', id, u);
  registrarLog_(u, 'observacao_excluida', id, ob.disciplina_nome + ' · ' + texto_(ob.texto, 80));
  return { ok: true };
}

/**
 * Biblioteca de serviços: a tela envia os serviços marcados e a disciplina de destino.
 * Cada serviço vira um checklist da disciplina; os pontos de foto sugeridos entram na lista da disciplina.
 * Serviço com o mesmo nome na mesma disciplina não é duplicado.
 */
function adicionarServicos_(req, u) {
  const disc = lerAba_('Disciplinas').filter(function (x) { return x.id === req.disciplina_id; })[0];
  if (!disc) throw new Error('Disciplina não encontrada.');
  const servicos = (req.servicos || []).slice(0, 60);
  if (!servicos.length) throw new Error('Marque ao menos um serviço.');
  const escopo = escopoValido_(req.escopo);
  const enc = encarregadoValido_(req.encarregado, disc.id);
  const chave = function (nome, esc, en) { return String(nome).toLowerCase() + '|' + (esc || '') + '|' + (en || ''); };
  const modelosAtuais = lerAba_('Modelos').filter(function (m) { return m.disciplina_id === disc.id; });
  const nomesM = {}; modelosAtuais.forEach(function (m) { nomesM[chave(m.nome, m.escopo, m.encarregado)] = true; });
  const pontosAtuais = lerAba_('PontosAndamento').filter(function (p) { return p.disciplina_id === disc.id; });
  const nomesP = {}; pontosAtuais.forEach(function (p) { nomesP[String(p.nome).toLowerCase()] = true; });
  let ordemP = pontosAtuais.length;
  const agora = agora_();
  let nM = 0; let nP = 0; let jaTinha = 0;
  servicos.forEach(function (sv) {
    const nome = texto_(sv.nome, 120).trim();
    const itens = (sv.itens || []).map(function (it) { return { d: texto_(it[0], 300).trim(), c: texto_(it[1], 500).trim(), f: it[2] ? 'sim' : '' }; }).filter(function (it) { return it.d; });
    if (!nome) return;
    if (nomesM[chave(nome, escopo, enc)]) { jaTinha++; }
    else if (itens.length) {
      const id = novoId_();
      inserir_('Modelos', { id: id, nome: nome, descricao: texto_(sv.descricao, 500), ativo: 'sim', criado_em: agora, atualizado_em: agora, disciplina_id: disc.id, escopo: escopo, encarregado: enc });
      itens.forEach(function (it, i) { inserir_('ModeloItens', { id: novoId_(), modelo_id: id, ordem: String(i + 1), descricao: it.d, criterio: it.c, exige_foto: it.f }); });
      nomesM[chave(nome, escopo, enc)] = true; nM++;
    }
    (sv.pontos || []).forEach(function (p) {
      const pn = texto_(p[0], 120).trim();
      if (!pn || nomesP[pn.toLowerCase()]) return;
      nomesP[pn.toLowerCase()] = true; ordemP++; nP++;
      inserir_('PontosAndamento', { id: novoId_(), disciplina_id: disc.id, ordem: String(ordemP), nome: pn, descricao: texto_(p[1], 300).trim() });
    });
  });
  registrarLog_(u, 'servicos_adicionados', disc.id, disc.nome + ' · ' + nM + ' checklist(s), ' + nP + ' ponto(s) de foto');
  return { ok: true, checklists: nM, pontos: nP, jaExistiam: jaTinha };
}

function getLog_(req, u) {
  exigirAdmin_(u);
  return { ok: true, log: lerAba_('Log').map(limpar_).reverse().slice(0, 500) };
}

function getExcluidos_(req, u) {
  exigirAdmin_(u);
  const lista = lerAba_('Auditoria_Excluidos').map(limpar_).reverse().slice(0, 300);
  return { ok: true, excluidos: lista };
}

/**
 * Cada ação: [função, quem pode, é só leitura?]
 * Quem pode: 'T' = todos os perfis (leitura; encarregado vê só o que é da disciplina dele)
 * · 'E' = admin e encarregado (escrever) · 'A' = só admin. O perfil 'consulta' (Gabriel, Jailton) só lê.
 */
const ACOES = {
  bootstrap: [bootstrap_, 'T', true],
  getFoto: [getFoto_, 'T', true],
  getFotos: [getFotos_, 'T', true],
  getAndamento: [getAndamento_, 'T', true],
  getFVS: [getFVS_, 'T', true],
  getObservacoes: [getObservacoes_, 'T', true],
  salvarRegistro: [salvarRegistro_, 'E', false],
  uploadFoto: [uploadFoto_, 'E', false],
  salvarFVS: [salvarFVS_, 'E', false],
  reinspecionar: [reinspecionar_, 'E', false],
  salvarObservacao: [salvarObservacao_, 'E', false],
  salvarModelo: [salvarModelo_, 'A', false],
  alterarAtivo: [alterarAtivo_, 'A', false],
  salvarFornecedor: [salvarFornecedor_, 'A', false],
  salvarApartamentos: [salvarApartamentos_, 'A', false],
  salvarDisciplina: [salvarDisciplina_, 'A', false],
  adicionarServicos: [adicionarServicos_, 'A', false],
  excluirFoto: [excluirFoto_, 'A', false],
  excluirFVS: [excluirFVS_, 'A', false],
  excluirRegistro: [excluirRegistro_, 'A', false],
  excluirObservacao: [excluirObservacao_, 'A', false],
  resolverObservacao: [resolverObservacao_, 'A', false],
  salvarUsuario: [salvarUsuario_, 'A', false],
  getLog: [getLog_, 'A', true],
  getExcluidos: [getExcluidos_, 'A', true]
};

function perfilPermitido_(regra, info) {
  const perfil = info.perfil;
  if (regra === 'T') return true;
  // escrita: admin e encarregado; 'consulta' só se tiver disciplinas liberadas (ex.: Jailton em Revestimentos)
  if (regra === 'E') return perfil === 'admin' || perfil === 'encarregado' || (perfil === 'consulta' && info.disciplinas.length > 0);
  return perfil === 'admin';
}

/* ------------------------------------------------------------------ */
/* Ponto de entrada                                                    */
/* ------------------------------------------------------------------ */

function doGet() { return json_({ ok: true, sistema: 'FVS Essence', versao: VERSAO }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json_(erro_('Requisição inválida.')); }
  try {
    if (req.action === 'ping') return json_({ ok: true, versao: VERSAO });
    if (req.action === 'listarUsuarios') return json_(listarUsuarios_());
    if (req.action === 'login') return json_(login_(req));
    const usuario = sessao_(req.token);
    const info = usuario ? infoUsuario_(usuario) : null; // usuário arquivado perde o acesso na hora
    if (!info) return json_({ ok: false, sessao: false, erro: 'Sessão expirada. Entre novamente.' });
    const acao = ACOES[req.action];
    if (!acao) return json_(erro_('Ação desconhecida.'));
    if (!perfilPermitido_(acao[1], info)) return json_(erro_('Acesso restrito.'));
    let lock = null;
    if (!acao[2]) {
      lock = LockService.getScriptLock();
      try { lock.waitLock(30000); }
      catch (errLock) { return json_({ ok: false, ocupado: true, erro: 'Servidor ocupado. Tente de novo em instantes.' }); }
    }
    try { return json_(acao[0](req, usuario, info)); }
    finally { if (lock) lock.releaseLock(); }
  } catch (err) {
    console.error(err);
    return json_(erro_(err && err.message ? err.message : String(err)));
  }
}
