# Backlog priorizado de evolução do Work Tracker

Ordem proposta para discussão, baseada no [inventário de features e fluxos](features-e-fluxos.md) e na leitura do código em 14/10/2026. Todos os itens abaixo são propostas, não entregas concluídas. A posição considera impacto na jornada, dependências e necessidade de evolução; não representa prazo nem aprovação de escopo.

**P0:** integridade e continuidade do fluxo principal. **P1:** preparação em lote e operação diária. **P2:** aprofundamento do produto. **P3:** expansão de integrações e distribuição. Dentro de cada prioridade, seguir a ordem numerada; dependências indicam pré-requisitos concretos, não obrigação de concluir todo o backlog anterior. As referências M/N/F remetem ao documento original; “complemento” identifica um acréscimo à análise. Os arquivos são pontos de partida existentes; módulos novos serão necessários conforme a feature.

## Feature 01 — Evoluir a migração e a integridade dos dados existentes

**Prioridade:** P0 · **Origem:** Complemento identificado no código

**Depende de:** Nenhuma.

**Escopo e motivo:** A inicialização já aplica alterações aditivas, mas a evolução dos estados, vínculos e classificações exige migrações explícitas e verificáveis. Versionar transformações, validar vínculos e prever cópia de segurança antes de alterações incompatíveis.

**Critério de conclusão:** Abrir um workspace antigo preserva IDs e histórico; repetir a migração não duplica dados; falha interrompe a mudança sem deixar uma migração parcial.

**Arquivos-base:** [src/db/index.ts](../src/db/index.ts), [src/db/schema.ts](../src/db/schema.ts), [src/cli/import-journey.ts](../src/cli/import-journey.ts).

## Feature 02 — Evoluir o modelo único da jornada de candidatura

**Prioridade:** P0 · **Origem:** M02, M04; F02

**Depende de:** 01.

**Escopo e motivo:** Definir a identidade da candidatura, sua origem e o vínculo com a vaga. Separar preparação, preenchimento, envio, etapa seletiva e arquivamento; definir transições compartilhadas entre UI, API, CLI e agentes.

**Critério de conclusão:** Gerar currículo não significa envio; mover um card não apaga o envio; repetir uma ação não cria outra candidatura; nova tentativa para uma republicação é uma decisão explícita.

**Arquivos-base:** [src/db/schema.ts](../src/db/schema.ts), [src/applications/types.ts](../src/applications/types.ts), [src/applications/store.ts](../src/applications/store.ts), [src/preparation/types.ts](../src/preparation/types.ts), [src/preparation/store.ts](../src/preparation/store.ts).

## Feature 03 — Evoluir a confirmação de envio para alimentar o quadro

**Prioridade:** P0 · **Origem:** M01; F02

**Depende de:** 02.

**Escopo e motivo:** Ao confirmar o envio no navegador, registrar data, etapa inicial, acompanhamento ativo e evento no mesmo registro. Hoje submitted() altera status e applied_at, enquanto o quadro exige current_stage_id.

**Critério de conclusão:** A candidatura aparece imediatamente no quadro; uma segunda confirmação retorna o estado já confirmado sem duplicar card ou evento. O envio no portal continua manual.

**Arquivos-base:** [src/preparation/service.ts](../src/preparation/service.ts), [src/applications/store.ts](../src/applications/store.ts), [web/src/routes/apply.tsx](../web/src/routes/apply.tsx), [web/src/routes/application-board.tsx](../web/src/routes/application-board.tsx).

## Feature 04 — Evoluir candidaturas manuais e reconciliar registros antigos

**Prioridade:** P0 · **Origem:** M02, M06; F04; complemento de migração

**Depende de:** 02, 03.

**Escopo e motivo:** Vincular ou criar uma vaga a partir da candidatura manual, reaproveitando cargo, empresa, URL e descrição. Revisar candidaturas antigas sem etapa ou vínculo, distinguindo applied e submitted conforme a origem; apresentar conflitos antes de associar registros.

**Critério de conclusão:** Preparar uma candidatura manual abre dados utilizáveis; registros antigos enviados entram no acompanhamento sem perder seus IDs; dados insuficientes ficam sinalizados para revisão.

**Arquivos-base:** [src/applications/store.ts](../src/applications/store.ts), [src/cli/records.ts](../src/cli/records.ts), [web/src/components/application-form.tsx](../web/src/components/application-form.tsx), [web/src/routes/applications.tsx](../web/src/routes/applications.tsx).

## Feature 05 — Evoluir a área Candidaturas e as contagens da jornada

**Prioridade:** P0 · **Origem:** M03, M05; organização das telas

**Depende de:** 03, 04.

**Escopo e motivo:** Substituir o rótulo Automatic applications por Candidaturas, identificar origem manual/agente e organizar visões de preparação, acompanhamento e arquivadas. Corrigir totais e mostrar o vínculo em Jobs.

**Critério de conclusão:** Rascunhos, preparados, preenchidos e enviados têm contagens distintas e coerentes entre lista, quadro e dashboard; cada tela oferece a próxima ação contextual.

**Arquivos-base:** [web/src/routes/workspace-pages.ts](../web/src/routes/workspace-pages.ts), [web/src/routes/navigation-items.ts](../web/src/routes/navigation-items.ts), [web/src/routes/applications.tsx](../web/src/routes/applications.tsx), [web/src/routes/jobs.tsx](../web/src/routes/jobs.tsx), [src/server/queries.ts](../src/server/queries.ts).

## Feature 06 — Criar decisões de permissão do agente na interface

**Prioridade:** P0 · **Origem:** Complemento identificado no código

**Depende de:** Nenhuma.

**Escopo e motivo:** Hoje onPermission escolhe automaticamente uma opção de autorização. Apresentar a solicitação e suas opções, aguardar a decisão, encaminhá-la ao ACP e registrar o resultado; tratar cancelamento e desconexão enquanto aguarda.

**Critério de conclusão:** Uma permissão pendente pode ser aceita ou recusada pelo usuário; a execução não avança por aprovação automática. Aprovação de ferramenta e confirmação de envio da candidatura permanecem ações distintas.

**Arquivos-base:** [src/acp/session.ts](../src/acp/session.ts), [src/acp/client.ts](../src/acp/client.ts), [src/server/index.ts](../src/server/index.ts), [web/src/lib/agent.ts](../web/src/lib/agent.ts), [web/src/components/agent-activity.tsx](../web/src/components/agent-activity.tsx).

## Feature 07 — Evoluir configuração, diagnóstico e bloqueios das integrações

**Prioridade:** P1 · **Origem:** M13, M24; F07

**Depende de:** 06.

**Escopo e motivo:** Configurar e testar MCP/ACP pela UI, validar comandos e modelos e mostrar separadamente conexão com backend, ferramentas instaladas, autenticação e disponibilidade. Explicar cada bloqueio em Apply e apontar a correção.

**Critério de conclusão:** O usuário identifica por que gerar/preencher está bloqueado e resolve pela interface; login do Chrome e sessão do LinkedIn são diagnosticados separadamente.

