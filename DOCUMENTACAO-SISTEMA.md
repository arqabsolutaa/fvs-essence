# Documentação Técnica — Sistema de FVS (Essence Residence)

> Documento de referência do sistema de Ficha de Verificação de Serviço. É atualizado a cada mudança relevante. Última atualização: **09/10/2026** (versão 1.1.0: modo Registro de andamento).

## 1. O que é

Sistema **separado** do Dashboard Essence Residence (repositório `arqabsolutaa/revestimentos-dashboard`). Não compartilha planilha, Apps Script, senhas nem código com ele. Tem dois modos:

1. **FVS**: verificação de qualidade de cada serviço executado (por apartamento ou área comum), correções exigidas e PDF.
2. **Registro de andamento** (v1.1.0): os encarregados de cada disciplina (hidráulica, elétrica…) fotografam o avanço da obra em pontos predefinidos e editáveis. Serve para acompanhar a obra, fornecer material ao manual do proprietário (sequência de tubulação, por exemplo) e organizar as revisões.

- **Usuários**: Bárbara (administradora), Gabriel e os encarregados (cada um com login próprio, cadastrados pela Bárbara).
- **Empresa/obra**: Absoluta Construtora e Incorporadora · Essence Residence · São Bernardo do Campo/SP.

## 2. Arquitetura

| Camada | Tecnologia |
|---|---|
| Front-end | `index.html` único (HTML + CSS + JS puro), hospedado no GitHub Pages |
| Back-end | `Code.gs` (Google Apps Script publicado como Web App) |
| Banco de dados | Google Sheets (planilha própria deste sistema) |
| Fotos e assinaturas | Google Drive, pasta `FVS_Essence_Fotos` |
| PDFs | jsPDF, gerados no navegador |

- **Repositório**: `arqabsolutaa/fvs-essence` · site: `https://arqabsolutaa.github.io/fvs-essence/`
- **Sem espelho `data.json`**: o front lê direto do Apps Script. Isso evita o problema de cache e de token vencido que o espelho causou no Essence.
- **Comunicação**: toda chamada é `POST` com corpo JSON em texto simples (`fetch`), para o endereço do Web App. A constante `API_URL`, no início do script do `index.html`, guarda esse endereço.
- O repositório é público (exigência do GitHub Pages gratuito). **Nenhuma senha, token ou dado de obra fica no repositório.**

## 3. Fluxo de deploy

1. **Front-end (`index.html`)**: Claude sobe direto no GitHub; o Pages atualiza em cerca de 1 minuto.
2. **Back-end (`Code.gs`)**: Claude entrega o arquivo completo (sempre cumulativo, nunca parcial). **A Bárbara cola no editor do Apps Script e reimplanta**: Implantar → Gerenciar implantações → Editar → Nova versão → Implantar. Sempre que uma mudança mexer no `Code.gs`, Claude avisa.

### Primeira implantação (passo a passo)

1. Criar uma planilha Google nova (em branco) e abrir Extensões → Apps Script.
2. Colar todo o `Code.gs` e salvar.
3. Rodar `setup()` (autorizar os acessos pedidos). Cria as abas, as pastas do Drive e 3 modelos de exemplo.
4. Definir as senhas: recarregar a planilha e usar o menu **FVS → Definir senhas** (janelas de pergunta, sem editar o código). Só o hash fica guardado (nas Propriedades do Script). A função `configurarSenhas()` do editor continua existindo como alternativa.
5. Menu **FVS → Ativar backup diário** (ou rodar `criarGatilhoBackupDiario()`).
6. Implantar → Nova implantação → tipo **Aplicativo da Web** → Executar como **Eu** → Quem tem acesso **Qualquer pessoa** → copiar o endereço `.../exec`.
7. Colar esse endereço em `API_URL` no `index.html` (Claude faz isso e sobe).

## 4. Autenticação e permissões

- Login por usuário e senha **conferidos só no servidor** (hash SHA-256 com sal individual, nas Propriedades do Script).
- Após o login o servidor devolve um token de sessão (CacheService, 6 h, renovado a cada uso). Se o cache expirar, o sistema pede novo login (o que está aberto na tela é preservado).
- 5 senhas erradas seguidas bloqueiam o usuário por 10 minutos.
- **Só a Bárbara** vê: aba Histórico (log de ações e conteúdo excluído) e o botão de excluir FVS. O servidor também recusa essas ações para outros usuários.


