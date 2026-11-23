# Manual jobs

Use **Jobs → Add job** to save an opportunity without an agent or browser integration. A role title and company name are required. The URL, description, location, work type, compensation, assessment, status and requirements JSON can be added now or through **Edit job** later. Source and source job ID identify opportunities from external sites; LinkedIn IDs remain compatible with existing CLI users.

Saving a draft does not create an application or start an agent. The form lists missing preparation fields. Preparation requires a title, company, valid HTTP(S) URL and description; a LinkedIn ID allows the existing preparation flow to retrieve the description. **Prepare application** opens Apply with the saved job, where resume generation is an explicit action.

## API and CLI

- `POST /api/jobs/create` accepts job fields and returns `{ job, created, existing, missing }`. A new job returns 201 and is shortlisted; an existing identity returns 200 with `existing: true` and the original saved content.
- `POST /api/jobs/update` accepts a positive local `id` and the fields to change. Omitted fields are preserved; empty optional text clears that field. A conflicting identity returns 409 with `existing_id` when available.
- Writable fields are `title`, `company_name`, `link`, `description`, `location`, `work_type`, `comp`, `fit`, `status`, `requirements_json`, `source`, `source_job_id` and `linkedin_job_id`.
- `work-tracker job save --title 'Engineer' --company 'Example' --source careers --source-id 42 --link 'https://careers.example/jobs?id=42'` uses the same validation and deduplication rules. Existing records are reported explicitly. Rediscovery can refresh supplied fit/status fields; archived jobs stay archived.
- `work-tracker job update --id 1 --description 'Build services'` updates supplied fields through the same store.

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

Vagas salvas antes da guarda (schema v13) não são reescritas pela migração e mostram “Not checked” até a próxima edição da descrição. Antes de gerar um currículo, `ensureDescription` aplica a guarda a uma descrição ainda não verificada, de modo que o agente só recebe texto limpo.

O que a guarda não faz: não valida o conteúdo semântico da vaga, não busca páginas e não altera as permissões de ferramentas do agente (ver [agent-permissions.md](agent-permissions.md)). Ela pega as classes de ataque que deixam rastro; uma manipulação escrita para parecer natural a um humano e a um agente não deixa nenhum. **Instrução em nível de prompt não é uma sandbox**: a seção “Trust boundary” das skills e a guarda reduzem o risco, e as decisões de ferramenta do agente continuam passando pela aprovação descrita em `agent-permissions.md`.
