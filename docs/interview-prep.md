# Preparação para entrevistas

A página **Interview prep** (grupo Journey da sidebar) monta um pacote de preparação para uma candidatura. Ela dispara a skill empacotada `work-tracker-interview-prep` pelo mesmo caminho das outras skills: o backend sobe o agente via ACP, transmite o progresso e a skill grava o resultado pelo CLI `work-tracker`.

## Fluxo

1. Escolha uma candidatura não arquivada, a etapa (recrutador, técnica, final etc.), a data, o formato e os entrevistadores. Contexto adicional é opcional.
2. Escolha agente, modelo e esforço e execute. A execução respeita a exclusividade das demais (não roda junto com outra execução, preparação ou diagnóstico).
3. A skill lê a candidatura (`work-tracker application show --id <n>`), o currículo e a carta enviados, as respostas reutilizáveis e o banco de experiências, pesquisa a empresa e produz o pacote.
4. O pacote é salvo com `work-tracker interview-prep save` e aparece em **Saved packs**, do mais recente para o mais antigo. Um novo pacote para a mesma etapa não substitui o anterior.

## Conteúdo do pacote

Perguntas prováveis, respostas no formato STAR baseadas só em fatos do candidato, brief de consistência com os documentos enviados, perguntas difíceis, perguntas a fazer e logística. Lacunas recebem uma resposta-ponte honesta; a skill nunca inventa experiência e só inclui pesquisa verificada.

## Persistência e API

- Tabela `interview_preps` (schema v12): `application_id`, `stage`, `scheduled_at`, `format`, `interviewers`, `body_md`, `created_at`. Entra no backup do banco.
- `GET /api/interview-preps` lista todos os pacotes e `GET /api/interview-preps/<applicationId>` os de uma candidatura.
- CLI: `work-tracker application show --id <n>`, `work-tracker interview-prep save --application-id <n> --stage <s> --file <pack.md> [--when --format --interviewers]` e `work-tracker interview-prep list [--application-id <n>]`.

## Fora do escopo

A simulação de entrevista (perguntas e respostas ao vivo) exige conversa interativa durante a execução do agente, que a interface ainda não oferece (ver M23 em `docs/features-e-fluxos.md`).