**Arquivos-base:** [web/src/routes/settings.tsx](../web/src/routes/settings.tsx), [web/src/components/resume-sources.tsx](../web/src/components/resume-sources.tsx), [web/src/components/browser-sign-in.tsx](../web/src/components/browser-sign-in.tsx), [src/mcp/config.ts](../src/mcp/config.ts), [src/acp/providers.ts](../src/acp/providers.ts), [src/cli/doctor.ts](../src/cli/doctor.ts).

## Feature 08 — Evoluir recuperação de execução e falhas do aplicativo

**Prioridade:** P1 · **Origem:** M12; F07; complemento de recuperação do backend

**Depende de:** 06, 07.

**Escopo e motivo:** Persistir contexto suficiente para nova tentativa por fase, preservar PDFs válidos e permitir retomar após login. Acrescentar estado recuperável quando o backend encerra: hoje o desktop registra a saída, sem um fluxo completo de recuperação.

**Critério de conclusão:** Falha de preenchimento não exige regenerar o currículo; reinício informa o que foi interrompido e permite continuar com segurança, sem repetir ações externas cujo resultado seja incerto.

**Arquivos-base:** [src/preparation/service.ts](../src/preparation/service.ts), [src/acp/session.ts](../src/acp/session.ts), [desktop/src/main.ts](../desktop/src/main.ts), [desktop/src/api-bridge.ts](../desktop/src/api-bridge.ts), [web/src/lib/preparation.ts](../web/src/lib/preparation.ts), [web/src/lib/agent.ts](../web/src/lib/agent.ts).

## Feature 09 — Criar backup e restauração do workspace

**Prioridade:** P1 · **Origem:** N29 — antecipada para proteger a evolução dos dados

**Depende de:** 01, 08.

**Escopo e motivo:** Copiar banco SQLite consistentemente, configuração e artefatos, incluindo fontes externas selecionadas ou indicando sua ausência. Permitir escolher destino, verificar integridade e restaurar com prévia de substituição; distinguir dados do app de sessões de navegador.

**Critério de conclusão:** Restaurar em um workspace isolado recupera candidaturas, vínculos e PDFs; arquivos externos ausentes são informados; a versão do backup é validada antes de substituir dados.

**Arquivos-base:** [src/db/index.ts](../src/db/index.ts), [src/db/sqlite.ts](../src/db/sqlite.ts), [src/paths.ts](../src/paths.ts), [src/preparation/sources.ts](../src/preparation/sources.ts), [web/src/routes/settings.tsx](../web/src/routes/settings.tsx).

## Feature 10 — Evoluir cadastro e edição de vagas pela interface

**Prioridade:** P1 · **Origem:** M09

**Depende de:** 02.

**Escopo e motivo:** Cadastrar e editar cargo, empresa, URL, descrição e demais dados sem agente. Definir deduplicação por ID da origem e URL normalizada; título parecido sozinho não deve unir vagas.

**Critério de conclusão:** Uma oportunidade fora do LinkedIn pode ser cadastrada e preparada; salvar de novo a mesma origem sinaliza o registro existente sem duplicá-lo.

**Arquivos-base:** [web/src/routes/jobs.tsx](../web/src/routes/jobs.tsx), [src/jobs/http.ts](../src/jobs/http.ts), [src/cli/records.ts](../src/cli/records.ts), [src/db/schema.ts](../src/db/schema.ts).

## Feature 11 — Evoluir Search com salvamento direto de oportunidades

**Prioridade:** P1 · **Origem:** M07; F01

**Depende de:** 10.

**Escopo e motivo:** Separar Salvar vaga de Avaliar compatibilidade; salvar individualmente ou selecionar vários resultados, normalizar os campos e reportar salvos, duplicados e falhos por item.

**Critério de conclusão:** Uma busca vira uma shortlist sem iniciar o agente; falha em um item preserva os demais e mantém os critérios da busca.

**Arquivos-base:** [web/src/routes/search.tsx](../web/src/routes/search.tsx), [src/jobs/http.ts](../src/jobs/http.ts), [src/mcp/search.ts](../src/mcp/search.ts).

## Feature 12 — Evoluir preservação de contexto e rascunhos

**Prioridade:** P1 · **Origem:** M11

**Depende de:** 05, 11.

**Escopo e motivo:** Preservar filtros, página, scroll, seleção e contexto adicional ao navegar. Salvar rascunhos por vaga/candidatura e definir o que sobrevive ao reinício.

**Critério de conclusão:** Abrir uma vaga, preparar e voltar mantém a posição e os filtros; um rascunho de outra vaga não substitui o contexto da atual.

**Arquivos-base:** [web/src/router.ts](../web/src/router.ts), [web/src/routes/jobs.tsx](../web/src/routes/jobs.tsx), [web/src/routes/search.tsx](../web/src/routes/search.tsx), [web/src/routes/apply.tsx](../web/src/routes/apply.tsx), [web/src/routes/launch.tsx](../web/src/routes/launch.tsx).

## Feature 13 — Evoluir respostas reutilizáveis e validação de campos

**Prioridade:** P1 · **Origem:** M22; parte de F08

**Depende de:** 02.

**Escopo e motivo:** Adicionar catálogo com nomes amigáveis, categorias, validações, exclusão e variantes por idioma, mantendo chaves avançadas. Mostrar respostas obrigatórias ausentes e preservar o tratamento manual de campos demográficos.

**Critério de conclusão:** O usuário mantém links, identidade e elegibilidade sem conhecer chaves internas; resposta ambígua ou ausente fica pendente em vez de ser inventada.

**Arquivos-base:** [web/src/routes/answers.tsx](../web/src/routes/answers.tsx), [src/server/index.ts](../src/server/index.ts), [src/match/matcher.ts](../src/match/matcher.ts), [src/match/synonyms.ts](../src/match/synonyms.ts).

## Feature 14 — Evoluir revisão e versionamento dos documentos

**Prioridade:** P1 · **Origem:** M14; F09

**Depende de:** 02, 08.

**Escopo e motivo:** Comparar texto e PDFs, destacar mudanças, aprovar uma versão e registrar fontes, descrição e dados usados. Identificar o PDF efetivamente usado no portal e congelar a referência do envio.

**Critério de conclusão:** Regenerar ou alterar o currículo base não muda documentos de candidaturas já enviadas; o PDF aprovado coincide com o usado no preenchimento.

**Arquivos-base:** [web/src/routes/apply.tsx](../web/src/routes/apply.tsx), [web/src/components/pdf-viewer.tsx](../web/src/components/pdf-viewer.tsx), [src/preparation/service.ts](../src/preparation/service.ts), [src/preparation/store.ts](../src/preparation/store.ts), [src/preparation/sources.ts](../src/preparation/sources.ts).

## Feature 15 — Evoluir revisão dos campos preenchidos e pendentes

**Prioridade:** P1 · **Origem:** M15

**Depende de:** 13, 14.

**Escopo e motivo:** Transformar fields_filled_json e unfilled_json em checklist legível com motivo da pendência, resposta utilizada e link para correção. Mostrar portal, documento escolhido e instrução de revisão final.

**Critério de conclusão:** O usuário termina o formulário sem ler JSON; corrigir uma resposta permite tentar novamente a fase necessária; preenchido continua distinto de enviado.

