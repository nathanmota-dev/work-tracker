# Jornada da candidatura

Uma candidatura é **um registro** em `applications`. Preparação do currículo,
preenchimento do portal, envio, etapa do quadro e arquivamento são dimensões
independentes desse mesmo registro. O contrato fica em
[src/applications/journey.ts](../src/applications/journey.ts); as operações no
banco ficam em [src/applications/journey-store.ts](../src/applications/journey-store.ts)
e são usadas pela API (quadro e Apply), pela CLI e, por meio dela, pelos agentes.

## Identidade, origem e vínculo com a vaga

| Coluna | Significado |
| --- | --- |
| `id` | ID local da candidatura. Nunca é reutilizado nem recriado por uma migração. |
| `job_id` | ID **local** da vaga (`jobs.id`). O ID externo do LinkedIn fica em `jobs.linkedin_job_id`; a CLI aceita `--job-id` (local) ou `--linkedin-job-id` (externo) e recusa combinações divergentes. |
| `origin` | `preparation` (gerada pelo Apply), `manual` (registrada no quadro), `agent` (CLI/skills) ou `unknown` (legado sem origem determinável). |
| `attempt` | Número da tentativa para a vaga; único por `(job_id, attempt)`. |
| `previous_application_id` | Tentativa anterior quando houve nova candidatura explícita. |
| `idempotency_key` | Chave opcional; repetir a requisição com a mesma chave devolve o registro criado. |
| `review_reason` | Marcação de registros legados ambíguos; a revisão em Candidaturas (abaixo) a recalcula a cada decisão. |

Candidaturas nunca são deduplicadas por título ou empresa: duas vagas com o mesmo
título são vagas diferentes, e dois registros manuais sem chave são registros
diferentes.

## Dimensões e transições

| Dimensão | Coluna | Estados |
| --- | --- | --- |
| Preparação | `preparation_status` | `not_started`, `in_progress`, `ready`, `failed` |
| Preenchimento | `fill_status` | `not_started`, `in_progress`, `filled`, `needs_input`, `failed` |
| Envio | `submission_status` (+ `submitted_at`) | `not_submitted`, `submitted` |
| Acompanhamento | `tracking_status` (+ `current_stage_id`) | `active`, `archived` (nulo antes de entrar no quadro) |

| Ação | De | Para | Regras |
| --- | --- | --- | --- |
| `prepare.start` | `not_started`, `ready`, `failed` | `in_progress` | Bloqueada após envio. |
| `prepare.complete` | `not_started`, `in_progress`, `failed` | `ready` | Bloqueada após envio. |
| `prepare.fail` / `prepare.cancel` / `prepare.restore` | `in_progress` | `failed` / `not_started` / `ready` | `restore` mantém o currículo validado anterior. |
| `fill.start` | `not_started`, `filled`, `needs_input`, `failed` | `in_progress` | Exige preparação `ready`; bloqueada após envio. |
| `fill.complete` | `not_started`, `in_progress`, `needs_input`, `failed` | `filled` | Bloqueada após envio. |
| `fill.needs_input` | `not_started`, `in_progress`, `filled`, `failed` | `needs_input` | Bloqueada após envio. |
| `fill.fail` / `fill.cancel` / `fill.restore` | `in_progress` | `failed` / `not_started` / `filled` | `restore` mantém o preenchimento anterior. |
| `fill.reset` | `filled`, `needs_input`, `failed` | `not_started` | Um currículo novo exige novo preenchimento. |
| `submit` | `not_submitted` | `submitted` | Não exige preparação (registro manual); nunca é desfeita. |
| `archive` / `reopen` | `active` / `archived` | `archived` / `active` | Executadas pelo quadro. |

Regras gerais:

- Cada ação altera somente a própria dimensão. Gerar currículo não envia; mover
  ou arquivar um card não altera `submission_status` nem `submitted_at`.
- Ações marcadas como idempotentes (`*.start`, `*.complete`, `fill.needs_input`,
  `fill.reset`, `submit`) não fazem nada quando a dimensão já está no estado de
  destino. Repetir uma ação não cria candidatura, card, evento nem transição.
