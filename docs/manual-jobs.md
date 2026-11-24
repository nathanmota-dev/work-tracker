# Manual jobs

Use **Jobs → Add job** to save an opportunity without an agent or browser integration. A role title and company name are required. The URL, description, location, work type, compensation, application deadline, assessment, status and requirements JSON can be added now or through **Edit job** later. Source and source job ID identify opportunities from external sites; LinkedIn IDs remain compatible with existing CLI users.

Saving a draft does not create an application or start an agent. The form lists missing preparation fields. Preparation requires a title, company, valid HTTP(S) URL and description; a LinkedIn ID allows the existing preparation flow to retrieve the description. **Prepare application** opens Apply with the saved job, where resume generation is an explicit action.

## API and CLI

- `POST /api/jobs/create` accepts job fields and returns `{ job, created, existing, missing }`. A new job returns 201 and is shortlisted; an existing identity returns 200 with `existing: true` and the original saved content.
- `POST /api/jobs/update` accepts a positive local `id` and the fields to change. Omitted fields are preserved; empty optional text clears that field. A conflicting identity returns 409 with `existing_id` when available.
- Writable fields are `title`, `company_name`, `link`, `description`, `location`, `work_type`, `comp`, `fit`, `status`, `requirements_json`, `source`, `source_job_id`, `linkedin_job_id` and `deadline`.
- `work-tracker job save --title 'Engineer' --company 'Example' --source careers --source-id 42 --link 'https://careers.example/jobs?id=42'` uses the same validation and deduplication rules. Existing records are reported explicitly. Rediscovery can refresh supplied fit/status fields; archived jobs stay archived.
- `work-tracker job update --id 1 --description 'Build services'` updates supplied fields through the same store.

## Application deadlines

`deadline` is an optional local date in `YYYY-MM-DD` form, without a time or time zone. The form, the API and `work-tracker job save --deadline 2026-12-01` accept only real calendar dates; anything else, such as `2026-13-40`, fails with “Enter the deadline as a valid date.” and saves nothing. An empty value clears the deadline. Manual applications accept their own deadline; otherwise an application uses its job's deadline.

Jobs and Applications show the urgency as text: **Overdue** before today, **Due today** or **Due in N days** within 7 days, and the remaining days after that. **Sort by deadline** lists the soonest deadline first, followed by records without one. A deadline stops being urgent once the application is confirmed as submitted or the record is archived; it then shows only the date. The Dashboard's **Deadlines** panel lists up to five overdue or soon-due jobs and applications, soonest first. A job with an application in progress appears through that application. Preparing an overdue job is still allowed; the app only warns.

## Identity and history

Identity matches use a source and source job ID, a LinkedIn job ID extracted from supported LinkedIn URLs, or a normalized URL. Titles alone never merge jobs. Normalization handles host casing, `www`, HTTP/HTTPS, trailing slashes, query ordering and ordinary page anchors. It retains ports, unknown query parameters and SPA route fragments, removes UTM parameters, and removes LinkedIn tracking parameters only on LinkedIn hosts.

Conflicting identities and ambiguous legacy duplicates require review. Existing duplicates are preserved during migration. Identity checks and writes run in one SQLite transaction, including CLI writes from separate processes. Editing does not rewrite application links, application card fields, run manifests or PDF artifacts. Finish or cancel an active preparation run before editing its job.

## Discovery and triage

Jobs owns discovery: enter keywords, location, work arrangement and page count.
Direct LinkedIn searches save structured results automatically; **Assess fit with
agent** opens the contextual job-scout panel with the same criteria. Each search
reports saved, already saved and failed items. Repeated searches preserve existing
jobs, including archived roles.

Discovered jobs (LinkedIn searches and CLI/agent saves) appear in **New**, never
directly in **Shortlist**. Select one or several and choose **Move to shortlist** or
**Archive**. A job added by hand with **Add job** is already a choice, so it goes
straight to **Shortlist**, and so does a job that gets an application (opened from
Apply or linked from a manual application); archived jobs stay archived.
Shortlist retains filtering, selection and batch preparation. Archived jobs retain
their prior triage state on restoration. The search criteria and tab persist in
the URL; legacy Search job links redirect to Jobs, and people search lives in Contacts.

## Triagem em lote

A coluna **Score** mostra a nota de triagem como texto (“78 · Strong fit”), ou `Expired`, `Unreachable (attempt N)` e `Check manually`, com 🔥 “Closing soon” quando o prazo vence em até 7 dias. **Sort by score** ordena pela nota, com o prazo próximo como desempate, ao lado de **Sort by deadline**. O detalhe da vaga mostra as notas de Technical, Experience e Career alignment, os pontos fortes, as lacunas, a data da pontuação e o aviso de que é uma triagem a partir do texto da vaga; o botão **Apply** continua sendo a avaliação completa.

**Rank selected**, **Rank new roles** e **Rank all again** abrem a skill `work-tracker-job-ranking` no painel do agente e a página continua utilizável. Vagas arquivadas ou com candidatura enviada nunca são candidatas. O agente lê e grava apenas pelo CLI:

