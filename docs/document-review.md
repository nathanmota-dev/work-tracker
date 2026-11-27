# Revisão e versões dos documentos

Na tela Apply, cada geração concluída cria uma versão do PDF adaptado. O painel
Document review compara o texto extraído desse PDF com o PDF base daquela geração
ou com outra versão da mesma candidatura. Inclusões e remoções têm marcação e cor;
o histórico de execuções troca o documento exibido. A comparação não é visual nem
pixel a pixel.

Prepare an application em Launch abre Apply; a API genérica de agentes recusa
preenchimentos que contornariam essa revisão.

O currículo usado no preenchimento é o card selecionado na etapa Resume: o
adaptado desta candidatura, o base ou um salvo. Selecionar um card apenas escolhe;
o currículo base ou salvo passa a valer na candidatura ao clicar Fill application.

Revisar e aprovar é opcional na tela Apply. Fill application aprova a versão usada,
e a aprovação identifica o artefato e seu SHA-256; Approve this version continua
disponível no Document review de um currículo adaptado. A fila de um
[lote](preparation-batches.md) é a exceção: ela só preenche depois da aprovação. Uma geração que falha preserva os
artefatos anteriores; selecione a execução anterior para usá-los. Documentos de
execuções anteriores à funcionalidade continuam visíveis, mas precisam ser
regenerados para obter uma versão revisável e preencher novamente.

O schema v7 adiciona `document_versions` e `application_documents`. Cada versão
registra fontes originais e geradas, dados do perfil, descrição da vaga, contexto,
relatório, seleção, carta quando existente, texto dos PDFs e hash do PDF adaptado.
Os insumos ficam no snapshot da versão: editar o projeto base ou a descrição da
vaga não reescreve esses registros.

Uma versão também pode vir de um currículo salvo (variante, ver
[features-e-fluxos.md](features-e-fluxos.md#16-currículos-reaproveitáveis-variantes)).
Nesse caso não há Document review na tela Apply, a versão registra
`variant_id`, e o snapshot guarda a descrição da vaga, a variante (nome, role e
stacks), o perfil, o relatório, a seleção e as fontes com que a variante foi gerada
(nenhuma quando ela foi importada de um PDF). O PDF da candidatura é uma cópia com
os mesmos bytes e o mesmo hash do PDF da variante; regenerar a variante depois não
altera versões já aprovadas ou enviadas.

O caminho inverso também existe: aprovar uma versão **adaptada** (sem `variant_id`)
a salva em Resumes como currículo reaproveitável, para que a próxima vaga com a
mesma stack possa usá-la sem adaptar de novo
([src/variants/promote.ts](../src/variants/promote.ts)). O PDF aprovado é copiado
para `artifacts/variants/<id>/<pasta>/resume.pdf` e registrado em `pdf_artifacts`;
`resume_variants` guarda `job_id`, `application_id` e `document_version_id` (schema
v23). Nome, role e stacks são lidos da vaga sem agente
([src/variants/infer.ts](../src/variants/infer.ts)): o nome é o título; a role é a
que o título cita (Front-end, Back-end, Full stack), senão a que as tecnologias
indicam, senão a que a descrição cita, senão Other; as stacks são até seis
linguagens e frameworks da descrição, requisitos primeiro. O candidato pode editá-los
em Resumes. Há um currículo salvo por candidatura: aprovar uma versão mais nova
troca o PDF e preserva as edições; os PDFs anteriores continuam no disco. Uma falha
ao salvar não desfaz a aprovação e fica registrada no histórico. Ao abrir o app, as
candidaturas com versão adaptada aprovada e sem currículo salvo recebem o seu (a
versão aprovada mais recente), o que cobre aprovações anteriores a esta função. Um
currículo salvo de uma candidatura não é regenerado em Resumes: adapte a candidatura
de novo em Apply e aprove ou preencha com a nova versão.

O manifesto de preenchimento leva a versão aprovada, seu hash e o caminho exato do
PDF. O agente deve identificar esses mesmos valores no resultado após confirmar o
upload. Divergências ou alteração dos bytes são rejeitadas; um resultado inválido
não substitui o último preenchimento. A recuperação após reiniciar o app aplica
as mesmas verificações. Se o resultado ficou desconhecido, revise o portal antes
de tentar novamente.

O painel identifica a versão aprovada, a usada no portal e a enviada. I submitted
in the browser congela a referência do último preenchimento na mesma transação da
confirmação de envio. Cancelar um novo preenchimento, ou fechar o app durante ele,
mantém o último preenchimento bem-sucedido confirmável; um novo preenchimento que
falhou exige preencher outra vez. Registros legados já preenchidos mantêm seu fluxo de
confirmação; a migração não inventa aprovações retroativas. A aplicação nunca clica
Submit no portal.

Os testes usam PDFs e fontes genéricos, workspaces temporários e agentes/portais
sintéticos; não executam candidaturas reais.

O checklist do preenchimento no portal está descrito em [fill-review.md](fill-review.md).

## Verificações automáticas do PDF

Depois de compilar, o app confere o PDF sozinho e lista os avisos abaixo do
visualizador. Os avisos não bloqueiam a geração nem a aprovação e não alteram o
LaTeX; servem para indicar onde olhar antes de aprovar.

- **Número de páginas:** o PDF adaptado com mais páginas que o base aparece primeiro.
- **LaTeX:** um `Overfull \hbox` ou `\vbox` no log vira um aviso de conteúdo transbordando.
- **Layout**, medido pela posição das palavras (`pdftotext -bbox`):
  - página que termina num cabeçalho de seção ou de experiência cujo conteúdo
    continua na página seguinte (entrada órfã). A comparação usa onde o **texto**
    começa, depois do marcador da lista, e a margem esquerda do documento inteiro;
  - buraco no meio da página (mais de 100 pt entre linhas consecutivas);
  - página que não é a última terminando antes de 75% da altura, e última página
    mais de 35% vazia;
  - texto do corpo dentro da faixa do número de página (90 pt do rodapé);
  - página sem texto.
- **Camada de texto**, o que um ATS lê:
  - glifos de uso privado (U+E000 a U+F8FF), comuns em ícones de fontes, e o
    caractere de substituição U+FFFD;
  - e-mail e telefone cadastrados em Settings → Answers presentes como texto. A
    comparação normaliza espaços, NFC e as substituições tipográficas do LaTeX; o
    telefone também é aceito com outra formatação ou sem o código do país. Sem
    resposta cadastrada, essa parte não roda;
  - intervalos de datas ligados por travessão não ASCII (por exemplo, o U+2013 que o
    LaTeX gera de `--`), que o Workday descartou junto com a data. O aviso cita o
    ponto de código; use um hífen ASCII. Faixas de valores (`EUR 1500–2000`) não contam.

O número de páginas não é refeito pelo layout. No PDF adaptado, o app roda as mesmas
verificações também no PDF base da geração e mostra apenas o que o base não tem:
avisos que vêm do template do usuário aparecem sob Base PDF e não são atribuídos à
adaptação. Os limites foram calibrados para templates de uma coluna; um template
com margens incomuns pode gerar avisos que não se aplicam. Em texto corrido com
recuo de parágrafo (como na classe `article`), a última linha de um parágrafo no fim
da página seguida de um parágrafo recuado na próxima também é lida como entrada órfã.

Sem um `pdftotext` com suporte a `-bbox` (ou quando o Poppler 26.01 a 26.04 aborta
num PDF cujos metadados têm campos vazios, como o `hyperref` grava sem `pdftitle`),
o layout não é medido e aparece um único aviso "Layout check skipped: …". A geração
termina normalmente e a camada de texto continua verificada.
