# Feature Specification: Phase 03 — Upload e Processamento de Vídeos

**Feature Branch**: `feature/phase-03-video-upload`

**Created**: 2026-06-27

**Status**: Implemented

**Input**: User description: "use como base o docs/MBA em Engenharia de Software com IA _ Desafios Técnicos - Continuando o StreamTube com IA — Fase 03 Upload e Processamento de Vídeos - MBA IA.pdf"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Iniciar upload de vídeo (Priority: P1)

Um criador de conteúdo autenticado envia um arquivo de vídeo de até 10 GB para a plataforma. Ao iniciar o processo, o sistema pré-registra o vídeo como rascunho e fornece ao cliente as informações necessárias para enviar o arquivo diretamente ao armazenamento, sem passar o conteúdo binário pela API. O vídeo fica visível para o dono antes mesmo do processamento terminar.

**Why this priority**: Sem upload não há vídeos; é o ponto de entrada de toda a feature. O pré-cadastro imediato como rascunho garante rastreabilidade desde o início do envio.

**Independent Test**: Pode ser testado enviando uma requisição de início de upload autenticada e verificando que (a) o registro do vídeo é criado com status `draft` e (b) as credenciais de envio direto ao storage são retornadas — sem precisar do worker ou do streaming.

**Acceptance Scenarios**:

1. **Given** um usuário autenticado com canal ativo, **When** ele solicita o início de um upload fornecendo título e tamanho do arquivo, **Then** o sistema retorna um identificador único do vídeo, o status inicial `draft`, e as informações necessárias para o cliente enviar o arquivo diretamente ao armazenamento de objetos.
2. **Given** um arquivo de 10 GB sendo enviado diretamente ao storage, **When** o envio ocorre em paralelo, **Then** a API permanece responsiva e não apresenta timeout para outras requisições durante o processo.
3. **Given** um usuário não autenticado, **When** ele tenta iniciar um upload, **Then** o sistema retorna erro de autorização sem criar nenhum registro.
4. **Given** um usuário autenticado sem canal, **When** ele tenta iniciar um upload, **Then** o sistema retorna erro indicando que um canal é necessário.

---

### User Story 2 — Processamento automático após upload (Priority: P2)

Após enviar o arquivo ao storage, o cliente notifica a API que o envio foi concluído. A partir daí, o sistema processa o vídeo automaticamente em segundo plano: extrai duração e metadados técnicos, gera uma thumbnail a partir de um frame representativo, e atualiza o status do vídeo para refletir cada etapa (processando → pronto ou erro). O criador não precisa realizar nenhuma outra ação além de confirmar o upload.

**Why this priority**: O processamento automático é o que transforma o arquivo bruto em um vídeo utilizável na plataforma. Sem isso, o upload sozinho não entrega valor ao usuário final.

**Independent Test**: Pode ser testado publicando uma mensagem na fila de processamento manualmente e verificando que o worker consome a mensagem, extrai metadados, gera thumbnail, armazena os resultados no storage e atualiza o registro do vídeo com status `ready`.

**Acceptance Scenarios**:

1. **Given** um vídeo com status `draft` cujo arquivo foi enviado diretamente ao storage pelo cliente, **When** o cliente notifica a API que o upload foi concluído (via chamada dedicada), **Then** o status do vídeo muda para `processing` e uma tarefa de processamento é enfileirada.
2. **Given** uma tarefa de processamento na fila, **When** o worker a consome, **Then** ele extrai duração e metadados técnicos do arquivo, gera uma thumbnail e armazena ambos no object storage.
3. **Given** o processamento concluído com sucesso, **When** o worker termina, **Then** o status do vídeo muda para `ready`, a chave da thumbnail é persistida e a duração extraída é salva no registro.
4. **Given** uma falha durante o processamento (arquivo corrompido, timeout), **When** o worker encontra o erro, **Then** ele retenta até 3 vezes com intervalo fixo; se todas as tentativas falharem, o status do vídeo muda para `error` com a causa da última falha registrada, sem deixar o vídeo preso em `processing`.

---

### User Story 3 — Reprodução via streaming (Priority: P3)

Um usuário (autenticado ou anônimo) assiste a um vídeo sem precisar aguardar o download completo. O sistema suporta requisições parciais de conteúdo, permitindo que o player salte para qualquer ponto do vídeo e que o streaming comece imediatamente.

**Why this priority**: Streaming é o modo padrão de consumo de vídeo na web; sem ele a experiência de reprodução é inutilizável para arquivos grandes.

