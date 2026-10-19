# Revisão dos campos preenchidos

Depois de Fill application, a tela Apply mostra o painel Portal fill review com o
último resultado registrado do preenchimento, sem exibir JSON. Cada campo aparece
como preenchido, com a resposta usada, ou pendente, com o motivo:

- `no-stored-answer`: não há resposta salva; o link Add answer abre Answers no campo.
- `invalid-answer`: a resposta salva é inválida; o link Correct answer abre a correção.
- `ambiguous`: a pergunta corresponde a mais de uma resposta; responda no portal.
- `eeo-human-only`: pergunta demográfica; nunca é preenchida automaticamente.
- `no-match` ou outro motivo do agente: revise e responda no portal.

O painel identifica o portal, oferece Open the portal to review e mostra a versão
e o SHA-256 do PDF aprovado efetivamente usado. A página Answers aberta por um link
do checklist mostra Back to the application checklist para voltar à mesma tela.

Depois de corrigir respostas, Fill again with the approved PDF repete apenas a fase
de preenchimento com a mesma versão aprovada: o currículo não é regenerado, a
aprovação continua válida e somente `fields_filled_json` e `unfilled_json` dessa
candidatura são substituídos. Um novo preenchimento que falha mantém o resultado
anterior como evidência e o painel avisa que ele é o resultado anterior.

Marcar as pendências como concluídas no portal fecha o checklist, mas não confirma
o envio. A candidatura continua preenchida e não enviada até I submitted in the
browser; Work Tracker nunca clica Submit no portal. As marcações do checklist ficam
apenas neste dispositivo e são reiniciadas a cada novo resultado de preenchimento.

`POST /api/application-preparation/details` inclui `fill` com `items`
(`label`, `key`, `answer`, `result`, `reason`, `reasonText`, `correctionKey`),
`portal`, `portalLabel`, `reviewUrl`, `document`, `filled`, `pending`, `submitted`
e `instruction`; é `null` antes do primeiro preenchimento. Resultados antigos com
chaves em texto ou motivos desconhecidos continuam legíveis.

Os testes usam respostas e portais sintéticos, workspaces temporários e agentes
falsos; não executam candidaturas reais.