**Arquivos-base:** [web/src/routes/apply.tsx](../web/src/routes/apply.tsx), [src/preparation/service.ts](../src/preparation/service.ts), [src/preparation/types.ts](../src/preparation/types.ts), [src/adapters/registry.ts](../src/adapters/registry.ts).

## Feature 16 — Criar fila persistente de preparação de candidaturas

**Prioridade:** P1 · **Origem:** N01; F03; especificação de lote

**Depende de:** 02, 06, 08, 14.

**Escopo e motivo:** Persistir lote e itens com posição, fase, configuração e versão das fontes. Executar sequencialmente, coordenar o agente compartilhado com Launch e permitir pausa, cancelamento, reordenação e repetição dos itens falhos. Reutilizar preview válido das mesmas fontes.

**Critério de conclusão:** Reiniciar preserva o lote; um erro não perde os outros resultados; pausar não apaga a fase; continuar não recria documentos ou candidaturas já concluídos.

**Arquivos-base:** [src/preparation/service.ts](../src/preparation/service.ts), [src/preparation/store.ts](../src/preparation/store.ts), [src/preparation/types.ts](../src/preparation/types.ts), [src/acp/session.ts](../src/acp/session.ts), [src/db/schema.ts](../src/db/schema.ts).

## Feature 17 — Criar seleção múltipla para preparar vagas em lote

**Prioridade:** P1 · **Origem:** M08; F03

**Depende de:** 11, 12, 16.

**Escopo e motivo:** Oferecer seleção da página e de todos os resultados filtrados com contador explícito. Revisar elegibilidade, excluir duplicadas/arquivadas/já enviadas e configurar provider, modelo e contexto comum ou por vaga antes de criar o lote.

**Critério de conclusão:** Selecionar cinco vagas cria cinco itens válidos com prévia; mudar página não perde seleção; a ação informa itens excluídos e seus motivos.

**Arquivos-base:** [web/src/routes/jobs.tsx](../web/src/routes/jobs.tsx), [web/src/routes/search.tsx](../web/src/routes/search.tsx), [web/src/routes/apply.tsx](../web/src/routes/apply.tsx), [web/src/components/workspace-ui.tsx](../web/src/components/workspace-ui.tsx).

## Feature 18 — Criar fila de preenchimento dos portais

**Prioridade:** P1 · **Origem:** Parte de N01 e F03

**Depende de:** 15, 16, 17.

**Escopo e motivo:** Encaminhar apenas versões aprovadas para preenchimento, com um portal ativo por vez inicialmente. Separar fila de geração da fila de preenchimento e reservar o navegador enquanto houver formulário aguardando revisão.

**Critério de conclusão:** Revisar um PDF não bloqueia a preparação seguinte quando o agente estiver disponível; nenhuma tarefa sobrescreve um formulário aguardando o usuário; envio é confirmado por candidatura.

**Arquivos-base:** [src/preparation/service.ts](../src/preparation/service.ts), [src/acp/session.ts](../src/acp/session.ts), [src/adapters/registry.ts](../src/adapters/registry.ts), [web/src/routes/apply.tsx](../web/src/routes/apply.tsx).

## Feature 19 — Criar central de revisão das candidaturas

**Prioridade:** P1 · **Origem:** N02

**Depende de:** 05, 14, 15, 18.

**Escopo e motivo:** Reunir currículos prontos, ajustes solicitados, campos pendentes e envios a confirmar. Mostrar resultado por item e resumo do lote, com acesso direto à revisão e retomada das pendências.

**Critério de conclusão:** Um lote pode ser percorrido sem procurar cada vaga em outra tela; totais distinguem preparado, preenchido, enviado, falho, cancelado e pendente.

**Arquivos-base:** [web/src/routes/applications.tsx](../web/src/routes/applications.tsx), [web/src/routes/apply.tsx](../web/src/routes/apply.tsx), [src/server/queries.ts](../src/server/queries.ts).

## Feature 20 — Criar assistente inicial de configuração

**Prioridade:** P1 · **Origem:** N07

**Depende de:** 07, 10, 13, 19.

**Escopo e motivo:** Guiar identidade, fontes do currículo, ferramentas, integrações e primeira vaga até a revisão. Permitir pular integrações opcionais e voltar ao ponto interrompido.

**Critério de conclusão:** Uma instalação nova mostra os requisitos reais e permite completar uma primeira preparação; quem só quer acompanhamento manual consegue iniciar sem configurar um agente.

**Arquivos-base:** [web/src/routes/settings.tsx](../web/src/routes/settings.tsx), [web/src/components/settings-profile.tsx](../web/src/components/settings-profile.tsx), [web/src/components/resume-sources.tsx](../web/src/components/resume-sources.tsx), [src/cli/init.ts](../src/cli/init.ts), [src/cli/setup.ts](../src/cli/setup.ts).

## Feature 21 — Evoluir classificação de cargos e remuneração

**Prioridade:** P1 · **Origem:** M18; base adicional para filtros, ranking e propostas

**Depende de:** 01, 10.

**Escopo e motivo:** Ampliar os três tipos atuais para especialidades personalizáveis. Estruturar faixa salarial, moeda, periodicidade, regime e senioridade, mantendo o texto original e sem converter valores desconhecidos arbitrariamente.

**Critério de conclusão:** Mobile, dados, QA e outros cargos podem ser classificados; dados existentes são preservados; valores anuais e mensais não são comparados como equivalentes.

**Arquivos-base:** [src/db/schema.ts](../src/db/schema.ts), [src/applications/types.ts](../src/applications/types.ts), [src/applications/store.ts](../src/applications/store.ts), [web/src/components/application-form.tsx](../web/src/components/application-form.tsx).

## Feature 22 — Evoluir filtros, ordenação e consultas para maior volume

**Prioridade:** P1 · **Origem:** M10; otimizações de consultas e atualização

**Depende de:** 05, 12, 21.

**Escopo e motivo:** Filtrar por empresa, score disponível, remuneração, modalidade, senioridade, origem, data e estado. Implementar ordenação e paginação no backend, persistir preferências e atualizar apenas áreas afetadas pelos eventos.

**Critério de conclusão:** Filtros consultam todos os registros, não só a página atual; a seleção total respeita o filtro; eventos do agente não recarregam todas as listas indiscriminadamente.

**Arquivos-base:** [src/server/queries.ts](../src/server/queries.ts), [src/server/index.ts](../src/server/index.ts), [src/db/notify.ts](../src/db/notify.ts), [web/src/lib/api.ts](../web/src/lib/api.ts), [web/src/components/workspace-ui.tsx](../web/src/components/workspace-ui.tsx), [web/src/routes/jobs.tsx](../web/src/routes/jobs.tsx).

## Feature 23 — Evoluir histórico completo e rastreabilidade das atividades

**Prioridade:** P1 · **Origem:** M25 — antecipada como base do acompanhamento

**Depende de:** 02, 22.

**Escopo e motivo:** Substituir o limite fixo de 50 eventos por paginação real; filtrar por período e entidade, abrir detalhes e navegar para vaga, candidatura, contato ou execução. Registrar transições relevantes com origem.

