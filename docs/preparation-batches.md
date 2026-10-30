# Fila persistente de preparação e preenchimento

Um lote prepara várias vagas em sequência com um único agente. O lote e seus
itens ficam em SQLite (`preparation_batches` e `preparation_batch_items`, schema
v9), com posição, fase, estado, tentativas, configuração (provider, modelo,
contexto comum e por vaga) e a versão das fontes usada. A criação copia as
fontes do currículo para `artifacts/batches/<lote>/sources`; todos os itens geram
a partir dessa cópia, mesmo que as fontes sejam editadas depois. O preview base
de uma versão é compilado uma vez e reutilizado; outra versão gera outro preview.

## Seleção e revisão em Jobs

Selecione a página ou todos os resultados filtrados, incluindo as outras páginas.
A seleção usa IDs explícitos e mantém vagas fora do filtro ou da aba atual; o
contador informa quantas estão fora do filtro. Desmarque itens ou limpe a seleção.
"Prepare selected" abre a prévia: vagas arquivadas, já enviadas, incompletas,
repetidas (ID, URL normalizada ou identidade externa) e já na fila têm motivos
explícitos de exclusão. Corrija dados incompletos nessa revisão e atualize a prévia.

Escolha agente, modelo e fontes do currículo uma vez. Cada vaga pode substituir
o contexto comum; deixar seu contexto vazio usa o comum. "Create batch" envia
somente os IDs elegíveis revisados. O backend revalida todos dentro da transação:
se algum deixou de ser elegível, nada é criado. A chave da requisição é salva em
`preparation_batch_requests`; retry com o mesmo conteúdo retorna o mesmo lote,
inclusive após reinício, e reutilizar a chave com outro conteúdo é recusado.

## Fases e estados dos itens

Fases: `queued → preparing → tailoring → compiling → ready_for_review →
waiting_for_fill → filling → in_review → submitted`. O estado diz o que o item
faz na fase: `pending`, `running`, `waiting_for_decision` (pedido de permissão
do agente), `waiting_for_sign_in`, `waiting_for_user` (aprovar o currículo ou
enviar o formulário), `failed`, `interrupted`, `cancelled` ou `completed`.
Pausar o lote, falhar ou cancelar nunca apaga a fase do item.

- Só um PDF aprovado no detalhe da candidatura passa para `waiting_for_fill`.
- Um item em `in_review` (ou um preenchimento interrompido sem resultado)
  reserva o navegador: nenhum outro preenchimento começa, nem pela fila nem por
  Apply, até a confirmação do envio em Apply ou o cancelamento do item. A geração
  dos próximos itens continua quando o agente estiver livre, sem tocar no
  formulário em revisão.
- Work Tracker nunca clica Submit. O envio é confirmado por candidatura em Apply
  (I submitted in the browser), o que conclui o item.
- Aprovar e confirmar um resultado continuam disponíveis enquanto outro item roda.

## Execução, agente compartilhado e reinício

O executor inicia um item por vez pela mesma `PreparationService` de Apply. Ele
espera enquanto Apply, Launch, um diagnóstico de integrações ou a abertura do
login usam o agente, e Launch continua recusando iniciar enquanto um item roda.
Um item aguardando decisão de permissão mantém os demais na fila com seus
estados; a decisão retoma o item, e cancelá-lo libera o agente para o próximo.
Uma recusa ao iniciar (vaga arquivada, fontes do lote alteradas) falha só aquele
item.

Ao reiniciar, execuções em andamento ficam `interrupted` e os lotes ativos ficam
pausados (`pause_reason = restart`); resultados concluídos são mantidos. Retomar
continua os itens pendentes. Repetir um item continua do checkpoint da sua
execução, sem recriar documentos nem candidaturas. Um preenchimento interrompido
sem resultado exige confirmar a revisão do portal antes de preencher de novo;
"Retry failed" do lote nunca o inclui. Não há reordenação: cancele e adicione a
vaga de novo (ela entra no fim).

## API

Todas as rotas exigem o token da API.

- `GET /api/preparation-batches`: `batches` (até 50, mais recentes primeiro, com
  `items` e `counts`), `portal` (item que reserva o navegador) e `busy`.
- `POST /api/preparation-batches/preview`: `{ items: [{ jobId }] }` retorna
  `selected`, `eligible`, `excluded` e `items` com título, empresa, elegibilidade,
  `reasons` e `missing`. Não cria lote, execução nem artefato.
- `POST /api/preparation-batches/create`: `{ requestId?, provider, model?, extra?,
  items: [{ jobId, extra? }] }`. Sem limite vinculado ao tamanho da página.
  Recusa vagas inexistentes, arquivadas, incompletas, duplicadas, já enviadas ou
  em outro item não concluído. Uma mudança após a prévia retorna erro 409.
  Use `requestId` (1–128 letras, números, `_` ou `-`) para retry idempotente;
  a interface mantém a chave ao repetir o mesmo conteúdo.
- `POST /api/preparation-batches/add`: `{ batchId, items }` acrescenta ao fim.
- `POST /api/preparation-batches/pause` e `/resume`: `{ batchId }`.
- `POST /api/preparation-batches/cancel`: `{ batchId, itemId? }`.
- `POST /api/preparation-batches/retry`: `{ batchId, itemId?, reviewed? }`;
  `reviewed` só vale para um item.
- Eventos: `changed` com `table: "preparation_batches"`.

A tela Applications mostra a fila (Preparation queue) com o progresso por item e
fase, as operações acima e o link “Review batch” para a revisão do lote; cada item
abre o detalhe da candidatura (`/apply`). Crie lotes a partir da seleção na tela
Jobs.