## 4A. Perfis de acesso (v1.1.0)

| Perfil | Pode |
|---|---|
| `admin` (Bárbara) | Tudo: FVS, andamento, cadastros, usuários, histórico, exclusões |
| `consulta` (Gabriel, Jailton) | **Somente leitura**: vê checklists, pendências, fotos e observações de todas as disciplinas e gera PDFs. Não cria, edita, apaga nem reinspeciona nada (bloqueado no servidor). Não vê histórico nem usuários. Gabriel é fixo no código; os demais são criados em Cadastros → Usuários com perfil "Consulta" (linhas antigas com perfil `completo` valem como `consulta`) |
| `encarregado` | Na(s) disciplina(s) dele, e só nelas: preencher e salvar **checklists** (e reinspecionar as pendências deles), registrar **fotos** de andamento e escrever **observações gerais**. Vê também o que os colegas da mesma disciplina registraram. Nunca vê outra disciplina, nem cadastros, histórico ou exclusões |

- A Bárbara tem controle total: bloqueia logins (Arquivar), edita ou apaga qualquer checklist, foto, registro ou observação, e adiciona fotos a qualquer registro.
- A Bárbara cria e arquiva usuários em Cadastros → Usuários (nome, perfil, disciplinas liberadas, senha). Usuário arquivado perde o acesso na hora (o servidor confere a cada chamada).
- As restrições são aplicadas no **servidor** (tabela de permissões por ação), não só na tela.

## 4B. Registro de andamento

- **Fluxo**: escolher apartamento → disciplina → ponto da lista (editável) → ambiente (opcional) → fotos + legenda → salvar.
- **Disciplinas e pontos** são cadastros editáveis (Cadastros → Disciplinas), com ordem. Exemplos de partida criados pelo `setup()`.
- **Revisões**: cada novo registro do mesmo apartamento + ponto + ambiente é a próxima revisão (REV 1, 2, 3…), pela ordem da data de captura. Número calculado na tela, nunca gravado: excluir um registro renumera.
- **Sem sinal**: o registro (com fotos já reduzidas) fica numa fila no aparelho (IndexedDB) e sobe sozinho ao abrir o sistema, quando a internet volta e a cada 30 s. Envio idempotente (UUID gerado no aparelho): reenviar não duplica. A data/hora registrada é a da captura, não a do envio.
- **Telas**: Registrar · Registros (por apartamento, agrupado por disciplina/ponto, com histórico de revisões) · Cobertura (matriz apartamento × pontos feitos).
- **Dossiê em PDF**: por apartamento (e disciplina, se filtrada): pontos em ordem, cada revisão com data, autor, legenda e fotos.
- Excluir registro: só a Bárbara; conteúdo vai para `Auditoria_Excluidos`.

## 5. Modelo de dados (abas da planilha)

Todas as células são texto puro (a planilha não converte datas nem números). Colunas novas só podem ser **acrescentadas ao final**; o `setup()` repara o cabeçalho.

| Aba | Conteúdo |
|---|---|
| `Modelos` | Serviços verificáveis (nome, descrição, ativo, `disciplina_id`: quem usa o checklist) |
| `ModeloItens` | Itens e critérios de cada modelo, em ordem |
| `Fornecedores` | Nome, serviços, contato, ativo |
| `Apartamentos` | Código, tipo (Apartamento / Área comum), ativo |
| `FVS` | (inclui `disciplina_id`, herdada do modelo) Cabeçalho da ficha: número `FVS-0001`, data, apto, serviço, fornecedor, responsável, situação, assinatura (nome) |
| `FVS_Itens` | Cópia dos itens no momento da FVS (descrição, critério, resultado C/NC/NA, observação) |
| `Pendencias` | Uma por item não conforme: responsável, prazo, status, reinspeções |
| `Fotos` | Metadados das fotos (item, reinspeção, assinatura, registro de andamento) e id do arquivo no Drive |
| `Disciplinas` | Disciplinas do andamento (nome, ativo) |
| `PontosAndamento` | Pontos fotografáveis de cada disciplina, com ordem |
| `ObservacoesGerais` | Avisos/reclamações por disciplina: local, relacionada a, texto, status (Aberta/Resolvida), autor. Fotos ligadas por `Fotos.observacao_id` |
| `Registros` | Um registro de andamento: apto, disciplina, ponto, ambiente, legenda, data de captura, autor |
| `Usuarios` | Perfil e disciplinas liberadas de cada usuário (a senha fica só como hash nas Propriedades do Script) |
| `Log` | Quem fez o quê e quando |
| `Auditoria_Excluidos` | Conteúdo completo de tudo que foi excluído. Só cresce |

