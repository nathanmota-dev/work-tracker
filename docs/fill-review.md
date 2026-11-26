# Revisão dos campos preenchidos

Depois de Fill application, a tela Apply mostra o painel Portal fill review com o
último resultado registrado do preenchimento, sem exibir JSON. Cada campo aparece
como preenchido, com a resposta usada, ou pendente, com o motivo:

- `no-stored-answer`: não há resposta salva; o link Add answer abre Answers no campo.
- `invalid-answer`: a resposta salva é inválida; o link Correct answer abre a correção.
- `ambiguous`: a pergunta corresponde a mais de uma resposta; responda no portal.
- `eeo-human-only`: pergunta demográfica; nunca é preenchida automaticamente.
- `no-evidence`: o perfil não tem informação para responder; responda no portal.
- `no-match` ou outro motivo do agente: revise e responda no portal.

## Rascunhos da IA

Perguntas que as respostas salvas não cobrem podem ser redigidas pelo agente a
partir de `fill-context.json`, gravado ao lado do manifesto com o texto do PDF
aprovado, o perfil salvo com essa versão (ou o atual, quando a versão não salvou
um) e o banco de experiências. A descrição da vaga não entra como evidência. Cada
rascunho aparece como AI draft, com o texto digitado no portal e os trechos
citados, e continua pendente até a revisão. O backend decide a classificação, não
o agente:

- `ai-draft`: todos os trechos citados estão no contexto e ao menos um tem três
  palavras ou mais.
- `ai-draft-unverified`: algum trecho não foi encontrado ou nenhum foi citado.
- `ai-draft-general`: pergunta técnica hipotética respondida com conhecimento
  geral, sem evidência do perfil.
- `ai-draft-restricted`: o texto responde a algo que só a pessoa candidata pode
  responder, como salário, autorização de trabalho, dados demográficos, termos ou
  anos de experiência; apague no portal.

A conferência das citações não prova que o texto inteiro é fiel, e a lista de
campos restritos reconhece rótulos em inglês e português. O rascunho já está no
formulário quando é conferido: leia cada um antes de enviar. Rascunhos não são
salvos como respostas reutilizáveis.

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
(`label`, `key`, `answer`, `evidence` nos rascunhos, `result`, `reason`,
`reasonText`, `correctionKey`),
`portal`, `portalLabel`, `reviewUrl`, `document`, `filled`, `pending`, `submitted`
e `instruction`; é `null` antes do primeiro preenchimento. Resultados antigos com
chaves em texto ou motivos desconhecidos continuam legíveis.

Os testes usam respostas e portais sintéticos, workspaces temporários e agentes
falsos; não executam candidaturas reais.