**Critério de conclusão:** Um evento antigo continua acessível; histórico da candidatura permite reconstruir envio, mudanças de etapa e reaberturas, inclusive ações feitas pela CLI.

**Arquivos-base:** [src/server/queries.ts](../src/server/queries.ts), [src/db/schema.ts](../src/db/schema.ts), [web/src/routes/activity.tsx](../web/src/routes/activity.tsx), [src/preparation/store.ts](../src/preparation/store.ts).

## Feature 24 — Evoluir o detalhe unificado da candidatura

**Prioridade:** P1 · **Origem:** M17; F02, F09

**Depende de:** 05, 14, 23.

**Escopo e motivo:** Reunir vaga, dados do processo, versão enviada, documentos, notas e histórico; oferecer ações contextuais. Preparar vínculos e áreas para contatos, entrevistas e tarefas, preenchidas pelas features seguintes.

**Critério de conclusão:** Abrir um card mostra o contexto e permite continuar a jornada sem recadastro; áreas ainda sem registros têm ação clara de inclusão quando disponível.

**Arquivos-base:** [web/src/components/application-details.tsx](../web/src/components/application-details.tsx), [web/src/routes/application-board.tsx](../web/src/routes/application-board.tsx), [src/applications/store.ts](../src/applications/store.ts), [src/server/queries.ts](../src/server/queries.ts).

## Feature 25 — Evoluir gestão visual de entrevistas

**Prioridade:** P1 · **Origem:** M19; F05

**Depende de:** 24.

**Escopo e motivo:** Criar, editar, remarcar, cancelar e concluir entrevistas; vincular à candidatura, além da vaga. Guardar fuso, participantes, link e resultado; sugerir mudança de etapa sem aplicá-la implicitamente.

**Critério de conclusão:** Remarcar atualiza o próximo evento e o detalhe do processo; o horário é consistente no fuso escolhido; cancelar não exclui o histórico.

**Arquivos-base:** [web/src/routes/interviews.tsx](../web/src/routes/interviews.tsx), [src/db/schema.ts](../src/db/schema.ts), [src/server/queries.ts](../src/server/queries.ts), [src/server/index.ts](../src/server/index.ts).

## Feature 26 — Criar central de tarefas, prazos e lembretes

**Prioridade:** P1 · **Origem:** N06

**Depende de:** 23, 24, 25.

**Escopo e motivo:** Reunir revisões, follow-ups, entrevistas e tarefas manuais com data, estado e vínculo. Permitir adiar/concluir, configurar notificações e tratar vencimentos ocorridos com o app fechado, exibindo-os ao reabrir.

**Critério de conclusão:** Cada pendência abre o registro correto; concluir não gera um novo lembrete duplicado; o produto informa que notificações com app encerrado exigem execução em segundo plano, caso oferecida.

**Arquivos-base:** [src/db/schema.ts](../src/db/schema.ts), [src/outreach/store.ts](../src/outreach/store.ts), [web/src/routes/dashboard.tsx](../web/src/routes/dashboard.tsx), [desktop/src/main.ts](../desktop/src/main.ts).

## Feature 27 — Evoluir o dashboard para orientar a próxima ação

**Prioridade:** P1 · **Origem:** M05; evolução da visão geral

**Depende de:** 19, 25, 26.

**Escopo e motivo:** Destacar o que revisar hoje, prazos vencidos, próximas entrevistas, lotes e processos sem próxima ação, além das contagens corretas.

**Critério de conclusão:** O usuário consegue iniciar uma ação relevante diretamente no dashboard; os totais e pendências correspondem às demais telas.

**Arquivos-base:** [web/src/routes/dashboard.tsx](../web/src/routes/dashboard.tsx), [web/src/components/dashboard-overview.tsx](../web/src/components/dashboard-overview.tsx), [src/server/queries.ts](../src/server/queries.ts).

## Feature 28 — Evoluir encerramento e reabertura de processos

**Prioridade:** P1 · **Origem:** F10

**Depende de:** 24, 26.

**Escopo e motivo:** Registrar resultado e data, tratar tarefas pendentes e oferecer arquivamento separado da vaga. Preservar documentos, entrevistas e contatos; reabrir acrescenta evento sem apagar o encerramento anterior.

**Critério de conclusão:** Encerrar interrompe lembretes incompatíveis com o resultado; reabrir mantém a história e permite definir uma nova próxima ação.

**Arquivos-base:** [src/applications/store.ts](../src/applications/store.ts), [web/src/components/application-archive.tsx](../web/src/components/application-archive.tsx), [src/jobs/http.ts](../src/jobs/http.ts).

## Feature 29 — Evoluir contatos, recrutadores e revisão de outreach

**Prioridade:** P1 · **Origem:** M20; F06; complemento de salvamento de pessoas

**Depende de:** 06, 23, 24, 26.

**Escopo e motivo:** Cadastrar/editar contatos, salvar pessoas encontradas em Search e vincular a vaga, candidatura e empresa. Reunir histórico, sincronização de conexões e rascunhos revisáveis; abrir a ação com contexto preenchido.

**Critério de conclusão:** Um contato encontrado na busca pode ser salvo sem recadastro; um follow-up mostra destinatário, contexto e texto para revisão; resultado e próxima ação ficam vinculados ao contato.

**Arquivos-base:** [web/src/routes/recruiters.tsx](../web/src/routes/recruiters.tsx), [web/src/routes/outreach.tsx](../web/src/routes/outreach.tsx), [web/src/routes/search.tsx](../web/src/routes/search.tsx), [src/recruiter/sync.ts](../src/recruiter/sync.ts), [src/outreach/store.ts](../src/outreach/store.ts), [src/cli/recruiter.ts](../src/cli/recruiter.ts).

## Feature 30 — Evoluir orçamento de InMail e regras de cadência

**Prioridade:** P1 · **Origem:** M21

**Depende de:** 29.

**Escopo e motivo:** Editar saldo, reserva, ciclo e regras de follow-up/cooldown pela interface, com prévia do impacto nas ações previstas.

**Critério de conclusão:** Alterar a reserva recalcula as ações elegíveis; limites por empresa e estados de não contatar continuam respeitados; ajustes ficam rastreáveis.

**Arquivos-base:** [web/src/routes/outreach.tsx](../web/src/routes/outreach.tsx), [src/outreach/core.ts](../src/outreach/core.ts), [src/outreach/store.ts](../src/outreach/store.ts), [src/cli/outreach.ts](../src/cli/outreach.ts).

## Feature 31 — Evoluir a interação contínua com o agente

**Prioridade:** P1 · **Origem:** M23

**Depende de:** 06, 08, 16.

**Escopo e motivo:** Adicionar respostas durante a conversa, perguntas estruturadas e histórico persistente, respeitando as capacidades do provider. Coordenar a conversa com filas e indicar quando a sessão está ocupada.

**Critério de conclusão:** A captura de experiências consegue fazer perguntas e receber respostas no app; permissão de ferramenta e resposta conversacional têm controles próprios; sair da tela não perde a conversa.

