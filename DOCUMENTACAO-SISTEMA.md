# Documentação Técnica — Sistema de FVS (Essence Residence)

> Documento de referência do sistema de Ficha de Verificação de Serviço. É atualizado a cada mudança relevante. Última atualização: **09/10/2026** (versão 1.0.0, primeira entrega).

## 1. O que é

Sistema **separado** do Dashboard Essence Residence (repositório `arqabsolutaa/revestimentos-dashboard`). Não compartilha planilha, Apps Script, senhas nem código com ele. Serve para registrar, em obra, a verificação de qualidade de cada serviço executado (por apartamento ou área comum), controlar as correções exigidas e emitir PDF.

- **Usuários**: Bárbara (administradora) e Gabriel.
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
4. Rodar `configurarSenhas()`: antes, digitar as senhas dentro de `SENHAS` no código; rodar; **apagar as senhas do código e salvar de novo**. Só o hash fica guardado (nas Propriedades do Script).
5. Rodar `criarGatilhoBackupDiario()`.
6. Implantar → Nova implantação → tipo **Aplicativo da Web** → Executar como **Eu** → Quem tem acesso **Qualquer pessoa** → copiar o endereço `.../exec`.
7. Colar esse endereço em `API_URL` no `index.html` (Claude faz isso e sobe).

## 4. Autenticação e permissões

- Login por usuário e senha **conferidos só no servidor** (hash SHA-256 com sal individual, nas Propriedades do Script).
- Após o login o servidor devolve um token de sessão (CacheService, 6 h, renovado a cada uso). Se o cache expirar, o sistema pede novo login (o que está aberto na tela é preservado).
- 5 senhas erradas seguidas bloqueiam o usuário por 10 minutos.
- **Só a Bárbara** vê: aba Histórico (log de ações e conteúdo excluído) e o botão de excluir FVS. O servidor também recusa essas ações para outros usuários.

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
| `Fotos` | Metadados das fotos (item, reinspeção, assinatura) e id do arquivo no Drive |
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

## 11. Limitações conhecidas (v1.0.0)

- **Salvar exige internet.** Rascunho de FVS sem fotos e sem assinatura fica guardado no aparelho se a tela for fechada, mas fotos e assinatura não são guardadas offline.
- Salvar FVS e cadastros mostra uma tela de progresso (não é otimista) porque envolve envio de fotos; só ativar/arquivar é otimista.
- Não há PDF de auditoria nem registro de valores antes/depois (existe só o log de ações e o conteúdo excluído).
- Sem logo da Absoluta nos PDFs (o repositório novo ainda não tem a imagem).
- Não foi testado ainda contra o Google real: o backend foi validado por simulação e o front por checagem de sintaxe. A primeira implantação serve de teste de ponta a ponta.

## 12. Histórico de mudanças

- **09/10/2026 — v1.0.0**: primeira entrega. Login, modelos editáveis (3 exemplos), cadastros, FVS com fotos e assinatura, pendências com reinspeção, PDFs, histórico, auditoria e backup.
