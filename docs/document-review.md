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