**Independent Test**: Pode ser testado solicitando o streaming de um vídeo com status `ready` especificando um intervalo de bytes e verificando que apenas o trecho solicitado é retornado, permitindo que a reprodução comece antes do arquivo completo ser recebido.

**Acceptance Scenarios**:

1. **Given** qualquer usuário (autenticado ou anônimo) e um vídeo com status `ready`, **When** ele consulta os detalhes do vídeo pelo identificador único, **Then** o sistema retorna título, status, URL da thumbnail, duração e demais metadados disponíveis.
2. **Given** qualquer usuário e um vídeo com status diferente de `ready` (ex.: `processing`), **When** ele consulta os detalhes, **Then** o sistema retorna os dados disponíveis com o status atual — o cliente pode usar essa chamada para acompanhar o progresso do processamento.
3. **Given** um vídeo com status `ready`, **When** um cliente solicita streaming especificando um intervalo de bytes do conteúdo, **Then** o sistema retorna apenas o trecho solicitado com os metadados de intervalo necessários para que o player continue a reprodução a partir de qualquer ponto.
4. **Given** um vídeo com status `ready`, **When** um cliente solicita streaming sem especificar intervalo, **Then** o sistema entrega o arquivo completo.
5. **Given** um vídeo com status diferente de `ready`, **When** qualquer cliente solicita streaming, **Then** o sistema retorna erro indicando que o vídeo não está disponível.
6. **Given** um cliente solicita um intervalo de bytes que está além do tamanho do arquivo, **When** a requisição de streaming é processada, **Then** o sistema retorna erro indicando que o intervalo solicitado não é satisfazível.

---

### User Story 4 — Download do vídeo (Priority: P4)

Um usuário **autenticado** pode baixar o arquivo de vídeo completo. O sistema fornece o arquivo ou um mecanismo para obtê-lo de forma direta, sem exigir que o conteúdo passe pela API. O mecanismo de entrega é um proxy através da API (não um redirect para URL pré-assinada), preservando as credenciais de acesso ao storage no lado do servidor.

**Why this priority**: Download é uma funcionalidade complementar ao streaming, importante para uso offline, mas não bloqueia a entrega de valor principal.

**Independent Test**: Pode ser testado requisitando o download de um vídeo com status `ready` com um token de autenticação válido e verificando que o arquivo completo é retornado com cabeçalho `Content-Disposition: attachment`.

**Acceptance Scenarios**:

1. **Given** um usuário autenticado e um vídeo com status `ready`, **When** o usuário solicita o download, **Then** o sistema entrega o arquivo completo diretamente com cabeçalho `Content-Disposition: attachment` — o conteúdo binário é servido como proxy pela API, sem expor as credenciais ou URLs internas do storage ao cliente.
2. **Given** um usuário não autenticado e um vídeo com status `ready`, **When** o usuário tenta fazer o download, **Then** o sistema retorna erro de autorização sem entregar o arquivo.
3. **Given** um usuário autenticado e um vídeo com status diferente de `ready`, **When** o usuário solicita o download, **Then** o sistema retorna erro indicando que o vídeo não está disponível para download.

---

### User Story 5 — URL única por vídeo (Priority: P2)

Cada vídeo recebe um identificador único na URL que não conflita com outros vídeos, mesmo que tenham títulos idênticos. Esse identificador é atribuído no momento do pré-cadastro e nunca muda. *(Requisito formalizado em FR-003; implementado como parte de US1 — o UUID v4 como chave primária garante unicidade sem campo slug separado.)*

**Why this priority**: URLs únicas são requisito de segurança e usabilidade; sem elas não é possível compartilhar ou referenciar vídeos de forma confiável.

**Independent Test**: Pode ser testado criando múltiplos vídeos com o mesmo título e verificando que cada um recebe um identificador diferente na URL.

**Acceptance Scenarios**:

1. **Given** dois vídeos criados com o mesmo título pelo mesmo ou diferentes usuários, **When** os registros são criados, **Then** cada um recebe um identificador único distinto na URL.
2. **Given** um vídeo existente, **When** seu título é alterado, **Then** o identificador único da URL permanece o mesmo.

---

### User Story 6 — Listar e gerenciar vídeos do canal (Priority: P3)

Um criador autenticado pode listar todos os vídeos do seu canal, visualizar os detalhes de cada um (incluindo status atual), editar o título e excluir vídeos. A exclusão remove os arquivos do armazenamento e cancela qualquer processamento pendente.

