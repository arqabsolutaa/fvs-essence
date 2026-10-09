/**
 * FVS Essence — Backend (Google Apps Script)
 * Sistema de Ficha de Verificação de Serviço — Essence Residence / Absoluta Construtora
 *
 * Publicar como Web App: Executar como "Eu" · Quem tem acesso: "Qualquer pessoa".
 * Este arquivo NÃO contém senhas. As senhas são gravadas (com hash) nas Propriedades
 * do Script pela função configurarSenhas(), rodada uma única vez no editor.
 *
 * Primeira vez: rodar setup() e depois configurarSenhas() e criarGatilhoBackupDiario().
 */

const VERSAO = '1.0.0';
const TZ = 'America/Sao_Paulo';
const USUARIOS = ['Bárbara', 'Gabriel'];
const ADMIN = 'Bárbara';
const SESSAO_SEGUNDOS = 21600; // 6 h (máximo do CacheService), renovada a cada uso
const PASTA_FOTOS = 'FVS_Essence_Fotos';
const PASTA_BACKUP = 'Backup_FVS_Essence';
const MAX_FOTO_BYTES = 6 * 1024 * 1024;

const ABAS = {
  Modelos: ['id', 'nome', 'descricao', 'ativo', 'criado_em', 'atualizado_em'],
  ModeloItens: ['id', 'modelo_id', 'ordem', 'descricao', 'criterio'],
  Fornecedores: ['id', 'nome', 'servicos', 'contato', 'ativo'],
  Apartamentos: ['id', 'codigo', 'tipo', 'ativo'],
  FVS: ['id', 'numero', 'data', 'apartamento', 'modelo_id', 'modelo_nome', 'fornecedor_id', 'fornecedor_nome',
        'responsavel_obra', 'status', 'observacao', 'assinatura_nome', 'criado_por', 'criado_em', 'atualizado_em'],
  FVS_Itens: ['id', 'fvs_id', 'item_id', 'ordem', 'descricao', 'criterio', 'resultado', 'observacao'],
  Pendencias: ['id', 'fvs_id', 'fvs_item_id', 'apartamento', 'servico', 'fornecedor_nome', 'descricao', 'responsavel',
               'prazo', 'status', 'reinspecoes', 'reinspecao_data', 'reinspecao_obs', 'criado_em', 'resolvido_em', 'resolvido_por'],
  Fotos: ['id', 'fvs_id', 'fvs_item_id', 'pendencia_id', 'tipo', 'drive_id', 'criado_em', 'criado_por'],
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
    if (s.length < 6) throw new Error('A senha de ' + u + ' precisa ter ao menos 6 caracteres.');
    const sal = Utilities.getUuid();
    props_().setProperty('SENHA_' + u, sal + ':' + hashSenha_(s, sal));
    feitos.push(u);
  });
  Logger.log(feitos.length ? 'Senhas gravadas para: ' + feitos.join(', ') + '. Agora apague as senhas do código e salve.'
                           : 'Nenhuma senha preenchida. Digite as senhas em SENHAS, rode de novo e depois apague.');
}