- Cada mudança efetiva grava uma linha em `application_transitions` com ação,
  estados, ator (`api`, `cli`, `agent`, `system`) e execução, na mesma transação
  da mudança. Uma falha desfaz tudo.
- `applications.status` continua existindo como resumo derivado para leitores
  antigos: `submitted`, `filled`, `needs_input` ou `draft`. Na CLI,
  `--status draft|filled|needs_input|submitted|applied` é convertido nas ações
  acima; voltar para `draft` depois do envio é recusado.
- Uma execução interrompida (fechar o app, cancelar ou falhar) devolve a dimensão
  em andamento a um estado de repouso sem apagar o currículo ou o preenchimento
  válidos anteriores.

## Confirmação de envio e entrada no quadro

O envio no portal é sempre manual. Ao clicar em "I submitted in the browser" no
Apply, uma única transação (`PreparationService.submitted` com
`startTracking`, em [journey-store.ts](../src/applications/journey-store.ts)):

- valida o vínculo: a execução precisa ter o PDF ajustado, pertencer à mesma
  vaga e à mesma candidatura (`applicationId`, quando enviado) e ser a execução
  cujo documento foi preenchido (`preparation_run_id`); caso contrário a
  confirmação é recusada sem nenhuma escrita;
- aplica `submit` (data em `submitted_at`, preservando um `applied_at` anterior);
- coloca o **mesmo registro** no quadro: etapa inicial (`applied`),
  `tracking_status = active`, empresa, cargo e link copiados da vaga quando
  ausentes, e um único evento `created` em `application_events`.

Repetir a confirmação, inclusive em paralelo, devolve `alreadySubmitted: true`
com o mesmo ID e a data original, sem novo card, evento ou transição. Um
registro já enviado que ainda não estava no quadro entra nele nessa
confirmação. Uma falha desfaz tudo e o Apply mostra o erro, mantendo a ação
disponível para nova tentativa. O registro manual pelo quadro usa a mesma
função `startTracking`. As telas são avisadas pelos eventos `changed` de
`applications` e `application_events`, então o quadro se atualiza sem reiniciar
o app.

## Recuperação por fase das execuções

Cada execução do Apply (`application_runs`) grava em `recovery_json` os
checkpoints validados (`sources`, `tailored`, `compiled`, `filled`; ver
[recovery.ts](../src/preparation/recovery.ts)). `runRecord` expõe o campo
derivado `recovery` (`checkpoints`, `retryFrom`, `reviewRequired`, `summary`),
que o desktop lê também após reiniciar ou reconectar.

- `POST /api/application-preparation/retry` continua a **mesma execução e a
  mesma candidatura** a partir da fase necessária: sem snapshot salvo, refaz a
  preparação; com snapshot, restaura o projeto e repete só o ajuste; com fontes
  ajustadas, repete só a compilação; com PDF validado, repete só o
  preenchimento. O currículo validado nunca é regenerado para preencher.
- O PDF ajustado, a atualização da candidatura e as transições são gravados na
  mesma transação, então uma falha não deixa alteração parcial.
- Falha, cancelamento, interrupção (app fechado) e login pendente são estados
  distintos. Ao abrir o app, execuções `running` e `waiting_for_sign_in` ficam
  `interrupted`; uma sessão ACP aguardando login não é restaurada, e a mensagem
  diz que a nova tentativa inicia outra sessão.
- O preenchimento é a única ação externa. Enquanto o agente pode agir no portal,
  a execução fica marcada; se ela parar sem resultado, o app verifica o
  `fill-result.json`: um resultado válido salvo antes do fechamento conclui o
  preenchimento sem repeti-lo; sem resultado, `reviewRequired` exige que o
  candidato revise o portal e confirme (`reviewed: true`) antes de preencher de
  novo. Login pendente informado pelo agente não exige revisão.

## Nova candidatura e republicação

Sem decisão explícita, a mesma vaga reutiliza sempre a sua última tentativa:
gerar de novo, repetir `work-tracker application add --job-id N` ou confirmar o
envio duas vezes devolve o mesmo registro. Uma nova tentativa para a mesma vaga
(por exemplo, a vaga foi republicada com o mesmo ID) exige `--new-attempt` e só é
aceita depois que a tentativa anterior foi enviada; ela recebe `attempt + 1` e
aponta para a anterior em `previous_application_id`. Uma vaga republicada com
outro ID do LinkedIn é outra vaga e tem a sua própria tentativa 1.