**Why this priority**: Gestão de conteúdo é essencial para um criador operar na plataforma, mas depende da existência de vídeos enviados — por isso vem após as histórias de upload e processamento.

**Independent Test**: Pode ser testado criando múltiplos vídeos para um canal e verificando: (a) a listagem retorna todos os vídeos do canal com seus status; (b) a edição de título persiste corretamente; (c) a exclusão remove o registro e os arquivos do storage.

**Acceptance Scenarios**:

1. **Given** um criador autenticado com vídeos no seu canal, **When** ele solicita a listagem (com ou sem parâmetros de paginação), **Then** o sistema retorna uma página de vídeos do canal ordenada do mais recente para o mais antigo, com identificador, título, status e data de criação de cada item, acompanhada de metadados de paginação (total, página atual, indicador de próxima página).
2. **Given** um criador autenticado e um vídeo do seu canal, **When** ele atualiza o título, **Then** o novo título é persistido e o identificador único da URL permanece inalterado.
3. **Given** um criador autenticado e um vídeo com status `ready`, **When** ele solicita a exclusão, **Then** o registro é removido do banco e os arquivos correspondentes (vídeo e thumbnail) são removidos do storage.
4. **Given** um criador autenticado e um vídeo com status `processing`, **When** ele solicita a exclusão, **Then** o sistema cancela a tarefa de processamento pendente, remove o registro e remove os arquivos do storage.
5. **Given** um usuário autenticado tentando editar ou excluir um vídeo de outro canal, **When** a operação é solicitada, **Then** o sistema retorna erro de autorização sem realizar nenhuma alteração.

---

### Edge Cases

- O que acontece se o cliente iniciar o upload mas nunca enviar o arquivo ao storage? (registro fica como `draft` indefinidamente — política de limpeza é considerada fora do escopo desta fase)
- O que acontece se o worker falhar e a mensagem for reprocessada? (o ciclo de status deve ser idempotente para evitar duplo processamento)
- O que acontece se o arquivo de vídeo estiver vazio ou corrompido? (status muda para `error` com causa registrada)
- O que acontece se a geração de thumbnail falhar mas os metadados forem extraídos com sucesso? (status muda para `error`; o sucesso parcial não é aceito como `ready`)
- O que acontece quando o cliente solicita um intervalo de bytes inválido ou além do tamanho real do arquivo durante o streaming? (o sistema retorna erro indicando que o intervalo não é satisfazível)
- O que acontece quando um usuário não autenticado tenta baixar um vídeo? (o sistema retorna erro de autorização sem entregar o arquivo, mesmo que o vídeo esteja `ready`)
- O que acontece quando um criador tenta excluir um vídeo em estado `processing` e o worker já começou a processar a mensagem da fila? (o sistema cancela a tarefa se ainda possível; caso o processamento já tenha terminado, trata o resultado como exclusão de vídeo `ready`)
- O que acontece quando um criador tenta editar ou excluir um vídeo que pertence a outro canal? (o sistema retorna erro de autorização sem realizar alterações)
- O que acontece quando o cliente tenta iniciar upload de um arquivo que não é do tipo vídeo (ex.: imagem, documento)? (o sistema rejeita a requisição com erro de validação sem criar nenhum registro)

## Clarifications

### Session 2026-06-27