function login_(req) {
  const u = String(req.usuario || '');
  if (USUARIOS.indexOf(u) < 0) return erro_('Usuário inválido.');
  const cache = CacheService.getScriptCache();
  if (cache.get('BLOQ_' + u)) return erro_('Muitas tentativas. Aguarde 10 minutos.');
  const reg = props_().getProperty('SENHA_' + u);
  if (!reg) return erro_('Senha ainda não configurada. Rode configurarSenhas() no Apps Script.');
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
  return { ok: true, token: token, usuario: u, admin: u === ADMIN };
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
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#43331e').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });
  ['Sheet1', 'Página1', 'Planilha1'].forEach(function (n) {
    const sh = planilha.getSheetByName(n);
    if (sh && planilha.getSheets().length > 1 && sh.getLastRow() <= 1 && sh.getLastColumn() <= 1) planilha.deleteSheet(sh);
  });
  pastaFotos_();
  pasta_(PASTA_BACKUP);
  semear_();
  Logger.log('Setup concluído. Abas, pastas do Drive e modelos de exemplo prontos. Próximo passo: configurarSenhas().');
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

function bootstrap_(req, u) {
  const out = function (nome) { return lerAba_(nome).map(limpar_); };
  return {
    ok: true, usuario: u, admin: u === ADMIN,
    modelos: out('Modelos'), itens: out('ModeloItens'), fornecedores: out('Fornecedores'),
    apartamentos: out('Apartamentos'), fvs: out('FVS'), pendencias: out('Pendencias')
  };
}

function getFVS_(req) {
  const id = String(req.id || '');
  const f = lerAba_('FVS').filter(function (x) { return x.id === id; })[0];
  if (!f) throw new Error('FVS não encontrada.');
  const itens = lerAba_('FVS_Itens').filter(function (x) { return x.fvs_id === id; })
    .sort(function (a, b) { return Number(a.ordem) - Number(b.ordem); }).map(limpar_);
  const fotos = lerAba_('Fotos').filter(function (x) { return x.fvs_id === id; }).map(function (x) { const c = limpar_(x); delete c.drive_id; return c; });
  const pend = lerAba_('Pendencias').filter(function (x) { return x.fvs_id === id; }).map(limpar_);
  return { ok: true, fvs: limpar_(f), itens: itens, fotos: fotos, pendencias: pend };
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
  if (existe) atualizar_('Modelos', id, { nome: nome, descricao: texto_(m.descricao, 500), atualizado_em: agora });
  else inserir_('Modelos', { id: id, nome: nome, descricao: texto_(m.descricao, 500), ativo: 'sim', criado_em: agora, atualizado_em: agora });
  const outros = lerAba_('ModeloItens').filter(function (x) { return x.modelo_id !== id; }).map(limpar_);
  const novos = [];
  itens.forEach(function (it, i) {
    const d = texto_(it.descricao, 300).trim();
    if (!d) return;
    novos.push({ id: idValido_(it.id) ? it.id : novoId_(), modelo_id: id, ordem: String(novos.length + 1), descricao: d, criterio: texto_(it.criterio, 500).trim() });
  });
  if (!novos.length) throw new Error('O modelo precisa de ao menos um item com descrição.');
  reescrever_('ModeloItens', outros.concat(novos));
  registrarLog_(u, existe ? 'modelo_editado' : 'modelo_criado', id, nome);
  return { ok: true, id: id };
}

function alterarAtivo_(req, u) {
  const aba = String(req.aba || '');
  if (['Modelos', 'Fornecedores', 'Apartamentos'].indexOf(aba) < 0) throw new Error('Aba inválida.');
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

function proximoNumero_() {
  const p = props_();
  const n = Number(p.getProperty('SEQ_FVS') || 0) + 1;
  p.setProperty('SEQ_FVS', String(n));
  return 'FVS-' + ('0000' + n).slice(-4);
}

function recalcStatus_(fvsId) {
  const pend = lerAba_('Pendencias').filter(function (p) { return p.fvs_id === fvsId && p.status !== 'Cancelada'; });
  let st = 'Aprovada';
  if (pend.length) st = pend.some(function (p) { return p.status === 'Aberta'; }) ? 'Com pendência' : 'Reinspecionada';
  atualizar_('FVS', fvsId, { status: st, atualizado_em: agora_() });
  return st;
}

function salvarFVS_(req, u) {
  const f = req.fvs || {};
  const itens = req.itens || [];
  const pend = req.pendencias || {};
  if (!idValido_(f.id)) throw new Error('Identificador da FVS inválido.');
  if (!dataValida_(f.data)) throw new Error('Informe a data da verificação.');
  const apto = texto_(f.apartamento, 60).trim();
  if (!apto) throw new Error('Informe o apartamento.');
  if (!itens.length) throw new Error('A FVS não tem itens.');
  const nomeServico = texto_(f.modelo_nome, 120);
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
    assinatura_nome: texto_(f.assinatura_nome, 120), atualizado_em: agora
  };
  if (existente) {
    atualizar_('FVS', f.id, cab);
  } else {
    inserir_('FVS', Object.assign({ id: f.id, numero: proximoNumero_(), status: 'Aprovada', criado_por: u, criado_em: agora }, cab));
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

function reinspecionar_(req, u) {
  const id = String(req.id || '');
  const p = lerAba_('Pendencias').filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('Pendência não encontrada.');
  if (p.status !== 'Aberta') throw new Error('Esta pendência não está aberta.');
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

function uploadFoto_(req, u) {
  const id = req.id;
  if (!idValido_(id)) throw new Error('Identificador da foto inválido.');
  if (achar_('Fotos', id)) return { ok: true, id: id, repetida: true }; // reenvio seguro
  const tipos = ['item', 'assinatura', 'reinspecao'];
  if (tipos.indexOf(req.tipo) < 0) throw new Error('Tipo de foto inválido.');
  const fvsId = String(req.fvs_id || '');
  if (!achar_('FVS', fvsId)) throw new Error('FVS não encontrada para a foto.');
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+\/=]+)$/.exec(String(req.dataUrl || ''));
  if (!m) throw new Error('Imagem inválida.');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_FOTO_BYTES) throw new Error('Imagem muito grande.');
  const ext = m[1] === 'image/png' ? '.png' : '.jpg';
  const arquivo = pastaFotos_().createFile(Utilities.newBlob(bytes, m[1], 'fvs_' + id + ext));
  inserir_('Fotos', {
    id: id, fvs_id: fvsId, fvs_item_id: texto_(req.fvs_item_id, 64), pendencia_id: texto_(req.pendencia_id, 64),
    tipo: req.tipo, drive_id: arquivo.getId(), criado_em: agora_(), criado_por: u
  });
  return { ok: true, id: id };
}

function getFoto_(req) {
  const foto = lerAba_('Fotos').filter(function (x) { return x.id === String(req.id || ''); })[0];
  if (!foto) throw new Error('Foto não encontrada.');
  const blob = DriveApp.getFileById(foto.drive_id).getBlob();
  return { ok: true, id: foto.id, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
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

function getLog_(req, u) {
  exigirAdmin_(u);
  return { ok: true, log: lerAba_('Log').map(limpar_).reverse().slice(0, 500) };
}

function getExcluidos_(req, u) {
  exigirAdmin_(u);
  const lista = lerAba_('Auditoria_Excluidos').map(limpar_).reverse().slice(0, 300);
  return { ok: true, excluidos: lista };
}

const ACOES = {
  bootstrap: bootstrap_, getFVS: getFVS_, getFoto: getFoto_, getLog: getLog_, getExcluidos: getExcluidos_,
  salvarModelo: salvarModelo_, alterarAtivo: alterarAtivo_, salvarFornecedor: salvarFornecedor_,
  salvarApartamentos: salvarApartamentos_, salvarFVS: salvarFVS_, reinspecionar: reinspecionar_,
  uploadFoto: uploadFoto_, excluirFoto: excluirFoto_, excluirFVS: excluirFVS_
};
const ACOES_LEITURA = { bootstrap: 1, getFVS: 1, getFoto: 1, getLog: 1, getExcluidos: 1 };

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
    if (req.action === 'login') return json_(login_(req));
    const usuario = sessao_(req.token);
    if (!usuario) return json_({ ok: false, sessao: false, erro: 'Sessão expirada. Entre novamente.' });
    const acao = ACOES[req.action];
    if (!acao) return json_(erro_('Ação desconhecida.'));
    let lock = null;
    if (!ACOES_LEITURA[req.action]) { lock = LockService.getScriptLock(); lock.waitLock(30000); }
    try { return json_(acao(req, usuario)); }
    finally { if (lock) lock.releaseLock(); }
  } catch (err) {
    console.error(err);
    return json_(erro_(err && err.message ? err.message : String(err)));
  }
}