**FVS guarda cópia dos itens**: editar ou arquivar um modelo nunca altera FVS já registradas.

## 6. Regras de negócio

- **Resultado por item**: Conforme (`C`), Não conforme (`NC`) ou N.A. (`NA`). Todos os itens precisam ser avaliados para salvar.
- **Item não conforme** exige responsável pela correção e prazo (sugestão: nome do fornecedor e hoje + 7 dias) e gera uma **pendência** automaticamente.
- **Situação da FVS** (calculada pelo servidor):
  - `Aprovada`: sem pendências.
  - `Com pendência`: existe pendência aberta.
  - `Reinspecionada`: todas as pendências foram resolvidas em reinspeção.
- **Reinspeção**: resultado "Corrigido e aprovado" fecha a pendência; "Ainda não conforme" mantém aberta, soma uma reinspeção e permite novo prazo. Aceita fotos e observação.
- Se uma FVS é editada e o item deixa de ser NC, a pendência aberta vira `Cancelada`.
- **Assinatura**: nome + assinatura desenhada na tela, obrigatórios para salvar. Entra no PDF.
- **Vínculo**: apartamento (ou área comum) + serviço + fornecedor (opcional). O serviço não pode ser trocado ao editar uma FVS existente.
- **Prazo vencido**: pendência aberta com prazo anterior a hoje aparece em vermelho.

## 7. Fotos

- O navegador reduz cada foto (lado maior 1280 px, JPEG) antes de enviar.
- O Apps Script grava no Drive e a planilha guarda só o id. As fotos **não** ficam públicas: o front as busca pelo servidor (ação `getFoto`, exige login).
- Envio é idempotente (reenviar a mesma foto não duplica).
- Foto excluída sai da aba `Fotos`, o conteúdo vai para `Auditoria_Excluidos` e **o arquivo permanece no Drive**.

## 8. PDFs

Gerados no navegador com jsPDF, no estilo Essence (marrom `#43331e`, dourado `#8c8467`, oliva; nunca azul). Nome do arquivo passa por `nomeArquivoLimpo()`.

- **PDF da FVS**: dados, itens com resultado, pendências, observações, assinatura e registro fotográfico.
- **PDF de pendências**: respeita os filtros da tela (situação, apartamento, fornecedor).

## 9. Backup e auditoria (só a Bárbara sabe e vê)

- Antes de qualquer exclusão o servidor copia a planilha para a pasta `Backup_FVS_Essence` (no máximo 1 cópia a cada 10 minutos).
- `backupDiario()` roda todo dia (~2h) via gatilho; cópias com mais de 30 dias vão para a lixeira.

## 10. Convenções (herdadas do Essence)

- Modais fecham **só pelo botão X**, nunca clicando fora.
- Marca Essence nunca usa azul.
- Telas pensadas para tablet e celular (botões grandes); sem detecção por largura de janela.
- Texto de rodapé dos PDFs: "Absoluta Construtora e Incorporadora · Essence Residence · São Bernardo do Campo/SP".
- Sempre que `Code.gs` mudar, entregar o arquivo completo e avisar que é preciso reimplantar.
- Esta documentação é atualizada a cada mudança.

## 11. Limitações conhecidas (v1.1.0)

- **FVS exige internet para salvar.** (O registro de andamento funciona offline, com fila.) Rascunho de FVS sem fotos e sem assinatura fica guardado no aparelho se a tela for fechada, mas fotos e assinatura não são guardadas offline.
- Salvar FVS e cadastros mostra uma tela de progresso (não é otimista) porque envolve envio de fotos; só ativar/arquivar é otimista.
- Não há PDF de auditoria nem registro de valores antes/depois (existe só o log de ações e o conteúdo excluído).
- Fila offline vive no navegador do aparelho: limpar dados do site apaga o que ainda não subiu. Registros pendentes aparecem com contador no topo.
- Não há vínculo entre uma FVS e os registros de andamento do mesmo local.
- Não foi testado ainda contra o Google real: o backend foi validado por simulação (incluindo perfis, fila, idempotência) e o front por checagem de sintaxe. A primeira implantação serve de teste de ponta a ponta.