- Q: Quem pode fazer streaming e download de vídeos com status `ready`? → A: Streaming livre para qualquer usuário (autenticado ou anônimo); download restrito a usuários autenticados.
- Q: `ready` é automaticamente público ou há um passo explícito de publicação separado? → A: `ready` = publicado; "publicar um vídeo" significa concluir o fluxo de upload + processamento bem-sucedido; não existe estado `published` separado nesta fase.
- Q: A listagem de vídeos do canal (FR-014) deve ser paginada? → A: Sim — paginação com limite configurável e metadados de navegação (total de itens, página atual, próxima página).
- Q: O vídeo deve ter campo de descrição além do título? → A: Não nesta fase — somente `título` é gerenciado pelo criador; descrição pode ser adicionada em fase futura.
- Q: Deve existir um endpoint público de detalhe de vídeo (por identificador)? → A: Sim — acessível por qualquer usuário, retornando título, status, thumbnail, duração e demais metadados disponíveis.
- Q: Qual a ordenação padrão da listagem de vídeos do canal? → A: Mais recentes primeiro — ordenado por data de criação decrescente.
- Q: Como o sistema sabe que o upload ao storage foi concluído para disparar o processamento? → A: O cliente chama um endpoint dedicado na API após concluir o envio direto ao storage.
- Q: O escopo de gerenciamento de vídeos inclui listagem, edição e exclusão? → A: CRUD completo — listagem, edição de título e exclusão (com remoção dos arquivos do storage e cancelamento de processamento pendente).
- Q: Quais formatos de vídeo são aceitos para upload? → A: Qualquer formato de vídeo suportado pelo processador; a API valida apenas que o tipo de mídia declarado é vídeo, sem lista restritiva de extensões.
- Q: O worker deve retentar em caso de falha antes de marcar como `error`? → A: 3 tentativas com intervalo fixo entre elas; após esgotar as tentativas, status muda para `error` com a causa da última falha registrada.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE permitir que usuários autenticados iniciem o upload de arquivos de vídeo de até 10 GB sem transmitir o conteúdo binário pela API; o sistema DEVE validar que o arquivo declarado é do tipo vídeo antes de pré-registrar o rascunho, rejeitando outros tipos de mídia.
- **FR-002**: O sistema DEVE pré-registrar o vídeo como rascunho (`draft`) no momento do início do upload, antes do arquivo ser enviado ao storage. Neste mesmo pré-registro, o sistema DEVE determinar e persistir a chave de localização do arquivo no storage (`storage_key`) — essa chave é usada para gerar a URL de upload pré-assinada e nunca é nula após a criação do registro.
- **FR-003**: O sistema DEVE atribuir um identificador único a cada vídeo no momento do pré-cadastro, garantindo ausência de conflitos entre vídeos com títulos iguais.
- **FR-004**: O sistema DEVE expor um endpoint dedicado para que o cliente sinalize que o envio do arquivo ao storage foi concluído; ao receber essa confirmação, o sistema DEVE enfileirar automaticamente uma tarefa de processamento para o vídeo correspondente.
- **FR-005**: O worker DEVE extrair duração e metadados técnicos do arquivo de vídeo e persistir essas informações no registro do vídeo. Os metadados técnicos mínimos a persistir são: largura e altura em pixels (resolução), codec de vídeo e taxa de bits em kbps.
- **FR-006**: O worker DEVE gerar uma thumbnail a partir de um frame representativo do vídeo e armazená-la no object storage.
- **FR-007**: O sistema DEVE atualizar o status do vídeo em cada transição do ciclo (`draft` → `processing` → `ready` | `error`).
- **FR-008**: O worker DEVE tentar o processamento até 3 vezes com intervalo fixo de 5 segundos entre tentativas; somente após esgotar as tentativas o status do vídeo DEVE mudar para `error`, com a causa da última falha registrada no registro do vídeo (truncada em 2048 caracteres).
- **FR-009**: O sistema DEVE suportar reprodução via streaming para qualquer usuário (autenticado ou anônimo), com respostas parciais quando o cliente solicitar um intervalo de bytes, para vídeos com status `ready`.
- **FR-010**: O sistema DEVE permitir o download do arquivo de vídeo completo para vídeos com status `ready`, restrito a usuários autenticados.
- **FR-011**: Cada vídeo DEVE pertencer a exatamente um canal; o canal é determinado pelo usuário autenticado no momento do pré-cadastro.
- **FR-012**: O object storage, a fila de processamento e o worker DEVEM ser provisionados como serviços gerenciados pela orquestração de containers do backend, subindo junto com a stack existente sem passos manuais adicionais.
- **FR-013**: A tabela de vídeos DEVE ser criada via migration versionada; nenhum schema é criado por sincronização automática do mecanismo de persistência.
- **FR-014**: O sistema DEVE permitir que o criador autenticado liste os vídeos do seu próprio canal de forma paginada, retornando identificador, título, status e data de criação de cada item, além de metadados de paginação (total de itens, página atual e indicador de próxima página); a ordenação padrão é por data de criação decrescente (mais recentes primeiro); o tamanho de página padrão é 20 itens; o tamanho máximo configurável é 100 itens por página.
- **FR-015**: O sistema DEVE permitir que o criador autenticado atualize o título de um vídeo do seu canal em qualquer status; o identificador único da URL não deve ser alterado pela edição.
- **FR-016**: O sistema DEVE permitir que o criador autenticado exclua um vídeo do seu canal em qualquer status; a exclusão DEVE remover o registro do banco e os arquivos correspondentes (vídeo e thumbnail) do armazenamento, além de cancelar qualquer tarefa de processamento pendente na fila (best-effort: aplica-se a jobs ainda enfileirados; jobs em execução ativa pelo worker não são interrompidos — o worker descartará o job ao não encontrar o registro do vídeo).
- **FR-017**: O sistema DEVE impedir que um usuário autenticado edite ou exclua vídeos pertencentes a canais de outros usuários, retornando erro de autorização.
- **FR-018**: O sistema DEVE expor um endpoint público de detalhe de vídeo, acessível por qualquer usuário (autenticado ou anônimo), que retorne título, status, referência à thumbnail, duração e demais metadados disponíveis para o vídeo identificado pelo seu identificador único de URL.