## Migração dos registros existentes (schema v4)

A migração 4 (`application journey model`) é marcada como incompatível, então
um snapshot é gravado antes dela. Ela classifica somente o que é determinístico:

- Registros no quadro (`current_stage_id` preenchido) ou com `status = submitted`
  ficam `submitted`, com `submitted_at = applied_at`.
- `filled`/`needs_input` definem o preenchimento; `resume_path` define a
  preparação como `ready`; `preparation_run_id` define a origem `preparation`, e
  registros do quadro sem vaga, a origem `manual`.
- Tentativas são numeradas por vaga, em ordem de ID.

Registros ambíguos recebem `review_reason` e **não são associados
automaticamente** a nenhuma vaga: `missing_job` (vaga ausente ou inexistente),
`unknown_status` (status sem significado conhecido, como `applied` fora do
quadro; o texto original é mantido), `missing_stage` (enviado mas fora do quadro)
e `duplicate_job` (segunda candidatura para a mesma vaga). IDs, vínculos, eventos
do quadro e artefatos são preservados.

## Candidatura manual e vínculo com a vaga

Uma candidatura registrada no quadro pode escolher uma vaga salva ("Saved job"):
os campos vazios do formulário recebem empresa, link, cargo e remuneração da
vaga, e a candidatura existente dessa vaga é reaproveitada (seus campos já
gravados prevalecem), então trocar de tela não cria outra candidatura.

Sem vaga, "Prepare application" em Candidaturas abre primeiro o vínculo
(`application-board/link/options` e `application-board/link`, em
[job-link.ts](../src/applications/job-link.ts)):

- vagas plausíveis vêm somente do mesmo link ou do mesmo ID do LinkedIn, nunca de
  empresa ou cargo; com mais de uma, o usuário escolhe; uma vaga que já tem
  candidatura aparece como conflito e não pode ser vinculada;
- "Create a job from this application" cria a vaga com cargo, empresa, link,
  remuneração e descrição da candidatura; cargo, empresa e link são obrigatórios,
  e criar uma vaga com um link já salvo é recusado (escolha a vaga existente);
- dados que faltam para a preparação (cargo, empresa, link e descrição, quando a
  vaga não tem ID do LinkedIn) são apontados antes de abrir o Apply;
- o vínculo preserva ID, origem, envio, etapa e eventos da candidatura, copia
  apenas campos vazios do card e registra o vínculo em `activity_log`. Depois, o
  Apply abre com `jobId` e `applicationId` da mesma candidatura.

Na CLI: `work-tracker application link --id N --job-id M` (ou
`--linkedin-job-id`, ou `--create [--title --company --external-url --comp
--description]`).

## Reconciliação dos registros antigos

Registros com `review_reason` aparecem em "Needs review" na tela Candidaturas
(`application-board/review`, em [review.ts](../src/applications/review.ts)) com
o motivo, os dados faltantes, as vagas plausíveis e as outras candidaturas da
mesma vaga. Nada é fundido nem recebe outro ID.

"Apply safe fixes" (`review/reconcile`, ou `work-tracker application reconcile`)
aplica somente o que é determinístico e pode ser repetido sem efeito:

- um registro enviado fora do quadro entra nele (etapa inicial, um evento
  `created`), mantendo `submitted_at`;
- um `applied` legado registrado fora do Apply (CLI, agentes, manual) com data é
  um envio: recebe `submit` na data original e entra no quadro. Um `applied` de
  um registro do Apply continua em revisão, porque lá só a confirmação no
  navegador envia.

Registros sem empresa, link ou data para o card, vagas ambíguas e status
desconhecidos esperam uma decisão explícita (`review/resolve`, ou
`work-tracker application resolve --id N --decision ...`): `track`,
`mark_submitted` (com os dados faltantes informados), `mark_not_submitted`
(normaliza o status sem tocar preparação e preenchimento) ou `keep_attempt`
(mantém uma segunda candidatura da mesma vaga como tentativa separada, apontando
`previous_application_id`). Vincular a vaga usa o mesmo fluxo de vínculo acima.
Após cada decisão, o motivo é recalculado; um registro só sai da revisão quando
não resta nenhum problema. Cada operação roda numa transação, então uma falha
não deixa alterações parciais.