**Arquivos-base:** [src/acp/client.ts](../src/acp/client.ts), [src/acp/session.ts](../src/acp/session.ts), [web/src/lib/agent.ts](../web/src/lib/agent.ts), [web/src/routes/launch.tsx](../web/src/routes/launch.tsx), [web/src/components/agent-conversation.tsx](../web/src/components/agent-conversation.tsx).

## Feature 32 — Evoluir a fonte de verdade do perfil do candidato

**Prioridade:** P1 · **Origem:** F08

**Depende de:** 13, 14, 31.

**Escopo e motivo:** Reunir identidade, links, elegibilidade e fontes profissionais; explicitar origem e precedência entre respostas, dados do currículo e perfil sincronizado. Revisar conflitos e propagar alterações aos próximos fluxos.

**Critério de conclusão:** Editar um e-mail não deixa valores divergentes usados silenciosamente pelos fluxos; snapshots de candidaturas enviadas continuam imutáveis.

**Arquivos-base:** [web/src/components/settings-profile.tsx](../web/src/components/settings-profile.tsx), [web/src/lib/candidate-profile.ts](../web/src/lib/candidate-profile.ts), [src/paths.ts](../src/paths.ts), [src/preparation/sources.ts](../src/preparation/sources.ts), [src/db/schema.ts](../src/db/schema.ts).

## Feature 33 — Criar perfis de busca e preferências profissionais

**Prioridade:** P2 · **Origem:** N31 — antes do ranking para evitar dependência circular

**Depende de:** 21, 32.

**Escopo e motivo:** Salvar objetivos por cargo, faixa salarial, moeda, país, regime, idioma e modalidade. Escolher perfil ativo em Search e na avaliação por agente.

**Critério de conclusão:** Trocar o perfil altera os critérios das próximas buscas e avaliações; preferências não exigem que o ranking já exista.

**Arquivos-base:** [src/paths.ts](../src/paths.ts), [src/db/schema.ts](../src/db/schema.ts), [web/src/routes/search.tsx](../web/src/routes/search.tsx), [web/src/routes/settings.tsx](../web/src/routes/settings.tsx), [src/acp/session.ts](../src/acp/session.ts).

## Feature 34 — Criar buscas salvas

**Prioridade:** P2 · **Origem:** N05

**Depende de:** 11, 12, 33.

**Escopo e motivo:** Salvar critérios com nome, editar, repetir e comparar resultados com a execução anterior, identificando novidades e itens já salvos.

**Critério de conclusão:** Reexecutar uma busca reutiliza seus parâmetros e informa novas vagas sem duplicar as já existentes.

**Arquivos-base:** [web/src/routes/search.tsx](../web/src/routes/search.tsx), [src/mcp/search.ts](../src/mcp/search.ts), [src/db/schema.ts](../src/db/schema.ts).

## Feature 35 — Evoluir avaliação de compatibilidade e score do currículo

**Prioridade:** P2 · **Origem:** M16

**Depende de:** 14, 21, 32.

**Escopo e motivo:** Definir avaliação estruturada com requisitos atendidos, lacunas e evidências, vinculada à versão do currículo e da descrição. Distinguir compatibilidade da vaga de cobertura de palavras-chave; o matcher de formulários existente não calcula esse score.

**Critério de conclusão:** Cada score mostra critérios e versão avaliada; ausência de avaliação aparece como não avaliado; nota não é apresentada como probabilidade de contratação.

**Arquivos-base:** [src/preparation/service.ts](../src/preparation/service.ts), [src/db/schema.ts](../src/db/schema.ts), [web/src/routes/apply.tsx](../web/src/routes/apply.tsx), [web/src/routes/applications.tsx](../web/src/routes/applications.tsx).

## Feature 36 — Criar ranking explicável de oportunidades

**Prioridade:** P2 · **Origem:** N09

**Depende de:** 21, 33, 35.

**Escopo e motivo:** Priorizar por compatibilidade, preferências, remuneração, localização e prazo, mostrando pesos, motivos e dados ausentes. Permitir ajustar a prioridade manualmente.

**Critério de conclusão:** O usuário consegue explicar por que uma vaga ficou acima de outra; falta de salário não se transforma em um valor inventado.

**Arquivos-base:** [web/src/routes/jobs.tsx](../web/src/routes/jobs.tsx), [src/server/queries.ts](../src/server/queries.ts), [src/db/schema.ts](../src/db/schema.ts).

## Feature 37 — Criar comparação de vagas

**Prioridade:** P2 · **Origem:** N10

**Depende de:** 17, 21, 22, 35.

**Escopo e motivo:** Selecionar oportunidades e comparar requisitos, salário, modalidade, lacunas e estado da candidatura lado a lado.

**Critério de conclusão:** A comparação preserva unidades e moeda e evidencia informação ausente; cada vaga mantém acesso à sua próxima ação.

**Arquivos-base:** [web/src/routes/jobs.tsx](../web/src/routes/jobs.tsx), [src/server/queries.ts](../src/server/queries.ts).

## Feature 38 — Criar tags, favoritos e listas pessoais

**Prioridade:** P2 · **Origem:** N32

**Depende de:** 10, 22, 29.

**Escopo e motivo:** Organizar vagas e contatos por campanha, tema e prioridade com tags e listas reutilizáveis, independentes do estado seletivo.

**Critério de conclusão:** Uma vaga pode estar em duas listas sem duplicação; favoritar não altera status; filtros aceitam as classificações pessoais.

**Arquivos-base:** [src/db/schema.ts](../src/db/schema.ts), [web/src/routes/jobs.tsx](../web/src/routes/jobs.tsx), [web/src/routes/recruiters.tsx](../web/src/routes/recruiters.tsx).

## Feature 39 — Criar workspace por empresa

**Prioridade:** P2 · **Origem:** N11

**Depende de:** 21, 24, 25, 29.

**Escopo e motivo:** Normalizar a identidade da empresa e reunir vagas, candidaturas, contatos, entrevistas e notas. Oferecer revisão de nomes alternativos sem unir empresas distintas automaticamente.

**Critério de conclusão:** Vagas e contatos da mesma empresa aparecem juntos; corrigir o vínculo não apaga histórico nem altera indevidamente cooldowns baseados no URN.

**Arquivos-base:** [src/db/schema.ts](../src/db/schema.ts), [src/server/queries.ts](../src/server/queries.ts), [web/src/router.ts](../web/src/router.ts).

## Feature 40 — Criar importação e exportação de dados pela interface

**Prioridade:** P2 · **Origem:** N04

**Depende de:** 09, 21, 23, 39.

**Escopo e motivo:** Importar CSV/JSON com mapeamento de campos e prévia de conflitos; exportar registros e histórico em formato documentado. Reaproveitar a importação explícita já existente, distinguindo exportação de dados, backup e exportação de PDF.

**Critério de conclusão:** A prévia informa criar, atualizar, ignorar e rejeitar por registro; repetir importação não duplica dados; a exportação mantém IDs e vínculos necessários para interpretação.

**Arquivos-base:** [src/cli/import-journey.ts](../src/cli/import-journey.ts), [src/cli/records.ts](../src/cli/records.ts), [src/db/schema.ts](../src/db/schema.ts), [web/src/routes/settings.tsx](../web/src/routes/settings.tsx).

