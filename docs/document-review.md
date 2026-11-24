# Revisão e versões dos documentos

Na tela Apply, cada geração concluída cria uma versão do PDF adaptado. O painel
Document review compara o texto extraído desse PDF com o PDF base daquela geração
ou com outra versão da mesma candidatura. Inclusões e remoções têm marcação e cor;
o histórico de execuções troca o documento exibido. A comparação não é visual nem
pixel a pixel.

Prepare an application em Launch abre Apply; a API genérica de agentes recusa
preenchimentos que contornariam essa revisão.

Antes de Fill application, use Approve this version depois de revisar o PDF e o
diff. A aprovação identifica o artefato e seu SHA-256. Uma nova geração exige outra
aprovação, mesmo se o conteúdo parecer igual. Uma geração que falha preserva os
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
Nesse caso o painel mostra “From saved resume <nome>”, a versão registra
`variant_id`, e o snapshot guarda a descrição da vaga, a variante (nome, role e
stacks), o perfil, o relatório, a seleção e as fontes com que a variante foi gerada
(nenhuma quando ela foi importada de um PDF). O PDF da candidatura é uma cópia com
os mesmos bytes e o mesmo hash do PDF da variante; regenerar a variante depois não
altera versões já aprovadas ou enviadas.

O manifesto de preenchimento leva a versão aprovada, seu hash e o caminho exato do
PDF. O agente deve identificar esses mesmos valores no resultado após confirmar o
upload. Divergências ou alteração dos bytes são rejeitadas; um resultado inválido
não substitui o último preenchimento. A recuperação após reiniciar o app aplica
as mesmas verificações. Se o resultado ficou desconhecido, revise o portal antes
de tentar novamente.

O painel identifica a versão aprovada, a usada no portal e a enviada. I submitted
in the browser congela a referência do último preenchimento na mesma transação da
confirmação de envio. Registros legados já preenchidos mantêm seu fluxo de
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