## Área Candidaturas e contagens da jornada

A tela **Applications** (antes "Automatic applications") lista candidaturas
manuais e preparadas pelo agente. Cada linha mostra a origem (`Apply`, `Agent`,
`Manual` ou `Unknown`, a partir de `origin`), o passo da jornada e a próxima
ação contextual. As colunas derivadas são calculadas no servidor por
[journey-summary.ts](../src/applications/journey-summary.ts), que é a única
definição usada pela lista, por Jobs, pelo quadro e pelo dashboard
(`/api/applications/summary` e `overview.journey`).

| Dimensão | Valores | Regra |
| --- | --- | --- |
| Passo (`phase`) | `draft`, `prepared`, `filled`, `submitted` | O passo mais avançado: enviado; senão preenchido (`filled` ou `needs_input`); senão currículo `ready`; senão rascunho. Cada candidatura tem exatamente um passo, então um rascunho nunca é contado como enviado. |
| Visão (`view`) | `preparation`, `tracking`, `archived` | `tracking_status` `active` → Tracking (igual à aba Active do quadro); `archived` → Archived (igual à aba Archived); sem acompanhamento → Preparation. |
| Origem | `preparation`, `agent`, `manual`, `unknown` | Coluna `origin`. |

Passos, visões e origens particionam o mesmo conjunto: cada soma é igual ao
total. As sobreposições entre dimensões são informadas à parte (`overlaps`):
currículos prontos incluem candidaturas preenchidas e enviadas; enviadas podem
estar arquivadas; e um envio legado fora do quadro aparece na visão Preparation
como `submitted` até ser resolvido em "Needs review".

Próxima ação: rascunho → "Prepare application"; preparado → "Fill in Apply";
preenchido → "Submit in Apply"; no quadro → "Open board" ou "Reopen on board"
(`/applications?view=board`, com o card destacado); enviado fora do quadro →
"Needs review". Em Jobs, cada vaga mostra a última tentativa vinculada com o
mesmo passo, e a ação da linha e do detalhe é "Apply" (sem candidatura),
"Continue application" (em preparação) ou "View application" (já no quadro). O
dashboard mostra os quatro passos com a ação mais útil. Lista, Jobs, quadro e dashboard dependem da tabela
`applications`, então o evento `changed` da confirmação de envio os atualiza
sem recarregar o app.

## Uma página para a candidatura

Applications reúne todas as candidaturas, do rascunho à última etapa, com a
alternância **List | Board** guardada na URL (`view=list|board`), junto com a
busca (`q`), a aba do quadro (`tab=active|archived`), o card destacado
(`highlight`) e o filtro de revisão (`review`). `/application-board` redireciona
para `/applications?view=board` preservando a busca.

- **Board:** à esquerda ficam as colunas fixas **Draft → Prepared → Filled**,
  calculadas pelo servidor a partir de `phase` e `view` (não podem ser
  arrastadas); depois vêm as etapas configuráveis (Manage stages). Só entra nas
  etapas o que teve envio confirmado; um envio legado fora do quadro aparece em
  "Needs review", não numa coluna de preparo.
- **Needs review:** banner nos dois modos; "Review" abre as decisões e, na
  lista, mostra só os registros sinalizados enquanto houver algum.
- A fila de preparação (Preparation queue) e o acesso à revisão de lote ficam em
  Applications; "New application" (registro manual) e Archived continuam lá.

O detalhe (`/apply`, com `jobId`, `applicationId`, `runId` e `batchId`) não está
na sidebar e se chama **Application**, com o breadcrumb
`Applications / <empresa · cargo>`. Um stepper derivado da fase e da prontidão
(`ApplyReadiness`) indica o passo atual e seus bloqueios: **1. Job description →
2. Resume → 3. Fill portal → 4. Confirm submission**. Sem `jobId`, a tela mostra
um estado vazio com link para a Shortlist de Jobs. Até a #50, Resume sources
aparece recolhido como "Base resume configured / missing". Após confirmar o
envio, "View it on the board" abre `/applications?view=board` com o card
destacado.