## Feature 41 — Criar captura de oportunidade por URL

**Prioridade:** P2 · **Origem:** N03

**Depende de:** 07, 10, 39.

**Escopo e motivo:** Extrair dados de uma URL e apresentar revisão antes de salvar, mantendo origem e descrição. Quando a extração não for possível, aceitar preenchimento manual.

**Critério de conclusão:** Uma URL de portal suportado vira vaga revisável; falha de login ou página incompatível não impede cadastrar os dados manualmente.

**Arquivos-base:** [src/jobs/http.ts](../src/jobs/http.ts), [src/mcp/chrome.ts](../src/mcp/chrome.ts), [src/mcp/search.ts](../src/mcp/search.ts), [web/src/routes/jobs.tsx](../web/src/routes/jobs.tsx).

## Feature 42 — Criar monitoramento agendado de oportunidades

**Prioridade:** P2 · **Origem:** N08

**Depende de:** 08, 26, 34.

**Escopo e motivo:** Executar buscas salvas em horários escolhidos, deduplicar novidades e formar shortlist. Coordenar com as filas, tratar autenticação pendente e definir execução com app aberto ou serviço em segundo plano explicitamente habilitado.

**Critério de conclusão:** Um horário perdido com app fechado aparece ao reabrir; execução repetida não duplica vagas; login pendente pausa a busca e gera uma ação para o usuário.

**Arquivos-base:** [src/mcp/search.ts](../src/mcp/search.ts), [src/acp/session.ts](../src/acp/session.ts), [src/db/schema.ts](../src/db/schema.ts), [desktop/src/main.ts](../desktop/src/main.ts).

## Feature 43 — Criar histórico das descrições das vagas

**Prioridade:** P2 · **Origem:** N16

**Depende de:** 14, 41, 42.

**Escopo e motivo:** Guardar snapshots a cada atualização relevante e destacar mudanças de requisitos, remuneração e disponibilidade; manter a versão usada na candidatura.

**Critério de conclusão:** Atualizar a vaga não reescreve o contexto de uma preparação anterior; o usuário compara o texto original com o atual.

**Arquivos-base:** [src/db/schema.ts](../src/db/schema.ts), [src/jobs/http.ts](../src/jobs/http.ts), [src/preparation/store.ts](../src/preparation/store.ts).

## Feature 44 — Criar detecção de vagas encerradas e republicadas

**Prioridade:** P2 · **Origem:** N17

**Depende de:** 41, 42, 43.

**Escopo e motivo:** Detectar sinais de indisponibilidade e possíveis republicações; separar erro temporário/login de encerramento e pedir revisão de associações incertas.

**Critério de conclusão:** Uma falha de consulta não arquiva a vaga; republicação pode ser vinculada ao histórico e originar nova candidatura por escolha do usuário.

**Arquivos-base:** [src/jobs/http.ts](../src/jobs/http.ts), [src/db/schema.ts](../src/db/schema.ts), [web/src/routes/jobs.tsx](../web/src/routes/jobs.tsx).

## Feature 45 — Criar biblioteca de currículos base

**Prioridade:** P2 · **Origem:** N12

**Depende de:** 14, 32.

**Escopo e motivo:** Manter múltiplos projetos por idioma, especialidade e objetivo, com preview e histórico de versões; selecionar por candidatura e por lote.

**Critério de conclusão:** Trocar o currículo padrão não modifica um lote já iniciado; cada item identifica exatamente qual base utilizou.

**Arquivos-base:** [src/preparation/sources.ts](../src/preparation/sources.ts), [src/preparation/types.ts](../src/preparation/types.ts), [web/src/components/resume-sources.tsx](../web/src/components/resume-sources.tsx), [web/src/routes/apply.tsx](../web/src/routes/apply.tsx).

## Feature 46 — Criar montagem guiada do primeiro currículo

**Prioridade:** P2 · **Origem:** Complemento identificado nas fontes e exemplos locais

**Depende de:** 20, 32, 45.

**Escopo e motivo:** Oferecer cópia guiada de um template e edição dos dados básicos com preview, mantendo acesso ao projeto LaTeX avançado. Explicar dependências e evitar exigir que o usuário prepare pastas e arquivos manualmente para começar.

**Critério de conclusão:** Um usuário sem projeto próprio cria uma base válida a partir de dados reais; conteúdo de exemplo não é enviado como se fosse experiência do candidato.

**Arquivos-base:** [base/latex/resume.example.tex](../base/latex/resume.example.tex), [base/data/resume-data.example.ts](../base/data/resume-data.example.ts), [src/preparation/sources.ts](../src/preparation/sources.ts), [web/src/components/resume-sources.tsx](../web/src/components/resume-sources.tsx).

## Feature 47 — Criar banco visual de experiências

**Prioridade:** P2 · **Origem:** N14

**Depende de:** 31, 32.

**Escopo e motivo:** Cadastrar e editar resultados, projetos, tecnologias, evidências e tags; importar/revisar o material produzido pela skill. Manter rastreabilidade da fonte e aprovação das sugestões.

**Critério de conclusão:** Uma experiência capturada em conversa aparece para revisão e pode ser reutilizada nas adaptações sem duplicar entradas existentes.

**Arquivos-base:** [resources/skills/work-tracker-experience-bank/SKILL.md](../resources/skills/work-tracker-experience-bank/SKILL.md), [src/paths.ts](../src/paths.ts), [web/src/routes/profile.tsx](../web/src/routes/profile.tsx).

## Feature 48 — Criar editor de cartas e respostas discursivas

**Prioridade:** P2 · **Origem:** N13

**Depende de:** 13, 14, 45.

**Escopo e motivo:** Exibir e editar cartas já produzidas, criar modelos de respostas longas por idioma e manter versões por candidatura.

**Critério de conclusão:** O usuário revisa e identifica qual carta/resposta foi usada; alterar um modelo não altera um envio anterior.

**Arquivos-base:** [src/preparation/service.ts](../src/preparation/service.ts), [src/preparation/types.ts](../src/preparation/types.ts), [web/src/routes/apply.tsx](../web/src/routes/apply.tsx).

## Feature 49 — Criar feedback reutilizável sobre adaptações do currículo

**Prioridade:** P2 · **Origem:** N15

**Depende de:** 14, 35, 47.

**Escopo e motivo:** Registrar trechos aprovados/rejeitados, justificativas e preferências de apresentação; oferecer esse contexto em novas adaptações, distinguindo preferência de evidência profissional.

**Critério de conclusão:** Uma correção pode orientar a próxima geração; o histórico mostra sua origem e não transforma um comentário em experiência inventada.

**Arquivos-base:** [src/preparation/service.ts](../src/preparation/service.ts), [src/preparation/store.ts](../src/preparation/store.ts), [web/src/routes/apply.tsx](../web/src/routes/apply.tsx).

## Feature 50 — Evoluir auditoria e plano de melhoria do perfil

**Prioridade:** P2 · **Origem:** M27

**Depende de:** 26, 32, 47.

**Escopo e motivo:** Converter recomendações em ações acompanháveis, com evidências, antes/depois e comparação entre auditorias.