## 12. Histórico de mudanças

- **09/10/2026 — v1.0.0**: primeira entrega. Login, modelos editáveis (3 exemplos), cadastros, FVS com fotos e assinatura, pendências com reinspeção, PDFs, histórico, auditoria e backup.
- **09/10/2026 — v1.1.0**: modo Registro de andamento (disciplinas, pontos, registros com fotos e legenda, revisões, cobertura, dossiê PDF), perfis (admin/completo/encarregado) com login próprio, cadastro de usuários, fila offline. **Mudou o `Code.gs`**: colar o arquivo completo, rodar `setup()` de novo (cria as abas novas e repara cabeçalhos) e reimplantar com "Nova versão".
- **10/10/2026**: endereço do Apps Script (`/exec`) configurado em `API_URL`. Primeira implantação feita pela Bárbara.
- **10/10/2026 — v1.1.1**: menu "FVS" na planilha para definir senhas e ativar o backup, sem editar código. Mudou o `Code.gs` (colar de novo; reimplantar não é necessário para o menu).
- **10/10/2026 — v1.1.2**: modo sem senha (`PERMITIR_SEM_SENHA = true` no `Code.gs`). Usuário que ainda não tem senha definida entra só escolhendo o nome (o campo de senha some na tela de login). Assim que uma senha é definida (menu FVS → Definir senhas), ela passa a ser exigida para aquele usuário. Para desligar o modo, mudar a constante para `false`. **Atenção**: o repositório é público e contém o endereço do Apps Script; sem senha, quem tiver esse endereço consegue chamar a API. Definir senhas antes de entrar dados reais.
- **10/10/2026 — v1.1.3**: identidade visual alinhada ao Essence: tela de entrada com a foto do prédio (`assets/capa_entrada_essence.jpg`) e logo da Absoluta (`assets/logo-absoluta.png`, copiados do repositório do dashboard); logo da Absoluta no cabeçalho de todos os PDFs. Só mudou o `index.html` e `assets/` (não precisa reimplantar o Apps Script).
- **10/10/2026 — v1.2.0**: login por competência e senha numérica. Tela de entrada com a foto do prédio (`assets/capa-fundo.jpg`); o usuário escolhe **Competência** (Administração, Hidráulica, Elétrica, Civil, Estrutura…) → **Nome** (só quem pertence àquela competência) → **Senha** digitada num teclado numérico na tela (4 a 8 números; o teclado fecha pelo X). Encarregado vê e registra **só nas competências dele**, incluindo o que os colegas da mesma competência registraram (antes via só os próprios). Encarregado sem competência marcada não vê nada. Bárbara (e Gabriel) entram por "Administração" e veem tudo. "Competência" = a aba Disciplinas (renomeada na tela); `setup()` cria Civil e Estrutura se faltarem. Paleta trocada para cinza médio, cinza claro e off-white (tela e PDFs). Senhas numéricas 4–8 dígitos validadas no servidor (menu FVS → Definir senhas, Cadastros → Usuários). **Mudou o `Code.gs`**: colar, rodar `setup()` e reimplantar com Nova versão.
- **10/10/2026 — v1.2.1**: capa mostra o prédio inteiro (imagem inteira com bordas suavizadas sobre fundo desfocado). Em tablet/computador o prédio fica à esquerda e o login à direita; no celular o prédio fica em cima e o login embaixo. Só `index.html` (sem mexer no Apps Script).
- **10/10/2026 — v1.2.2**: capa minimalista, sem sombras nem desfoque: foto do prédio num painel à esquerda (em cima no celular) e o login direto sobre o off-white, sem cartão. Botões ficam em cinza escuro ao passar o mouse/clicar (antes ficavam marrons). Só `index.html`.
- **10/10/2026 — v1.2.3**: capa com o degradê de volta, agora da foto do prédio (inteiro) para o off-white, sem o fundo preto; login direto sobre o off-white. Só `index.html`.
- **10/10/2026 — v1.2.4**: tela de entrada redesenhada: tela dividida, foto do prédio à esquerda e, à direita, a mesma foto desfocada em cinza escuro com o formulário em branco (campos só com linha embaixo, botão cinza escuro, logo em branco). No celular a foto fica em cima. Só `index.html`.
- **10/10/2026 — v1.2.5**: tela de entrada com a foto da fachada (`assets/capa-fundo.jpg`, escurecida) em tela cheia e o formulário num cartão de vidro (fundo desfocado, borda fina) no centro. No computador os campos têm só a linha embaixo; no celular, campos e botão em formato de pílula. Teclado numérico também em cinza escuro. O modo de login não mudou. Só `index.html` e a imagem.
- **10/10/2026 — v1.2.6**: a capa mostra só "Essence Residence" (sem "FVS" nem subtítulo; o título da aba do navegador também). "Competência" passou a se chamar **Disciplina** em toda a tela (login, Cadastros, Usuários). Teclado numérico menor (mantém o X). Mudança de texto só em comentários do `Code.gs`: não exige reimplantar.
- **10/10/2026 — v1.3.0**: perfil "Coordenação" (vê todas as disciplinas, como o Gabriel) pode ser criado em Cadastros → Usuários, que passou a se chamar "Novo usuário" com campo Perfil. Usuários da obra criados por um arquivo de apoio `Acessos.gs` (fora do repositório, com os nomes da equipe): Luciano (Elétrica), Francisco (Hidráulica), Jordeano (Estrutura e Civil), José (Civil), Jailton (Coordenação). Entram sem senha até as senhas serem definidas. **Mudou o `Code.gs`**: colar, adicionar o arquivo `Acessos.gs` no editor, rodar `importarAcessos()` e reimplantar com Nova versão.
- **10/10/2026 — v1.3.1**: senhas numéricas da equipe definidas (gravadas só como hash, via `importarAcessos()` no arquivo de entrega, que não vai ao GitHub). `PERMITIR_SEM_SENHA` passou para `false`: usuário sem senha definida não entra mais (senha passa a ser obrigatória ao criar usuário). Mudou o `Code.gs`: colar o arquivo completo, rodar `setup()` e `importarAcessos()` e reimplantar com Nova versão.
- **10/10/2026 — v1.3.2**: menus suspensos do login (Disciplina e Nome) próprios: lista arredondada em cinza, letras brancas, item selecionado em cinza escuro (o menu nativo do navegador não aceita estilo). Só `index.html`.
- **10/10/2026 — v1.4.0**: (1) o cabeçalho mostra a disciplina do usuário (Hidráulica, Elétrica…; "Administração" para Bárbara, Gabriel e Jailton). (2) Abas: **Checklists** (antes FVS), Pendências, **Fotos** (antes Andamento), **Observações gerais** (nova); a Bárbara ainda tem Modelos, **Biblioteca**, Cadastros e Histórico. (3) Encarregado preenche checklists das disciplinas dele: `Modelos` e `FVS` ganharam `disciplina_id`, e o servidor filtra por disciplina (checklists, pendências, reinspeção, fotos). (4) **Observações gerais**: texto + local + "relacionada a" + até 12 fotos; vão direto para a administração, que marca como resolvida ou exclui. (5) Gabriel e Jailton viram **somente leitura** (perfil `consulta`), reforçado no servidor; só a Bárbara escreve/apaga/bloqueia. (6) **Biblioteca de serviços**: 65 serviços (436 itens) em 10 áreas, dentro do `index.html` (constante `LIB`); a Bárbara marca os serviços, escolhe a disciplina e eles viram checklists e pontos de foto dela (ação `adicionarServicos`, sem duplicar por nome). Os critérios usam "conforme projeto/norma" em vez de números e precisam de revisão da engenharia. **Mudou o `Code.gs`**: colar o arquivo completo, rodar `setup()` (cria a aba `ObservacoesGerais` e as colunas novas) e reimplantar com Nova versão.
- **10/10/2026 — v1.5.0**: **funcionamento offline**. (1) O app abre sem internet (`sw.js`, service worker que guarda a página, imagens e o jsPDF; a página é sempre atualizada quando há internet). (2) A sessão continua aberta no aparelho (já era assim) e os dados (modelos, apartamentos, checklists, pendências) ficam em cache. (3) **Fila de envio geral** (IndexedDB): checklists novos (com fotos e assinatura), reinspeções, observações gerais, fotos adicionais e registros de andamento são guardados no aparelho e sobem sozinhos, na ordem, quando a internet volta (a cada 30 s, ao reconectar e ao voltar para o app). Itens pendentes aparecem em "Aguardando envio" e no contador "↑ N na fila" (toque para ver, tentar de novo ou descartar). Cada envio é seguro para repetir (o servidor reconhece o mesmo id). (4) O app pede ao navegador para não apagar os dados guardados. **Limites**: abrir ou editar um checklist já enviado, ver fotos de outros registros e todas as telas de administração (Modelos, Biblioteca, Cadastros, exclusões) precisam de internet; se a sessão expirar (6 h sem uso no servidor) é preciso entrar de novo com internet, e a fila espera. Só `index.html` e `sw.js` (não precisa mexer no Apps Script).
- **10/10/2026 — v1.6.0**: **biblioteca refeita**: 122 serviços em 17 áreas (Estrutura, Alvenaria e vedação, Argamassa e contrapiso, Hidráulica, Elétrica, Impermeabilização, Revestimentos, **Marmoraria** (no lugar de Marcenaria), Esquadrias, Serralheria, Gesso e forros, Pintura, Fachada, Cobertura e telhado, Ar-condicionado e ventilação, Áreas comuns e externas, Limpeza e entrega) e 754 itens **curtos**, sem critério longo (o campo "Como conferir" continua existindo, opcional). Novo campo **foto obrigatória** por item (`ModeloItens.exige_foto`): o checklist só salva se o item tiver foto (exceto N.A.). A biblioteca marca com foto obrigatória os itens de serviço que depois ficam escondidos. Inclui o serviço "Prumadas já fechadas (conferência)" para shafts que já foram fechados (as-built, teste de pressão, ponto de visita, umidade nos andares). O encarregado ainda é quem preenche: a foto obrigatória e a conferência por amostragem da Bárbara/Jailton reduzem o risco de preenchimento sem execução. **Mudou o `Code.gs`** (coluna nova): colar o arquivo completo, rodar `setup()` e reimplantar com Nova versão. A biblioteca nova só aparece no site depois de atualizar a página.
- **10/10/2026 — v1.7.0**: **Torre x Unidades** e **checklist por encarregado**. (1) Cada checklist (`Modelos.escopo`) vale para *Unidades*, *Torre* (áreas comuns: térreo, ático, barrilete, muros…) ou os dois; ao escolher o local no checklist, só aparecem os modelos que servem para ele. "Torre" = local cadastrado com tipo "Área comum" em Cadastros → Apartamentos e locais (há o botão "Preencher com locais da Torre"). Checklists e Pendências ganharam o filtro **Onde** (Torre / Unidades). (2) Na Biblioteca e em Modelos dá para atribuir o checklist a um **encarregado específico** (`Modelos.encarregado`): dois encarregados da mesma disciplina (Civil: Jordeano e José) passam a ver só os checklists que a Bárbara atribuiu a cada um; sem escolha, vale para todos da disciplina. A mesma lista de serviços pode ser adicionada para Torre e para Unidades (são checklists separados). O servidor confere a atribuição ao salvar. (3) Jordeano passou a ser só **Civil** (antes Estrutura e Civil). `importarAcessos()` agora também **atualiza** usuários que já existem (disciplinas, perfil, reativa), então rodar de novo corrige e cria quem faltar (ex.: José). **Mudou o `Code.gs`**: colar o arquivo completo, rodar `setup()` e `importarAcessos()` e reimplantar com Nova versão.
- **10/10/2026 — v1.7.1**: Cadastros → Apartamentos e locais → "+ Adicionar" ganhou o botão "Preencher unidades (11 a 162)" (andares 1 a 16, finais 1 e 2). Só `index.html`.
- **10/10/2026 — v1.7.2**: textos explicativos removidos das telas (Observações, Biblioteca, Modelos, Fotos, Usuários, fila etc.) para deixar a interface mais limpa. Só `index.html`.
- **10/10/2026 — v1.8.0**: (1) **Nome do PDF** no padrão `FVS - HID - 0001 - 10-10-26.pdf` (sigla da disciplina, número e data). (2) **Numeração por disciplina**: HID, ELE, CIV, REV, MAR, EST, PER (Personalize), ARC; cada sigla tem contador próprio (`FVS-HID-0001`). Checklists sem disciplina seguem `FVS-0001`. (3) **Consulta com disciplinas**: o perfil Consulta pode ter disciplinas marcadas; vê tudo, mas grava só nelas (o Jailton: Administração em leitura + Revestimentos com escrita). Gabriel segue só leitura. (4) Novas disciplinas **Marmoraria** e **Personalize** (controle da Bárbara). (5) **Item só desta unidade** no checklist (ex.: base de alvenaria da banheira do cliente), sem alterar o modelo. (6) Biblioteca: nova área **Personalização** (banheira do cliente, monocomando 4 vias, revestimento escolhido pelo cliente com nome/caixas/lote, vedações e ajustes) — 126 serviços, 774 itens. **Code.gs mudou** (colar inteiro, rodar `setup()` e `importarAcessos()`, nova versão da implantação).
- **10/10/2026 — v1.8.1**: ícone do app (monograma CE verde sobre cinza claro) para "Adicionar à tela inicial": `manifest.webmanifest`, `assets/icon-192/512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (180) e favicon; nome do atalho "Essence". Só site (não muda o Code.gs). Para ver o ícone novo, remover o atalho antigo e criar de novo.
- **10/10/2026 — v1.9.0**: (1) **Módulos**: cada checklist (`Modelos.modulo`, texto livre) pode ficar num módulo dentro da disciplina (ex.: José → Unidades, Térreo, Fachada). Campo "Módulo" na Biblioteca (ao adicionar serviços) e no editor de modelo; a lista de serviço ao criar checklist mostra "Módulo · Serviço"; o mesmo serviço pode existir em módulos diferentes. (2) **Biblioteca ampliada** para 160 serviços e 957 itens: Revestimentos (de 8 para 24: recebimento do material, base, piso por ambiente, parede por ambiente, rejunte, soleiras, rodapés, fachada, limpeza), Marmoraria (de 6 para 13), Personalização (de 4 para 10: banheira, monocomando, revestimento do cliente, ar-condicionado, pontos extras, paredes, gesso, pintura, box), Fachada (cor e amostra), e "das unidades" (contrapiso, gesso, vedações). **Code.gs mudou** (nova coluna `modulo` em Modelos; colar inteiro, rodar `setup()`, nova versão da implantação).
- **10/10/2026 — v1.10.0**: **aba Painel** (Bárbara e Gabriel; primeira aba ao entrar). Calculada no próprio app a partir dos dados já carregados (sem mudança no Code.gs): filtros por disciplina, encarregado e módulo; indicadores (% de checklists feitos, feitos/previstos, serviços sem nenhum checklist, pendências abertas e vencidas); barras por disciplina e por encarregado; checklists por semana (8 semanas); cobertura das fotos de andamento por disciplina; lista "O que ainda falta" por serviço com os apartamentos que faltam; pendências vencidas. Regra: serviço de Unidade espera um checklist por unidade cadastrada; serviço da Torre espera ao menos um. Botão **PDF da reunião**: por encarregado, os serviços em aberto com os apartamentos que faltam, mais as pendências vencidas (`Reuniao de acompanhamento - dd-mm-aaaa.pdf`).
- **10/10/2026 — v1.11.0**: **a Bárbara gerencia tudo de todas as disciplinas**. (1) Cada checklist feito (aba Checklists) ganhou os botões **Editar**, **Arquivar** e **Excluir** direto no cartão (só administradora); o botão **Arquivados (N)** no topo mostra os arquivados, onde dá para **Reativar** ou excluir. Arquivar tira o checklist (e as pendências dele) das listas, das contagens e do Painel, sem apagar nada; a coluna nova `ativo` na aba FVS controla isso. (2) Aba Modelos: botão **Excluir** (além de Editar, Duplicar e Arquivar); o servidor recusa excluir um modelo que já tem checklist feito e orienta arquivar (`excluirModelo`). **Code.gs mudou** (colar inteiro, rodar `setup()`, nova versão da implantação).
