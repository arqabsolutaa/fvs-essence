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
| `completo` (Gabriel) | FVS, andamento, cadastros. Não vê histórico nem exclui |
| `encarregado` | **Só** registrar andamento e ver os próprios registros, apenas nas disciplinas liberadas para ele |

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
| `Modelos` | Serviços verificáveis (nome, descrição, ativo) |
| `ModeloItens` | Itens e critérios de cada modelo, em ordem |
| `Fornecedores` | Nome, serviços, contato, ativo |
| `Apartamentos` | Código, tipo (Apartamento / Área comum), ativo |
| `FVS` | Cabeçalho da ficha: número `FVS-0001`, data, apto, serviço, fornecedor, responsável, situação, assinatura (nome) |
| `FVS_Itens` | Cópia dos itens no momento da FVS (descrição, critério, resultado C/NC/NA, observação) |
| `Pendencias` | Uma por item não conforme: responsável, prazo, status, reinspeções |
| `Fotos` | Metadados das fotos (item, reinspeção, assinatura, registro de andamento) e id do arquivo no Drive |
| `Disciplinas` | Disciplinas do andamento (nome, ativo) |
| `PontosAndamento` | Pontos fotografáveis de cada disciplina, com ordem |
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