- `work-tracker ranking candidates [--limit N] [--all] [--job-ids 1,2]` lista as candidatas em JSON, com as contagens `eligible`, `deferred`, `expired` e `already_ranked`; é a consulta da skill, que nunca lê a lista inteira de vagas.
- `work-tracker ranking save --job-id <n> --file result.json` grava o resultado de uma vaga (`{ "status": "scored", "scores": { "technical", "experience", "career" }, "strengths": [...], "gaps": [...] }`, ou `unreachable`/`expired` com `fetch_error`) e imprime o ranking com `overall` e `verdict` calculados.
- `work-tracker ranking list` e `GET /api/rankings` listam os rankings com a expiração derivada do prazo; `work-tracker job list` traz `ranking_status` e `ranking_overall` por vaga.

Dimensões, pesos, faixas e a regra de desistência estão em [features-e-fluxos.md](features-e-fluxos.md#14-triagem-em-lote-das-vagas-salvas).

## Verificação de integridade da descrição

Toda descrição de vaga passa por uma guarda determinística (`src/postings/guard/`, portada do `tools/posting_guard.py` do `ai-job-search`) antes de ser gravada: no formulário de vaga, em `POST /api/jobs/create|update`, em `work-tracker job save|update --description`, na descrição colada no Apply, na descrição obtida do LinkedIn por `ensureDescription` e na vaga criada ou vinculada a partir de uma candidatura manual. Só o **texto limpo** é gravado em `jobs.description`; o resultado (veredito, contagens e trechos curtos, no máximo dez por classe) fica em `jobs.description_guard_json`.

O que a guarda faz:

- **Remove** conteúdo HTML escondido (`display:none`, `visibility:hidden`, `opacity:0`, `font-size` zero ou quase zero, `color:transparent`, `clip`/`clip-path`, posicionamento fora da tela, caixa colapsada com `overflow:hidden`, atributo `hidden`, `aria-hidden`), lendo o estilo como um navegador (entidades decodificadas, comentários CSS ignorados). Comentários e blocos `script`/`style`/`noscript`/`svg`/`template` também saem do texto.
- **Remove e conta** caracteres invisíveis (largura zero, controles bidi, hífen suave, BOM, caracteres de tag Unicode e seletores de variação). Os que indicam adulteração (largura zero no meio de palavra, bidi override/isolate, qualquer caractere de tag fora das três bandeiras do Reino Unido) acionam o ⚠. Texto escrito em caracteres invisíveis é decodificado e citado.
- **Cita, sem remover**, linhas com forma de instrução para um agente (“ignore all previous instructions”, “system prompt”, marcadores de papel, `[INST]`…). Linhas visíveis que só mencionam `curl`, `wget`, `ssh`, `scp` ou `.env` são citadas como menção a ferramenta, sem ⚠, porque vagas de infraestrutura falam disso legitimamente; no conteúdo escondido elas contam como instrução.
- **Lista** URLs que só existem no conteúdo escondido e palavras que misturam alfabeto latino com cirílico ou grego.

O veredito é uma linha em inglês, por exemplo `Posting check: clean`, `Posting check: clean (2 hidden blocks removed)` ou `Posting check ⚠: 1 instruction-shaped line - review before continuing (1 hidden block removed)`. Blocos e URLs escondidos são contexto, não alarme: quase toda página real tem navegação oculta. Uma descrição que não deixa texto legível recebe `Posting check: refused (no text to evaluate)` e não é gravada. A guarda **avisa, nunca bloqueia** a vaga ou o agente.

Onde o veredito aparece:

- No detalhe da vaga (Jobs) e no quadro de prontidão do Apply, como selo “Posting check”, com as contagens e os trechos citados como texto, nunca como HTML. O ícone e o texto, além da cor, indicam o estado.
- Depois de salvar o formulário de vaga, numa linha de status.
- Para os agentes: `work-tracker job list` traz `guard_verdict` por vaga (sem os trechos, que citam o conteúdo escondido), `work-tracker application show` traz `guard.verdict` e o manifesto de geração traz `descriptionCheck`. As skills que leem vagas têm a seção “Trust boundary”, que manda relatar ao usuário um veredito com ⚠.

Vagas salvas antes da guarda (schema v14) não são reescritas pela migração e mostram “Not checked” até a próxima edição da descrição. Antes de gerar um currículo, `ensureDescription` aplica a guarda a uma descrição ainda não verificada, de modo que o agente só recebe texto limpo.

O que a guarda não faz: não valida o conteúdo semântico da vaga, não busca páginas e não altera as permissões de ferramentas do agente (ver [agent-permissions.md](agent-permissions.md)). Ela pega as classes de ataque que deixam rastro; uma manipulação escrita para parecer natural a um humano e a um agente não deixa nenhum. **Instrução em nível de prompt não é uma sandbox**: a seção “Trust boundary” das skills e a guarda reduzem o risco, e as decisões de ferramenta do agente continuam passando pela aprovação descrita em `agent-permissions.md`.

## Portões eliminatórios (idioma e elegibilidade)

Dois filtros duros rodam **antes** de pontuar ou preparar uma vaga, portados das seções *Eligibility Gate* e *Language Gate* do `ai-job-search`. Eles não são dimensões de score: dizem se a vaga tem uma exigência que nenhuma candidatura contorna.

### Como declarar

Em **Profile → Deal-breakers**:

- **Languages you work in**: cada idioma com o nível em texto livre (“Native”, “C1”, “B1/B2 (conversational)”) e notas opcionais. O nome é único sem diferenciar maiúsculas e espaços; para mudar o nível, use **Edit level**. Um idioma não declarado conta como “não”: uma vaga que o exige reprova.
- **Work eligibility**: “Citizen or permanent resident”, “I need a visa or work permit” ou **Not set**, que desliga o portão de elegibilidade.

Sem idiomas e sem elegibilidade, os dois portões ficam desligados, nada reprova e a página explica como ligá-los. O mesmo perfil está no CLI: `work-tracker gates profile`, `gates language save --language --level [--notes]` (atualiza pelo nome), `gates language remove --language` e `gates eligibility set --status citizen_or_resident|needs_permission|none`. A API é `GET /api/gates/profile`, `POST /api/gates/languages` (com `action: "remove"` para remover) e `POST /api/gates/eligibility`. Os dados ficam nas tabelas `candidate_languages` e `gate_profile` (schema v18).

### Como a verificação roda

**Check requirements**, no detalhe da vaga ou na seleção de vagas em Jobs, abre a skill `work-tracker-requirements-check` no painel do agente. A skill lê a descrição salva (já limpa pela verificação de integridade), extrai cada idioma exigido **para o trabalho** e o que o anúncio diz sobre cidadania, residência, habilitação de segurança e patrocínio de visto, **sempre com o trecho literal**, e grava com `work-tracker job gate --id <n> --file extraction.json`. O idioma em que o anúncio está escrito não é exigência. A comparação de nível é julgamento da skill (`bar_above_declared`), não uma escala CEFR. A `work-tracker-job-scout` oferece a mesma verificação para as vagas que acabou de salvar.

O **veredito é calculado no código** (`src/gates/evaluate.ts`) a partir da extração e do perfil, e fica em `jobs.gate_json`:

| Portão | Anúncio | Veredito |
| --- | --- | --- |
| Idioma | exige idioma ausente dos seus idiomas | `fail` |
| Idioma | exige idioma declarado em nível que parece maior (ou incerto) | `flag` |
| Idioma | exige idioma declarado em nível igual ou menor, ou não exige idioma | `pass` |
| Elegibilidade (precisa de permissão) | exige cidadania, residência permanente ou habilitação de segurança | `fail` |
| Elegibilidade (precisa de permissão) | nomeia sua autorização, aceita estrangeiros ou patrocina visto, para esta vaga | `pass` |
| Elegibilidade (precisa de permissão) | silencioso, ou só uma declaração geral da empresa | `pass` **não verificado** |
| Elegibilidade (precisa de permissão) | a lista da empresa existe e não inclui esta vaga | `flag` |
| Elegibilidade (cidadão ou residente) | exige habilitação de segurança | `flag` |

Silêncio não é permissão. Uma extração sem `quote` num item que pesa no veredito é recusada com mensagem clara. Mudar idiomas ou elegibilidade reavalia todas as verificações gravadas, sem chamar o agente; mudar a descrição da vaga apaga a verificação dela, porque os trechos citados deixam de valer.

### O que cada veredito mostra

- Na lista de Jobs, a coluna **Requirements** mostra `Fail`, `Flag`, `Pass`, `Pass (unverified)` ou `Not checked`, sempre com texto, não só cor. No detalhe, cada portão aparece com a razão e o trecho citado.
- **Hide failed**, ligado por padrão em New, recolhe as vagas reprovadas: elas continuam contadas (“1 hidden”), voltam ao desligar o filtro e **nunca são apagadas nem arquivadas**.
- No Apply, uma vaga `fail` mostra o aviso com a citação e só libera **Generate resume** depois de **Prepare anyway**: o usuário pode saber algo sobre a própria situação que o perfil não registra.
- Na triagem em lote, `work-tracker ranking candidates` e `GET /api/rankings/candidates` deixam as vagas `fail` de fora e as listam em `gate_failed`, com a razão citada; a prévia da execução mostra “N failed deal-breakers”.
- Para agentes, `work-tracker job list` e `GET /api/jobs` trazem `gate_verdict` (`pass`, `flag`, `fail` ou `unchecked`), sem os trechos de `gate_json`. `GET /api/gates/jobs/:id` e `work-tracker job gate --id <n>` (sem `--file`) devolvem a verificação completa.

O portão **avisa e filtra; não decide pelo usuário**. Ele não busca vagas, não pontua e não cobre localização, relocação ou viagens.
