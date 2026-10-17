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

