# Fila persistente de preparação e preenchimento

Um lote prepara várias vagas em sequência com um único agente. O lote e seus
itens ficam em SQLite (`preparation_batches` e `preparation_batch_items`, schema
v8), com posição, fase, estado, tentativas, configuração (provider, modelo,
contexto comum e por vaga) e a versão das fontes usada. A criação copia as
fontes do currículo para `artifacts/batches/<lote>/sources`; todos os itens geram
a partir dessa cópia, mesmo que as fontes sejam editadas depois. O preview base
de uma versão é compilado uma vez e reutilizado; outra versão gera outro preview.

## Fases e estados dos itens

Fases: `queued → preparing → tailoring → compiling → ready_for_review →
waiting_for_fill → filling → in_review → submitted`. O estado diz o que o item
faz na fase: `pending`, `running`, `waiting_for_decision` (pedido de permissão
do agente), `waiting_for_sign_in`, `waiting_for_user` (aprovar o currículo ou
enviar o formulário), `failed`, `interrupted`, `cancelled` ou `completed`.
Pausar o lote, falhar ou cancelar nunca apaga a fase do item.

- Só um PDF aprovado em Apply passa para `waiting_for_fill`.
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
- `POST /api/preparation-batches/create`: `{ provider, model?, extra?, items:
  [{ jobId, extra? }] }` (até 50 vagas). Recusa vagas inexistentes, arquivadas,
  incompletas, já enviadas ou em outro item não concluído, com o motivo de cada uma.
- `POST /api/preparation-batches/add`: `{ batchId, items }` acrescenta ao fim.
- `POST /api/preparation-batches/pause` e `/resume`: `{ batchId }`.
- `POST /api/preparation-batches/cancel`: `{ batchId, itemId? }`.
- `POST /api/preparation-batches/retry`: `{ batchId, itemId?, reviewed? }`;
  `reviewed` só vale para um item.
- Eventos: `changed` com `table: "preparation_batches"`.

A tela Apply mostra a fila (Preparation queue) com o progresso por item e fase e
as operações acima. A seleção de vagas para criar um lote é a feature 17.