**Critério de conclusão:** Marcar uma recomendação como executada preserva a avaliação original e permite verificar sua evolução em uma nova auditoria.

**Arquivos-base:** [web/src/routes/profile.tsx](../web/src/routes/profile.tsx), [src/server/queries.ts](../src/server/queries.ts), [resources/skills/work-tracker-profile-optimizer/SKILL.md](../resources/skills/work-tracker-profile-optimizer/SKILL.md).

## Feature 51 — Criar agenda visual e integração opcional com calendário

**Prioridade:** P2 · **Origem:** N18

**Depende de:** 25, 26.

**Escopo e motivo:** Oferecer visões semanal/mensal e exportação ICS; depois conectar calendário externo com identificação estável do evento, revisão de conflitos e política de sincronização.

**Critério de conclusão:** Exportar ou sincronizar novamente não duplica entrevistas; remarcação mantém fuso e vínculo; a agenda local funciona sem conector externo.

**Arquivos-base:** [web/src/routes/interviews.tsx](../web/src/routes/interviews.tsx), [src/db/schema.ts](../src/db/schema.ts), [web/src/routes/settings.tsx](../web/src/routes/settings.tsx).

## Feature 52 — Criar preparação para entrevistas

**Prioridade:** P2 · **Origem:** N19

**Depende de:** 25, 39, 47.

**Escopo e motivo:** Gerar briefing da vaga/empresa, perguntas prováveis, experiências relevantes e checklist a partir dos registros existentes.

**Critério de conclusão:** A entrevista abre seu material de preparação e fontes; informações desconhecidas sobre a empresa ficam identificadas como pendentes de pesquisa.

**Arquivos-base:** [web/src/routes/interviews.tsx](../web/src/routes/interviews.tsx), [web/src/components/application-details.tsx](../web/src/components/application-details.tsx), [src/acp/session.ts](../src/acp/session.ts).

## Feature 53 — Criar simulação de entrevistas

**Prioridade:** P2 · **Origem:** N20

**Depende de:** 31, 52.

**Escopo e motivo:** Conduzir prática interativa, registrar respostas, oferecer feedback e plano de estudo ligado à oportunidade.

**Critério de conclusão:** É possível concluir e retomar uma sessão de prática com histórico; sugestões de estudo podem virar tarefas.

**Arquivos-base:** [web/src/components/agent-conversation.tsx](../web/src/components/agent-conversation.tsx), [src/acp/session.ts](../src/acp/session.ts), [web/src/routes/interviews.tsx](../web/src/routes/interviews.tsx).

## Feature 54 — Criar gestão de testes técnicos

**Prioridade:** P2 · **Origem:** N21

**Depende de:** 24, 26.

**Escopo e motivo:** Usar a categoria assessment existente para reunir enunciado, prazo, repositório, anexos, checklist, entrega e resultado.

**Critério de conclusão:** Um teste tem prazo e próxima ação visíveis; registrar entrega preserva os arquivos e não marca aprovação automaticamente.

**Arquivos-base:** [src/applications/types.ts](../src/applications/types.ts), [src/db/schema.ts](../src/db/schema.ts), [web/src/components/application-details.tsx](../web/src/components/application-details.tsx), [web/src/components/application-stages.tsx](../web/src/components/application-stages.tsx).

## Feature 55 — Criar gestão e comparação de propostas

**Prioridade:** P2 · **Origem:** N22

**Depende de:** 21, 24, 26.

**Escopo e motivo:** Registrar salário, moeda, periodicidade, benefícios, regime, condições, negociação e prazo de resposta; comparar propostas sem ocultar diferenças de unidade.

**Critério de conclusão:** Duas propostas podem ser comparadas com premissas explícitas; aceitar/recusar registra resultado e mantém o histórico da negociação.

**Arquivos-base:** [src/db/schema.ts](../src/db/schema.ts), [web/src/components/application-details.tsx](../web/src/components/application-details.tsx), [src/applications/store.ts](../src/applications/store.ts).

## Feature 56 — Criar metas e análises do funil

**Prioridade:** P2 · **Origem:** N23

**Depende de:** 05, 23, 28.

**Escopo e motivo:** Medir metas semanais, conversões, tempo por etapa e resultados por empresa/origem, separando preparação de envio. Explicitar períodos e limitações de registros antigos sem datas.

**Critério de conclusão:** Um rascunho não conta como candidatura enviada; reabertura não duplica envio; tempo por etapa é calculado a partir dos eventos disponíveis.

**Arquivos-base:** [src/server/queries.ts](../src/server/queries.ts), [web/src/routes/dashboard.tsx](../web/src/routes/dashboard.tsx), [web/src/components/metric-chart.tsx](../web/src/components/metric-chart.tsx).

## Feature 57 — Criar análise de gargalos e sugestão de próxima ação

**Prioridade:** P2 · **Origem:** N24

**Depende de:** 26, 56.

**Escopo e motivo:** Destacar processos parados, prazos próximos e etapas com maior espera; explicar critérios e permitir adiar ou dispensar sugestões.

**Critério de conclusão:** Cada alerta mostra o período e os eventos que o motivaram; processos encerrados não aparecem como follow-ups pendentes.

**Arquivos-base:** [src/server/queries.ts](../src/server/queries.ts), [web/src/routes/dashboard.tsx](../web/src/routes/dashboard.tsx).

## Feature 58 — Evoluir a paleta para busca global e ações contextuais

**Prioridade:** P2 · **Origem:** M26

**Depende de:** 22, 24, 29, 39.

**Escopo e motivo:** Buscar vagas, candidaturas, empresas e contatos, além de páginas; oferecer ações pertinentes ao registro encontrado.

**Critério de conclusão:** Ctrl+K encontra uma candidatura pelo cargo ou empresa e abre seu detalhe sem perder o contexto de origem.

**Arquivos-base:** [web/src/components/command-palette.tsx](../web/src/components/command-palette.tsx), [web/src/routes/navigation-items.ts](../web/src/routes/navigation-items.ts), [src/server/queries.ts](../src/server/queries.ts).

## Feature 59 — Evoluir localização e acessibilidade da jornada

**Prioridade:** P2 · **Origem:** M28

**Depende de:** 19, 24, 29.

**Escopo e motivo:** Consolidar pt-BR/en, terminologia, formatos de datas/moedas, foco, contraste e uso por teclado, incluindo seleção múltipla, quadro e revisão. Os controles novos das features anteriores já devem nascer acessíveis; este item consolida a revisão global.

**Critério de conclusão:** Os fluxos principais podem ser concluídos por teclado, sem depender de arrastar cards; troca de idioma mantém estados e não altera os dados armazenados.

**Arquivos-base:** [web/src/routes/navigation-items.ts](../web/src/routes/navigation-items.ts), [web/src/components/workspace-ui.tsx](../web/src/components/workspace-ui.tsx), [web/src/components/ui/dialog.tsx](../web/src/components/ui/dialog.tsx), [web/src/routes/application-board.tsx](../web/src/routes/application-board.tsx), [web/src/lib/api.ts](../web/src/lib/api.ts).

## Feature 60 — Criar controle de armazenamento e retenção

**Prioridade:** P2 · **Origem:** N30

**Depende de:** 09, 14, 23.