### Key Entities

- **Vídeo**: Representa um conteúdo de vídeo na plataforma. Atributos principais: identificador interno, identificador único da URL, título, status do ciclo de vida, referência ao arquivo de vídeo no armazenamento, referência à thumbnail no armazenamento, duração extraída, especificações técnicas do vídeo extraídas no processamento, canal proprietário, timestamps de criação e atualização.
- **Canal**: Entidade existente (Fase 02). Um canal possui muitos vídeos; cada vídeo pertence a exatamente um canal.
- **Tarefa de processamento**: Mensagem publicada na fila contendo o identificador do vídeo a ser processado e as informações de localização do arquivo no storage.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Arquivos de até 10 GB são enviados com sucesso sem causar timeout ou indisponibilidade na API para outras requisições simultâneas. Validação por design arquitetural: os bytes do arquivo não transitam pela API (upload direto ao storage via URL pré-assinada), dispensando teste de carga adicional para verificar este critério.
- **SC-002**: O processamento automático (extração de metadados + geração de thumbnail) é concluído sem intervenção manual do usuário após o upload.
- **SC-003**: O status do vídeo reflete corretamente cada etapa do ciclo de vida em tempo real, sem estados inconsistentes.
- **SC-004**: Todos os vídeos com status `ready` são acessíveis via streaming com suporte a requisições de intervalo (range), permitindo navegação no conteúdo sem download completo.
- **SC-005**: Cada vídeo recebe um identificador único na URL; a probabilidade de colisão é desprezível mesmo com alto volume de vídeos criados simultaneamente.
- **SC-006**: A infraestrutura (storage, fila, worker) sobe integralmente com um único comando de inicialização do Docker Compose, sem etapas manuais adicionais.
- **SC-007**: A suíte de testes (unitária + integração + e2e) passa integralmente; nenhum erro de compilação ou violação de estilo de código é introduzido pela implementação da fase.

## Assumptions

- O object storage utilizado localmente é MinIO rodando em Docker com API compatível com S3; em produção seria substituído por S3 ou equivalente — essa escolha de infraestrutura é assumida como decisão de negócio já tomada e não está em aberto.
- A tecnologia de fila (ex.: BullMQ com Redis, RabbitMQ, etc.) será definida na etapa de research (technical decisions) antes do planejamento; este spec não presume a escolha.
- A estratégia exata de upload sem passar pela API (URL pré-assinada, multipart, etc.) será definida na etapa de research; este spec descreve o comportamento esperado, não o mecanismo.
- O frontend existente (next-frontend) está fora do escopo desta fase; nenhuma interface de usuário para vídeos será implementada.
- Vídeos com status `draft` não expiram automaticamente nesta fase; limpeza de rascunhos abandonados é considerada out-of-scope.
- Não existe estado `published` separado: o status `ready` é o estado "publicado". "Publicar um vídeo" equivale a concluir o fluxo de upload + processamento bem-sucedido. Controle de visibilidade granular (ex.: vídeos privados ou não-listados) está fora do escopo desta fase.
- O único metadado fornecido pelo criador é o `título`; campo de descrição, tags e outros metadados editoriais estão fora do escopo desta fase.
- A autenticação reutiliza o guard JWT global implementado na Fase 02; não há nova camada de autenticação.
- FFmpeg/ffprobe são as ferramentas assumidas para extração de metadados e geração de thumbnail; a confirmação técnica ocorre na etapa de research.
- O módulo de vídeos seguirá os padrões arquiteturais estabelecidos nas Fases 01 e 02: separação de camadas (controller/service/repository/entity), migrations versionadas, filtro de exceções de domínio e testes nos três níveis (unit, integration, e2e).
- O identificador único da URL de cada vídeo é o próprio UUID gerado como chave primária (`id`); não existe campo `slug` separado. A URL de acesso a um vídeo segue o padrão `/videos/{uuid}`.
