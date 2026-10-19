# Migrações do banco e recuperação

O banco do workspace fica em `~/.work-tracker/work-tracker.db` (ou em
`$WORK_TRACKER_HOME/work-tracker.db`) e é aberto por `db()` em
[src/db/index.ts](../src/db/index.ts). Toda abertura passa por
`migrateDatabase()` em [src/db/migrations.ts](../src/db/migrations.ts).

## Como a abertura decide o que fazer

| Situação ao abrir | Comportamento |
| --- | --- |
| Banco vazio | Cria o esquema atual (`SCHEMA_SQL` + colunas aditivas + sementes), registra todas as migrações em `schema_migrations` e grava `meta.schema_version = SCHEMA_VERSION`. |
| Workspace sem versão (sem `meta` ou sem `schema_version`) | Tratado como versão 0 e atualizado pelas migrações pendentes. |
| Versão menor que `SCHEMA_VERSION` | Executa as migrações pendentes em ordem, com verificações de integridade (abaixo). |
| Versão igual a `SCHEMA_VERSION` | Aplica apenas mudanças aditivas e idempotentes (tabelas, colunas, índices e sementes ausentes). |
| Versão maior que `SCHEMA_VERSION` ou valor não numérico | Recusa com `IncompatibleSchemaError`, sem alterar o arquivo. Atualize o Work Tracker. |

As versões 0 a 3 eram mantidas apenas com alterações aditivas; a migração 3
(`legacy additive baseline`) completa o que faltar nesses workspaces sem alterar
linhas, IDs ou colunas existentes.

A migração 4 (`application journey model`) adiciona as dimensões da jornada da
candidatura e classifica os registros existentes; por reescrever o resumo
`applications.status` de registros do quadro, ela é incompatível e gera uma
cópia pré-migração. As regras estão em
[application-journey.md](application-journey.md#migração-dos-registros-existentes-schema-v4).

A migração 7 (`document review versions`) adiciona versões dos documentos,
aprovações e referências do PDF usado no portal, sem modificar documentos ou
aprovar versões antigas. Veja [document-review.md](document-review.md).

## Garantias de uma atualização

Antes de qualquer passo:

1. `PRAGMA quick_check` precisa retornar `ok`.
2. São registradas as violações de chave estrangeira já existentes
   (`PRAGMA foreign_key_check`) e a contagem de linhas de cada tabela.
3. Se algum passo pendente tiver `incompatible: true`, uma cópia consistente é
   gravada em `~/.work-tracker/backups/work-tracker-v<de>-to-v<para>-<data>.db`.
   Se a cópia falhar, nenhum passo é executado.

Todos os passos pendentes rodam em **uma única transação**, com
`foreign_keys` desligado para permitir reconstrução de tabelas. Antes do
`COMMIT`, a transação confere `verify()` de cada passo, `quick_check`, que
nenhuma nova violação de chave estrangeira surgiu e que nenhuma tabela perdeu
linhas ou desapareceu. Cada passo é gravado em `schema_migrations` e a nova
versão em `meta` somente no fim dessa transação. Qualquer falha desfaz tudo:
dados, histórico de migrações e versão permanecem como estavam, e a abertura
falha com o erro original (`MigrationIntegrityError` para violações de
integridade). Reabrir executa novamente apenas o que continua pendente.

## Snapshot reutilizável

`snapshotDatabase(db, destino)` em [src/db/snapshot.ts](../src/db/snapshot.ts)
usa `VACUUM INTO` pela conexão aberta. Por isso a cópia inclui páginas
confirmadas que ainda estão no arquivo WAL e resulta em um único arquivo, sem
`-wal`/`-shm`. A cópia é gravada como `<destino>.partial` com permissão `0600`,
validada com `quick_check` e só então renomeada; o destino nunca é
sobrescrito. Não chame a função dentro de uma transação. O backup do workspace
(feature 09) deve reutilizar essa função em vez de copiar arquivos do banco.

## Recuperação a partir de uma cópia pré-migração

1. Feche o Work Tracker e qualquer comando `work-tracker` em execução.
2. Preserve o estado atual para diagnóstico:
   `mv ~/.work-tracker/work-tracker.db ~/.work-tracker/work-tracker.db.failed`
   e mova também `work-tracker.db-wal` e `work-tracker.db-shm`, se existirem.
   Não apague esses arquivos isoladamente: o WAL pode conter dados confirmados.
3. Copie a cópia escolhida para o lugar do banco:
   `cp ~/.work-tracker/backups/work-tracker-v3-to-v4-<data>.db ~/.work-tracker/work-tracker.db`.
4. Confira a cópia antes de abrir o app:
   `sqlite3 ~/.work-tracker/work-tracker.db 'PRAGMA quick_check; SELECT value FROM meta WHERE key = "schema_version";'`.
5. Abra uma versão do Work Tracker compatível com a versão exibida. Uma versão
   mais nova aplicará de novo as migrações pendentes.

Artefatos em `~/.work-tracker/artifacts` e `~/.work-tracker/workspace` não são
alterados por migrações e não fazem parte dessa cópia.

## Adicionando uma migração

1. Acrescente um objeto ao fim de `MIGRATIONS` com a próxima versão, um nome
   descritivo e `up(d)` síncrono. Nunca edite ou reordene um passo publicado.
2. Marque `incompatible: true` quando o passo reescrever, mover ou remover
   estrutura ou dados existentes; isso gera a cópia pré-migração.
3. Atualize `SCHEMA_VERSION` e mantenha `SCHEMA_SQL`/`COLUMN_MIGRATIONS`
   descrevendo o esquema mais recente, pois bancos novos são criados a partir
   deles. Como a migração 3 cria o esquema atual em workspaces antigos, escreva
   passos que verifiquem o estado antes de transformar.
4. Use `verify(d)` para invariantes específicos do passo.
5. Cubra o passo em `src/db/migrations.test.ts` e em
   `src/test/integration/migrations.test.ts`.