**Escopo e motivo:** Mostrar espaço por categoria, identificar versões sem uso e oferecer limpeza com prévia e retenção configurável; preservar artefatos enviados e referências de histórico.

**Critério de conclusão:** A prévia informa exatamente o que será removido; um PDF vinculado a envio não é tratado como temporário; há caminho de backup antes da limpeza.

**Arquivos-base:** [src/paths.ts](../src/paths.ts), [src/preparation/store.ts](../src/preparation/store.ts), [src/db/schema.ts](../src/db/schema.ts), [web/src/routes/settings.tsx](../web/src/routes/settings.tsx).

## Feature 61 — Criar templates de fluxos de automação

**Prioridade:** P2 · **Origem:** N25

**Depende de:** 07, 19, 30, 31, 33.

**Escopo e motivo:** Salvar configurações de buscar/avaliar, preparar selecionadas e revisar follow-ups, incluindo critérios e modelo; revisar parâmetros antes de executar.

**Critério de conclusão:** Reutilizar um template não reutiliza acidentalmente IDs de outro lote nem ignora permissões e revisões necessárias.

**Arquivos-base:** [src/acp/session.ts](../src/acp/session.ts), [src/paths.ts](../src/paths.ts), [web/src/routes/launch.tsx](../web/src/routes/launch.tsx).

## Feature 62 — Criar estimativas de duração e consumo de automação

**Prioridade:** P3 · **Origem:** N33

**Depende de:** 16, 23, 61.

**Escopo e motivo:** Apresentar duração histórica, quantidade de execuções e consumo/custo somente quando os dados do provider permitirem; distinguir estimativa de medição.

**Critério de conclusão:** Uma estimativa informa sua base e incerteza; falta de dados de consumo aparece como indisponível, sem custo fictício.

**Arquivos-base:** [src/preparation/store.ts](../src/preparation/store.ts), [src/acp/client.ts](../src/acp/client.ts), [web/src/routes/apply.tsx](../web/src/routes/apply.tsx).

## Feature 63 — Evoluir a visão de capacidades por integração e portal

**Prioridade:** P3 · **Origem:** N34

**Depende de:** 07, 15, 41.

**Escopo e motivo:** Exibir suporte a buscar, extrair e preencher por fonte/portal, com diagnóstico por capacidade e alternativa manual. Reaproveitar os adaptadores existentes, sem confundir registro de seletor com compatibilidade validada.

**Critério de conclusão:** O usuário vê quais operações estão disponíveis no ambiente e entende por que um portal exige intervenção manual.

**Arquivos-base:** [src/adapters/registry.ts](../src/adapters/registry.ts), [src/adapters/types.ts](../src/adapters/types.ts), [src/mcp/config.ts](../src/mcp/config.ts), [web/src/routes/settings.tsx](../web/src/routes/settings.tsx).

## Feature 64 — Criar conectores para novas fontes de oportunidades

**Prioridade:** P3 · **Origem:** N28

**Depende de:** 41, 43, 63.

**Escopo e motivo:** Adicionar páginas de carreira e portais conforme demanda, preservando origem, identificadores e contrato normalizado de vaga; validar cada conector separadamente.

**Critério de conclusão:** Uma fonte adicional usa salvamento, deduplicação, revisão e acompanhamento existentes; indisponibilidade de uma fonte não interrompe as demais.

**Arquivos-base:** [src/mcp/search.ts](../src/mcp/search.ts), [src/adapters/types.ts](../src/adapters/types.ts), [src/db/schema.ts](../src/db/schema.ts).

## Feature 65 — Criar captura de vagas pelo navegador

**Prioridade:** P3 · **Origem:** N27

**Depende de:** 41, 63.

**Escopo e motivo:** Capturar a página aberta via integração ou extensão, mostrar os dados extraídos e salvar no workspace local autenticado.

**Critério de conclusão:** Salvar a mesma página duas vezes aponta para a vaga existente; a captura funciona com o app disponível e explica como continuar quando estiver fechado.

**Arquivos-base:** [src/server/index.ts](../src/server/index.ts), [src/jobs/http.ts](../src/jobs/http.ts), [src/mcp/chrome.ts](../src/mcp/chrome.ts).

## Feature 66 — Criar integração opcional com e-mail

**Prioridade:** P3 · **Origem:** N26

**Depende de:** 23, 25, 29, 39, 63.

**Escopo e motivo:** Importar confirmações, convites e respostas de uma conta conectada; sugerir associação e mudança de estado para revisão. Permitir desconectar e controlar o escopo importado.

**Critério de conclusão:** Uma mensagem ambígua não altera o processo errado; reimportação não duplica eventos; sugestões podem ser aceitas ou descartadas.

**Arquivos-base:** [src/db/schema.ts](../src/db/schema.ts), [web/src/routes/settings.tsx](../web/src/routes/settings.tsx), [web/src/components/application-details.tsx](../web/src/components/application-details.tsx).

## Feature 67 — Evoluir atualização e recuperação da instalação Linux

**Prioridade:** P3 · **Origem:** Complemento identificado no fluxo de instalação

**Depende de:** 01, 08, 09, 60.

**Escopo e motivo:** Oferecer fluxo de nova versão com informação das mudanças, preservação do workspace e recuperação em caso de atualização malsucedida. Hoje a instalação é atualizada por comandos de build e cópia descritos no README.

**Critério de conclusão:** Atualizar preserva dados e fontes; versão e resultado ficam visíveis; recuperação considera compatibilidade do banco, sem prometer downgrade irrestrito.

**Arquivos-base:** [desktop/src/main.ts](../desktop/src/main.ts), [desktop/electron-builder.yml](../desktop/electron-builder.yml), [package.json](../package.json), [docs/desenvolvimento.md](desenvolvimento.md).

## Feature 68 — Criar suporte validado a Windows e macOS

**Prioridade:** P3 · **Origem:** N35 — expansão final

**Depende de:** 07, 08, 09, 20, 51, 59, 63, 67; jornada principal estabilizada.

**Escopo e motivo:** Validar cada sistema em entrega própria: instalador, assinatura quando aplicável, caminhos, subprocessos, navegador, ferramentas LaTeX, notificações e atualização. Os targets nsis/dmg já declarados não equivalem a suporte testado; a limpeza de perfil da CLI hoje é restrita ao Linux.

**Critério de conclusão:** Instalar, iniciar, preparar, revisar, preencher, confirmar, acompanhar, atualizar e restaurar funcionam em cada sistema, com testes e limitações documentados. Windows/macOS ficam após a estabilização do produto Linux, sem bloquear as features anteriores.

**Arquivos-base:** [desktop/electron-builder.yml](../desktop/electron-builder.yml), [desktop/src/main.ts](../desktop/src/main.ts), [src/paths.ts](../src/paths.ts), [src/mcp/chrome.ts](../src/mcp/chrome.ts), [src/cli/linkedin.ts](../src/cli/linkedin.ts), [src/preparation/latex.ts](../src/preparation/latex.ts), [scripts/smoke-electron.mjs](../scripts/smoke-electron.mjs), [scripts/smoke-apply.mjs](../scripts/smoke-apply.mjs).
