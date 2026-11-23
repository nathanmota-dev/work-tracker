# Work Tracker — inventário de features e evolução dos fluxos

**Features existentes:** dashboard com indicadores, métricas de perfil, próximas entrevistas e atividades; busca de vagas e pessoas no LinkedIn; descoberta e avaliação de compatibilidade por agente; lista de vagas salvas com busca, filtros, paginação, detalhes, arquivamento, restauração e exclusão; preparação de candidatura por vaga; configuração do currículo LaTeX e dados complementares; geração de currículo adaptado ao idioma da vaga; comparação, navegação, zoom e download dos PDFs; histórico de execuções e relatórios; preenchimento de portais para revisão e envio manual; confirmação de envio; listagem de candidaturas e artefatos; quadro de candidaturas com cadastro manual, edição, etapas configuráveis, movimentação, histórico, arquivamento por motivo e reabertura; diretório de recrutadores e sincronização de conexões aceitas; acompanhamento de contatos, follow-ups, cooldowns e créditos de InMail; respostas reutilizáveis para formulários; consulta de entrevistas; perfil profissional e auditoria do LinkedIn; captura de experiências por skill; execução de agentes ACP com escolha de provider/modelo, atividade em tempo real, cancelamento e retomada após login; configurações de identidade, tema, preferências e navegador de login; navegação por menu e paleta de comandos; persistência local SQLite, API HTTP/WebSocket, CLI, integrações MCP, importação explícita de jornada e compilação de PDF via CLI.

**Features que precisam melhorar:** a continuidade entre Search, Jobs, Apply, Automatic applications e Application board; a seleção de vagas, hoje individual no fluxo gerenciado de Apply; a separação entre currículo pronto, formulário preenchido, candidatura enviada e etapa do processo seletivo; a atualização consistente de status e contagens; a reutilização de dados da vaga no quadro; o salvamento direto de resultados de busca; a organização de candidaturas manuais e preparadas pelo agente; os filtros, a ordenação e a preservação do contexto de navegação; a revisão de documentos e campos pendentes; a recuperação de falhas e login; a apresentação do score de palavras-chave; a gestão visual de entrevistas, contatos e respostas; a configuração e o diagnóstico das integrações; a interação com o agente; a acessibilidade, a linguagem da interface e o histórico completo de atividades.

**Novas features a adicionar:** seleção múltipla e preparação de candidaturas em lote com fila persistente; central de revisão por vaga; cadastro e importação de oportunidades por URL ou arquivo; buscas salvas e monitoramento de novas vagas; comparação de oportunidades e priorização explicável; workspace por empresa; biblioteca de currículos e cartas; banco visual de experiências; agenda, lembretes e tarefas; preparação para entrevistas; gestão de testes técnicos e propostas; acompanhamento de prazos e tempo por etapa; metas e análises do funil; integrações opcionais com calendário e e-mail; captura de vagas pelo navegador; backup e restauração; exportação de dados; assistente inicial de configuração; perfis de busca e templates de automação; e, em uma etapa posterior, suporte a Windows e macOS.

## Escopo e leitura

Este documento organiza o inventário atual e um backlog amplo de melhorias e novas capacidades. As propostas não estão implementadas. A análise foi feita pela leitura do código das telas, serviços, consultas, persistência e documentação do repositório em **14/10/2026**; não houve execução de integrações externas nem validação visual nesta tarefa.

“Automático” hoje significa assistência na preparação e no preenchimento. O fluxo gerenciado de Apply termina com revisão e envio no navegador pelo usuário, seguido da confirmação no app. Preparar várias candidaturas é uma evolução diferente de enviar todas automaticamente.

Prioridades propostas: **P0** = corrigir a continuidade e a integridade do fluxo principal; **P1** = reduzir trabalho repetitivo e melhorar o uso diário; **P2** = ampliar o produto; **P3** = expansão posterior. As prioridades não representam uma estimativa de prazo.

## 1. Features atuais por tela e capacidade

| Tela / área | O que existe hoje | Limite relevante |
| --- | --- | --- |
| Dashboard | Totais de vagas, candidaturas e recrutadores; score e evolução do perfil; próximas entrevistas; painel **Deadlines** com até 5 vagas e candidaturas vencidas ou que vencem em até 7 dias; atividades recentes; atalhos. | Não organiza as pendências da jornada em uma lista de ações; as contagens não distinguem claramente preparação de envio. |
| Search | Busca de vagas e pessoas por palavras-chave e localização; modalidade e quantidade de páginas para vagas; empresa para pessoas; detalhes da vaga e link externo. | Avaliar e salvar uma vaga encaminha para Launch; não há seleção múltipla nem botão de salvamento direto. |
| Jobs | Vagas ativas e arquivadas; indicadores; busca, filtro e paginação na tabela; prazo de inscrição com selo de urgência e ordenação por prazo; detalhes; avaliação via agente; preparação; arquivar, restaurar e excluir. | Sem cadastro/edição geral pela tela, seleção múltipla ou visão integrada da candidatura vinculada. A exclusão é bloqueada quando há histórico vinculado. |
| Apply | Seleção de uma vaga, agente e modelo; descrição editável; contexto adicional; geração e regeneração; preenchimento; cancelamento; confirmação de envio. | Um `jobId` por vez; nenhuma fila de lote; geração e preenchimento compartilham a disponibilidade do agente. |
| Currículo e PDFs | Detecção/configuração de fontes LaTeX e dados JSON/TypeScript; seleção de compilador; diagnóstico de ferramentas; preview base; PDF adaptado; zoom, páginas e download. | Exige um projeto LaTeX local e ferramentas instaladas; não há biblioteca visual de templates ou comparação textual das alterações. |
| Histórico de preparação | Execuções persistidas com fases, status, eventos, erros, relatório e PDFs; preservação de PDFs anteriores quando uma nova geração falha. | Reiniciar o app marca execuções em andamento como interrompidas; não há fila persistente ou retomada automática por etapa. |
| Automatic applications | Tabela de candidaturas, status, score quando presente, prazo efetivo com selo de urgência e ordenação por prazo, portal, data, caminhos de artefatos e atalho para Apply. | A consulta inclui também candidaturas cadastradas manualmente; o nome não representa essa abrangência. Não há gestão de lote. |
| Application board | Cadastro manual, edição, busca, cards por etapa, arrastar e soltar, mudança pelo detalhe, histórico, arquivamento com motivo e reabertura. | Só lista candidaturas com `current_stage_id`; o fluxo gerenciado de Apply não preenche esse campo ao confirmar envio. |
| Etapas do processo | Etapas iniciais de candidatura, entrevista com recrutador, entrevista técnica e oferta; criar, renomear, ordenar e arquivar etapas; categoria de assessment disponível. | Não integra agendamento de entrevista ou tarefas de cada etapa. O formulário limita o tipo de vaga a front-end, back-end e full-stack. |
| Recruiters | Diretório, detalhes e links; ações de follow-up pendentes; prévia e aplicação da sincronização de conexões aceitas; descoberta pelo agente. | Não há cadastro/edição geral nem vínculo visual completo entre contato, empresa, vaga e candidatura. |
| Outreach | Distribuição dos estados de contato, próximas ações, empresas em cooldown, saldo e reserva de InMail; revisão via agente. | A tela é principalmente de consulta; não oferece edição do orçamento ou uma caixa de revisão de mensagens por contato. |
| Answers | Criar e editar respostas por chave/categoria; reutilização no preenchimento; identidade usada por outros fluxos. | Sem exclusão pela tela, catálogo de campos amigáveis, regras por idioma ou sinalização de dados obrigatórios ausentes. |
| Interviews | Lista, detalhes, horário, etapa, status, notas e indicadores de próximas entrevistas. | Sem criar, editar, remarcar ou concluir entrevistas pela interface. |
| Profile | Identidade, link do LinkedIn, última sincronização, métricas, score, breakdown e atalho para auditoria. | Recomendações não viram um plano de ações acompanhado pela tela. |
| Launch | Descoberta, avaliação de vaga, auditoria, recrutadores, follow-ups, portal e captura de experiências; provider/modelo; contexto; streaming; cancelamento e repetição após login. | Uma sessão ativa; não há chat para responder durante a execução. A adaptação de currículo foi direcionada para Apply. |
| Activity | Consulta dos 50 eventos mais recentes com busca, filtro e paginação local. | A paginação da tabela não recupera eventos anteriores ao limite da consulta; não há detalhe de evento com navegação para o registro. |
| Settings e navegação | Tema claro/escuro, preferências locais de agente/modelo, identidade, fontes do currículo, login no Chrome, conexão com backend, menu e paleta `Ctrl+K`. | Configuração de comandos MCP/ACP continua externa à tela; a paleta busca páginas, não os registros do workspace. |
| Backend, CLI e desktop | SQLite local; API autenticada; notificações WebSocket; subprocessos de agentes; skills próprias; CLI para registros, diagnóstico, configuração, importação explícita e exportação Typst → PDF; pacote Linux. | Algumas operações disponíveis na CLI ainda não têm fluxo visual. Exportar Typst para PDF não equivale a exportar o banco de candidaturas. |

### 1.1. Prazos de inscrição

Vagas (`jobs.deadline`) e candidaturas (`applications.deadline`) guardam um prazo opcional como data local `YYYY-MM-DD`, sem hora nem fuso. O prazo efetivo de uma candidatura é o dela própria ou, na falta dele, o da vaga vinculada. O formulário de vaga, o cadastro manual de candidatura e `work-tracker job save --deadline YYYY-MM-DD` aceitam somente datas reais; um valor vazio remove o prazo.

A urgência (`src/deadlines/urgency.ts`) compara datas locais: **Overdue** antes de hoje, **Due today** / **Due in N days** de 0 a 7 dias (o mesmo limite de 7 dias do `ai-job-search`) e apenas a data acima disso. O texto sempre acompanha a cor. O prazo só conta como urgência enquanto nada foi enviado: candidaturas em rascunho, preparadas ou preenchidas (`submission_status != 'submitted'`) e não arquivadas, e vagas não arquivadas sem candidatura enviada. Depois do envio, o selo mostra só a data. O painel **Deadlines** do Dashboard lista até 5 itens vencidos ou próximos, ordenados por prazo; uma vaga com candidatura em andamento aparece pela candidatura. O app apenas avisa: uma vaga vencida ainda pode ser preparada.

## 2. Features existentes que precisam melhorar

### 2.1. Backlog de melhorias

| ID | Prioridade | Feature / problema atual | Melhoria proposta | Resultado verificável |
| --- | --- | --- | --- | --- |
| M01 | P0 | Apply confirma envio sem inserir a candidatura no board. | Na confirmação, definir a etapa inicial, ativar o acompanhamento e registrar evento, preservando o mesmo ID. | A candidatura enviada aparece no quadro imediatamente; repetir a confirmação não cria outro card. |
| M02 | P0 | Jobs, preparação e quadro usam partes diferentes dos dados da mesma jornada. | Manter vínculo com a vaga e reutilizar empresa, cargo, remuneração, stack, descrição e links; permitir ajustes explícitos. | Candidatar-se a uma vaga salva não exige cadastrar novamente seus dados no quadro. |
| M03 | P0 | A lista Automatic applications também recebe registros manuais. | Organizar uma área Candidaturas com origem identificada e visões de preparação, acompanhamento e arquivadas; revisar rótulos. | O usuário entende quais candidaturas foram preparadas pelo agente e quais apenas foram registradas. |
| M04 | P0 | Preparação, envio, etapa e arquivamento têm estados separados, sem uma apresentação unificada. | Exibir estado de preparação e etapa do processo como informações distintas; padronizar transições e rótulos. | Currículo gerado não aparece como enviado; mover de etapa não apaga a informação de envio. |
| M05 | P0 | A confirmação de envio não atualiza o status da vaga; o dashboard conta registros de candidatura sem distinguir rascunhos. | Definir fonte de verdade para cada indicador e refletir os vínculos em Jobs e Dashboard. | Rascunhos, formulários preenchidos e envios têm contagens próprias; Jobs mostra a candidatura associada. |
| M06 | P0 | Uma candidatura manual pode ter URL sem `job_id`; o botão de preparação abre Apply sem selecionar uma vaga. | Criar/vincular uma oportunidade antes de preparar, ou oferecer preparação a partir dos dados da candidatura. | “Preparar candidatura” abre um contexto utilizável, sem exigir que o usuário descubra o vínculo faltante. |
| M07 | P1 | Search exige passagem por Launch para avaliar e salvar. | Separar “Salvar vaga” de “Avaliar com agente”; oferecer salvamento individual e múltiplo com deduplicação. | Uma busca vira uma shortlist sem executar o agente para cada item. |
| M08 | P1 | Apply só seleciona uma vaga e Jobs não tem seleção múltipla. | Adicionar checkboxes, seleção entre páginas, contador e ação “Preparar selecionadas”, conectada à fila N01. | Selecionar cinco vagas permite revisar e iniciar um lote de cinco itens. |
| M09 | P1 | Jobs depende de agente/CLI para cadastro e atualização de campos gerais. | Criar e editar vaga manualmente; aceitar URL e descrição colada; mostrar campos ausentes. | Uma vaga fora do LinkedIn pode ser cadastrada e preparada pela UI. |
| M10 | P1 | Há filtros genéricos, mas faltam critérios próprios da jornada e ordenação escolhida pelo usuário. | Filtros por empresa, compatibilidade, salário, modalidade, senioridade, origem, data e estado de candidatura; ordenar e salvar preferências. | É possível localizar vagas remotas compatíveis ainda não enviadas, sem busca textual improvisada. |
| M11 | P1 | Filtros, página, scroll e parte dos formulários vivem no estado local das telas. | Preservar contexto ao abrir detalhes, ir para Apply/Launch e voltar; salvar rascunhos de contexto adicional. | Revisar uma vaga não reinicia a seleção nem apaga o trabalho em andamento. |
| M12 | P1 | Falhas e login exigem repetição manual; a geração não possui retomada geral por etapa. | Oferecer ações específicas para autenticação, nova tentativa e recuperação da fase; manter o PDF validado visível. | Falha no preenchimento pode ser corrigida sem obrigar uma nova geração de currículo. |
| M13 | P1 | Generate/Fill podem ficar desabilitados por vários requisitos. | Mostrar os bloqueios e uma ação para resolver cada um: descrição, fonte, ferramenta, agente, conexão ou candidatura já enviada. | O usuário entende o motivo de cada bloqueio sem inspecionar logs. |
| M14 | P1 | Apply exibe PDFs e relatório, mas a revisão continua dispersa. | Comparação textual, alterações destacadas, decisão explícita sobre versão e resumo do conteúdo enviado. | A versão revisada é identificada e coincide com o PDF usado no portal. |
| M15 | P1 | Campos preenchidos e pendentes são persistidos, mas não têm uma revisão dedicada. | Exibir checklist do formulário, respostas utilizadas, itens pendentes e link para corrigir respostas reutilizáveis. | O usuário consegue terminar o formulário sem interpretar JSON ou caminhos de artefatos. |
| M16 | P1 | A tabela mostra `keyword_score`, mas a geração gerenciada não calcula nem grava esse score. | Definir o cálculo, persistir resultado e breakdown ou explicitar que a execução não produziu avaliação. | O score mostrado corresponde à versão do currículo e informa cobertura, requisitos e lacunas. |
| M17 | P1 | O quadro acompanha etapas sem integrar entrevistas, prazos ou documentos. | Detalhe unificado com vaga, currículo enviado, eventos, contatos, entrevistas e próxima ação. | Um card fornece o contexto necessário para continuar o processo. |
| M18 | P1 | Tipos de vaga do formulário são restritos a front-end, back-end e full-stack. | Permitir especialidades adicionais e tipos personalizados, sem perder os registros atuais. | Vagas de mobile, dados, DevOps, QA e outros cargos podem ser classificadas corretamente. |
| M19 | P1 | Interviews permite apenas consulta pela tela. | Criar, editar, remarcar, cancelar e concluir; vincular à candidatura; tratar horário local e fuso. | Registrar uma entrevista atualiza o detalhe da candidatura e os próximos eventos. |
| M20 | P1 | Recruiters e Outreach mostram pendências, mas dependem de Launch para tratá-las. | Editor de contato, histórico da relação, rascunhos revisáveis e ação contextual com dados do contato já preenchidos. | Um follow-up abre o contato e o texto correspondente sem reconstruir o contexto manualmente. |
| M21 | P1 | Orçamento de InMail e regras de cadência não são editáveis em Outreach. | Formulário para saldo, reserva e regras; prévia do efeito das mudanças na fila. | O saldo exibido pode ser atualizado pela UI e altera o planejamento das próximas ações. |
| M22 | P1 | Answers expõe chaves livres e não permite excluir pela tela. | Campos comuns com nomes amigáveis, validações, exclusão e organização por categoria; manter modo avançado. | O usuário mantém identidade, links e elegibilidade sem precisar conhecer nomes internos de chaves. |
| M23 | P1 | Launch recebe contexto inicial, mas não oferece respostas durante o turno. | Conversa interativa e solicitações estruturadas; apresentar decisões necessárias no ponto em que surgem. | A skill de captura de experiências consegue entrevistar o usuário dentro do app. |
| M24 | P1 | Settings não edita comandos de integrações nem oferece diagnóstico completo. | Configurar/testar MCP e ACP; distinguir backend conectado de integração instalada, autenticada e pronta. | O usuário consegue descobrir e resolver uma integração indisponível sem editar JSON. |
| M25 | P2 | Activity limita a consulta aos últimos 50 eventos. | Paginação real, período, detalhes e links para vaga, candidatura, contato e execução. | Eventos antigos continuam acessíveis e cada ação pode ser rastreada até seu registro. |
| M26 | P2 | A paleta navega apenas entre páginas. | Busca de vagas, empresas, contatos e candidaturas; ações rápidas contextualizadas. | `Ctrl+K` localiza uma candidatura pelo cargo ou pela empresa. |
| M27 | P2 | A auditoria de Profile apresenta score e breakdown sem gestão de execução das melhorias. | Transformar recomendações em checklist com histórico antes/depois e evidências de atualização. | É possível acompanhar o que foi corrigido e comparar auditorias. |
| M28 | P2 | A interface usa rótulos em inglês e termos próximos para fluxos diferentes. | Localização pt-BR/en, terminologia consistente, datas/fusos, feedback de progresso e revisão de acessibilidade. | A jornada mantém nomes claros; tabelas, seleção múltipla, diálogos e quadro funcionam por teclado. |

### 2.2. Fluxos de telas que devem ser arrumados

#### F01 — Buscar e salvar oportunidades

**Hoje:** Search → resultado → detalhes → “Assess & save with agent” → Launch → executar agente → Jobs.

**Proposto:** Search → selecionar resultados → “Salvar em Jobs” → confirmar itens salvos/duplicados → Jobs; “Avaliar compatibilidade” fica disponível como ação opcional sobre a shortlist.

**Aceite:** salvar vários resultados preserva os filtros da busca, informa o resultado por item e não duplica a mesma oportunidade.

#### F02 — Jobs → candidatura → quadro

**Hoje:** Jobs → “Prepare application” → Apply → gerar currículo → preencher portal → enviar no navegador → “I submitted in the browser” → atualizar `status` e `applied_at`. O board não recebe a etapa inicial nessa operação.

**Proposto:** Jobs → preparar candidatura vinculada → revisar currículo → preencher portal → revisar campos → enviar no navegador → confirmar no app → ativar acompanhamento no board → mostrar próxima ação. Jobs e Dashboard refletem a mudança.

**Aceite:** um único registro de candidatura conecta a vaga, a versão do currículo, o envio e o card; a confirmação repetida não gera registros extras.

#### F03 — Preparar várias candidaturas

**Hoje:** escolher uma vaga em Apply, gerar, revisar e repetir a navegação para a próxima. O serviço bloqueia uma segunda execução enquanto a primeira está ativa.

**Proposto:** Jobs → selecionar várias vagas → “Preparar selecionadas” → revisar elegibilidade → configurar lote → acompanhar fila → revisar resultado de cada vaga → preencher os portais escolhidos → confirmar os envios individualmente → board.

O primeiro incremento deve processar a fila sequencialmente. Uma única sessão de agente e um navegador compartilhado já são suficientes para preparar um lote; selecionar múltiplas vagas não exige executar vários agentes em paralelo.

**Aceite:** cinco vagas geram cinco resultados identificáveis; um erro não perde os demais itens; fechar e reabrir o app preserva o lote; nenhuma vaga é marcada como enviada apenas por ter sido preparada.

#### F04 — Registrar uma candidatura feita fora do app

**Hoje:** Application board → “New application” → empresa e URL → card na etapa Applied. O cadastro não aceita vínculo com uma vaga salva, e o registro também aparece na consulta de Automatic applications.

**Proposto:** Candidaturas → “Registrar candidatura enviada” → selecionar vaga salva ou informar empresa/URL → preencher data e documentos opcionais → registrar origem manual → board.

**Aceite:** o app diferencia “preparar uma candidatura” de “registrar uma candidatura já enviada”; não cria duas candidaturas por causa da mudança de tela.

#### F05 — Candidatura → entrevista

**Hoje:** mover o card para uma etapa de entrevista não cria um evento em Interviews; Interviews não oferece cadastro pela UI.

**Proposto:** detalhe da candidatura → “Agendar entrevista” → data, fuso, participante, tipo e link → Interviews e Dashboard → registrar resultado → sugerir próxima etapa.

**Aceite:** a entrevista fica vinculada à candidatura, pode ser remarcada e não altera a etapa sem uma ação definida pelo usuário.

#### F06 — Vaga → recrutador → follow-up

**Hoje:** Jobs, Recruiters e Outreach possuem consultas e atalhos para skills, sem um workspace visual contínuo por oportunidade.

**Proposto:** detalhe da vaga/candidatura → contatos da empresa → selecionar recrutador → revisar mensagem com contexto da vaga → executar ação confirmada → histórico em Outreach → próxima ação vinculada.

**Aceite:** o usuário identifica qual vaga motivou o contato e encontra o histórico sem procurar a empresa em outras telas.

#### F07 — Corrigir um bloqueio de preparação

**Hoje:** dependências aparecem em Resume sources, erros no painel de execução e login em fluxos próprios; nem todo bloqueio possui um caminho direto de resolução.

**Proposto:** Apply/fila → mostrar bloqueio e sua causa → abrir a configuração ou login correspondente → validar novamente → continuar o mesmo item ou iniciar nova tentativa identificada.

**Aceite:** corrigir login ou configuração não perde o lote, os documentos anteriores nem o contexto da candidatura.

#### F08 — Manter perfil e respostas reutilizáveis

**Hoje:** identidade em Settings → Profile; respostas gerais em Answers; dados complementares de currículo em fontes locais; perfil LinkedIn consultado em Profile.

**Proposto:** perfil do candidato com áreas Identidade, Links, Elegibilidade, Experiências e Preferências → indicar origem de cada dado → usar os mesmos dados em busca, currículo e formulário.

**Aceite:** uma atualização de e-mail ou link se propaga aos próximos fluxos e não modifica retroativamente o registro do que já foi enviado.

#### F09 — Revisar versões e documentos

**Hoje:** Apply permite escolher execução e comparar PDFs; Automatic applications mostra caminhos; o board não reúne os artefatos da preparação.

**Proposto:** detalhe da candidatura → documentos → versão base/adaptada, data, relatório e uso no portal → abrir, comparar e baixar → indicar a versão efetivamente enviada.

**Aceite:** o documento enviado permanece identificado mesmo depois de novas versões do currículo base.

#### F10 — Encerrar e reabrir um processo

**Hoje:** o board registra motivo de arquivamento e permite reabrir; o arquivamento da vaga é uma operação separada.

**Proposto:** candidatura → concluir com resultado → registrar motivo e data → tratar lembretes pendentes → oferecer arquivamento separado da vaga → manter histórico → reabrir o processo com novo evento.

**Aceite:** arquivar a candidatura não apaga a vaga, os PDFs, entrevistas ou contatos; reabrir não apaga o resultado anterior.

### 2.3. Especificação da preparação em lote

1. **Selecionar:** checkboxes em Jobs e Search, contador, “selecionar página” e “selecionar todos os resultados filtrados”, com comportamento explícito entre páginas.
2. **Validar:** identificar vagas arquivadas, duplicadas, já enviadas, sem descrição ou sem dados suficientes; explicar quais itens serão processados e permitir corrigir/remover.
3. **Configurar:** escolher currículo base, provider/modelo e contexto compartilhado, com ajustes por vaga; registrar a versão das fontes usada pelo lote.
4. **Criar a fila:** persistir o lote e seus itens; mostrar posição, fase, estado e links para o resultado de cada vaga.
5. **Preparar:** buscar a descrição quando possível, adaptar o currículo, compilar, validar o PDF e salvar relatório por item; reutilizar o preview base já válido quando as fontes não mudarem.
6. **Gerenciar execução:** pausar o lote, cancelar item/lote, alterar a ordem dos itens ainda não iniciados, tratar login e tentar novamente os itens com falha.
7. **Revisar:** permitir abrir cada resultado enquanto outros itens continuam na fila; aprovar a versão do currículo ou solicitar ajuste com contexto específico.
8. **Preencher:** enviar os itens aprovados para uma fila própria de preenchimento, com um portal ativo por vez no fluxo inicial; preservar formulário que aguarda revisão.
9. **Registrar envio:** depois do envio no navegador, confirmar por candidatura; manter separadas as candidaturas ainda não enviadas.
10. **Concluir:** mostrar resumo do lote com preparados, pendentes de revisão, preenchidos, enviados, falhos e cancelados; oferecer retomada somente dos itens pendentes.

Estados sugeridos para os **itens da fila**, distintos dos estados do processo seletivo: `queued`, `preparing`, `tailoring`, `compiling`, `ready_for_review`, `waiting_for_sign_in`, `filling`, `awaiting_submission`, `submitted`, `failed`, `cancelled` e `interrupted`. A pausa do lote deve ser representada separadamente, sem apagar a fase de cada item.

O progresso deve ser descrito por item e fase. Um “100%” sem distinguir currículo pronto de candidatura enviada repetiria a ambiguidade atual.

### 2.4. Organização proposta das telas

| Área do menu | Telas / visões | Ação principal |
| --- | --- | --- |
| Visão geral | Dashboard e pendências | Ver o que precisa de atenção hoje. |
| Oportunidades | Busca, vagas salvas e detalhe | Descobrir, comparar, priorizar e selecionar vagas. |
| Candidaturas | Preparação individual, lotes, revisão, lista e quadro | Preparar, registrar envio e acompanhar processos. |
| Relacionamentos | Recrutadores, contatos e follow-ups | Relacionar pessoas às oportunidades e acompanhar conversas. |
| Entrevistas | Agenda, detalhes, avaliações e testes | Preparar e conduzir as próximas etapas. |
| Perfil e documentos | Perfil, respostas, experiências e currículos | Manter os dados usados pelas automações. |
| Agente e histórico | Launch, execuções e Activity | Executar tarefas e consultar resultados. |
| Configurações | Aparência, integrações, login e armazenamento | Manter o workspace pronto para uso. |

Não é necessário trocar todas as rotas no primeiro incremento. A prioridade é conectar as telas existentes, adicionar links contextuais e adotar nomes que indiquem a etapa da jornada.

## 3. Novas features a adicionar

### 3.1. Backlog de novas capacidades

| ID | Prioridade | Nova feature | Fluxo / valor esperado | Dependências principais |
| --- | --- | --- | --- | --- |
| N01 | P1 | Fila persistente de candidaturas em lote | Selecionar várias vagas, preparar sequencialmente, acompanhar resultado por item e retomar pendências. | M01–M08; persistência de lote e itens; coordenação com a sessão ACP. |
| N02 | P1 | Central de revisão de candidaturas | Reunir currículos prontos, ajustes solicitados, formulários preenchidos e envios pendentes. | N01; M14–M17. |
| N03 | P1 | Cadastro/importação por URL | Colar uma URL, extrair dados para revisão e salvar a oportunidade sem depender da busca LinkedIn. | M09; conectores ou extração pelo navegador; deduplicação. |
| N04 | P1 | Importação e exportação de dados | Importar vagas/candidaturas por CSV ou JSON e exportar o histórico com prévia de conflitos. | Modelo unificado; validação e associação de registros. |
| N05 | P1 | Buscas salvas | Guardar palavras-chave, empresas, localidades e modalidade; repetir a busca e comparar resultados. | Persistência de critérios; fluxo F01. |
| N06 | P1 | Central de tarefas e lembretes | Reunir revisão, follow-up, prazo e entrevista em uma lista de ações com links para os registros. | Vínculos de candidatura; datas e estados das tarefas. |
| N07 | P1 | Assistente inicial de configuração | Guiar identidade, currículo, ferramentas, integrações e primeiro fluxo completo. | M13 e M24; estados de diagnóstico. |
| N08 | P2 | Monitoramento de oportunidades | Executar buscas salvas em horários escolhidos, identificar novidades e apresentar shortlist. | N05; agendamento local; tratamento de app fechado e autenticação pendente. |
| N09 | P2 | Ranking explicável de vagas | Priorizar por compatibilidade, remuneração, localidade, preferências e prazo; mostrar motivos e dados ausentes. | Preferências do candidato; avaliação estruturada; M16. |
| N10 | P2 | Comparação de vagas | Selecionar oportunidades e comparar requisitos, salário, modelo de trabalho, lacunas e etapa atual. | Dados normalizados; M10. |
| N11 | P2 | Workspace por empresa | Reunir vagas, candidaturas, recrutadores, notas, entrevistas e histórico de uma empresa. | Identidade consistente de empresa e vínculos entre registros. |
| N12 | P2 | Biblioteca de currículos base | Manter currículos por idioma, especialidade e objetivo; escolher o mais adequado à vaga. | Evoluir configuração de fontes para múltiplos projetos. |
| N13 | P2 | Editor de carta e respostas discursivas | Revisar cartas já geradas, criar variações por vaga e manter modelos de respostas longas. | Artefatos versionados; M14 e M22. |
| N14 | P2 | Banco visual de experiências | Cadastrar resultados, projetos, tecnologias e evidências com tags; revisar sugestões do agente. | M23; integração com a skill e com os dados do currículo. |
| N15 | P2 | Feedback sobre o currículo | Avaliar se os trechos escolhidos representam bem o candidato e usar o feedback em novas adaptações. | N14; registro de decisões por versão. |
| N16 | P2 | Histórico da descrição da vaga | Guardar snapshots e destacar mudança de requisitos, remuneração ou disponibilidade. | N03/N08; identificação estável da oportunidade. |
| N17 | P2 | Detecção de vagas encerradas e republicadas | Marcar indisponibilidade e possíveis republicações; oferecer atualização ou arquivamento. | Monitoramento e revisão de possíveis duplicatas. |
| N18 | P2 | Agenda visual e integração com calendário | Visão semanal/mensal, exportação ICS e integração opcional para eventos e remarcações. | M19; identidade do evento e política de sincronização. |
| N19 | P2 | Preparação para entrevistas | Briefing da vaga/empresa, perguntas prováveis, histórias profissionais e checklist. | F05; N11 e N14. |
| N20 | P2 | Simulação de entrevista | Conversa de prática, feedback, anotações e plano de estudo associado à oportunidade. | M23; N19. |
| N21 | P2 | Gestão de testes técnicos | Enunciado, prazo, repositório, arquivos, checklist, entrega e resultado dentro da candidatura. | N06; etapa de assessment e documentos. |
| N22 | P2 | Gestão e comparação de propostas | Registrar salário, moeda, benefícios, regime, condições e prazo de resposta. | Dados de remuneração estruturados; etapa Offer. |
| N23 | P2 | Metas e análises do funil | Metas semanais, conversões por etapa, tempo de resposta e resultados por empresa/origem. | M04/M05; datas e eventos confiáveis. |
| N24 | P2 | Análise de gargalos | Destacar processos parados e sugerir próxima ação conforme o histórico e os prazos. | N06 e N23. |
| N25 | P2 | Templates de workflows | Salvar configurações para “buscar e avaliar”, “preparar selecionadas” e “revisar follow-ups”. | M23/M24; N01; regras de cada fluxo. |
| N26 | P2 | Integração opcional com e-mail | Importar confirmações, convites e respostas; sugerir vínculo e mudança de estado para revisão. | Conector autorizado; resolução de ambiguidades e duplicatas. |
| N27 | P2 | Captura de vagas pelo navegador | Salvar uma vaga da página aberta, revisar os campos e enviar ao workspace local. | N03; extensão ou integração com navegador. |
| N28 | P2 | Mais fontes de oportunidades | Conectores para páginas de carreira e portais adicionais, mantendo origem e dados normalizados. | N03; adaptadores de fontes. |
| N29 | P2 | Backup e restauração do workspace | Copiar banco, configuração e artefatos; validar recuperação; permitir escolher destino. | Snapshot consistente do SQLite e associação de documentos. |
| N30 | P2 | Controle de armazenamento | Mostrar tamanho de artefatos, identificar versões sem uso e gerenciar retenção. | Documentos vinculados; N29; histórico preservado. |
| N31 | P2 | Perfis de busca e preferências | Objetivos por cargo, faixa salarial, moeda, país, regime, idioma e modalidade. | N09; uso consistente em Search, Jobs e agentes. |
| N32 | P2 | Tags, favoritos e listas pessoais | Organizar vagas e contatos por prioridade, campanha ou tema, além do status da jornada. | Identidade dos registros e filtros. |
| N33 | P3 | Estimativa de custo e tempo de automação | Mostrar duração histórica, quantidade de execuções e consumo quando o provider fornecer dados. | N01; telemetria local e dados anunciados pelo agente. |
| N34 | P3 | Visão de capacidade das integrações | Exibir quais fontes e portais podem buscar, extrair ou preencher, com modo alternativo manual. | M24; adaptadores e diagnóstico por funcionalidade. |
| N35 | P3 | Windows e macOS | Adaptar empacotamento, caminhos, processos, navegador e recuperação de perfis. | Estabilização das features principais e validação por sistema; expansão já prevista no README. |

### 3.2. Otimizações para tornar essas features úteis

- **Reduzir repetição:** carregar dados da vaga, identidade e respostas automaticamente; oferecer ações diretas no detalhe em vez de exigir que o usuário reconstrua o contexto em Launch.
- **Reutilizar resultados válidos:** manter o cache do currículo base por versão das fontes e acrescentar avaliação/cache da descrição por vaga; uma nova tentativa de preenchimento não deve regenerar o PDF.
- **Separar trabalho de revisão:** permitir preparar os próximos currículos enquanto o usuário revisa um resultado; a preparação em lote e o preenchimento de portais precisam de filas e condições próprias.
- **Evitar duplicação:** usar identificação da origem, URL normalizada e vínculos explícitos; tratar republicação como caso a revisar, sem unir automaticamente vagas diferentes pelo título.
- **Persistir progresso:** fila, escolhas de documento, contexto e decisões devem sobreviver à navegação e ao reinício do app.
- **Atualizar apenas o necessário:** aproveitar notificações WebSocket por registro/área, revisar o polling de preparação e evitar recarregar listas inteiras em cada evento do agente.
- **Escalar consultas:** aplicar filtros, ordenação e paginação no backend quando o volume crescer; Activity já precisa recuperar páginas além dos últimos 50 eventos.
- **Explicar decisões:** score e ranking precisam de critérios e dados de origem; ausência de dado não deve virar nota arbitrária.
- **Preservar o histórico:** registrar a versão e os dados usados em cada envio; mudanças futuras no perfil não devem reescrever uma candidatura antiga.

## 4. Ordem de implementação recomendada

| Etapa | Entregas | Condição de conclusão |
| --- | --- | --- |
| 1 — Conectar a jornada | M01–M06: identidade da candidatura, envio → board, estados, origem e contagens. | O fluxo de uma vaga funciona do salvamento ao acompanhamento, sem recadastro ou duplicação. |
| 2 — Preparar em lote | M07/M08/M12/M13, N01/N02: salvamento direto, seleção múltipla, fila e revisão. | Um lote continua utilizável após falha, login pendente e reinício; resultados e envios são rastreáveis por vaga. |
| 3 — Completar o uso diário | Cadastro/edição, filtros, documentos, entrevistas, respostas, contatos, interação ACP e configurações. | As operações recorrentes têm fluxo visual e não dependem de comandos manuais. |
| 4 — Ampliar descoberta e acompanhamento | Buscas salvas, tarefas, ranking, empresas, experiências, calendário, métricas e backup. | As novas capacidades usam os vínculos e eventos estabelecidos nas etapas anteriores. |
| 5 — Expandir integrações e plataformas | Fontes adicionais, e-mail, captura pelo navegador e sistemas operacionais adicionais. | Cada integração informa disponibilidade e possui fluxo validado de uso e recuperação. |

O primeiro objetivo de produto é **selecionar várias vagas em Jobs, preparar suas candidaturas em uma fila, revisar cada resultado e acompanhar os envios no mesmo quadro**. Seleção múltipla sem fila, persistência e conexão com o board resolve apenas uma parte do problema.

## 5. Critérios transversais de aceitação

- Toda ação mostra sucesso, falha ou pendência por registro; resultados parciais de um lote permanecem disponíveis.
- Repetir uma operação não cria candidatura, card ou evento duplicado; criar uma nova candidatura para uma republicação deve ser uma decisão explícita.
- Currículo pronto e formulário preenchido permanecem distintos de candidatura enviada.
- Mover uma candidatura de etapa mantém o histórico do envio e dos documentos.
- Cancelar ou reiniciar uma execução preserva os resultados já validados.
- Arquivar uma oportunidade ou processo mantém entrevistas, contatos e documentos vinculados.
- Navegar e voltar preserva o contexto da lista, os rascunhos e a seleção do lote.
- A interface orienta a correção de dados, fontes, dependências e autenticação faltantes.
- A revisão do portal continua vinculada à candidatura e ao PDF escolhido, inclusive no modo em lote.
- Implementações futuras seguem o checklist completo do [AGENTS.md](../AGENTS.md), além das verificações específicas do fluxo alterado.

## 6. Referências da análise no repositório

| Evidência | Arquivos |
| --- | --- |
| Telas existentes e navegação | [workspace-pages.ts](../web/src/routes/workspace-pages.ts), [navigation-items.ts](../web/src/routes/navigation-items.ts), [router.ts](../web/src/router.ts). |
| Busca e vagas | [search.tsx](../web/src/routes/search.tsx), [jobs.tsx](../web/src/routes/jobs.tsx), [ações de vagas](../src/jobs/http.ts). |
| Seleção individual, geração, preenchimento e confirmação | [apply.tsx](../web/src/routes/apply.tsx), [serviço de preparação](../src/preparation/service.ts), [contratos](../src/preparation/types.ts). |
| Lista de candidaturas e origem dos dados | [applications.tsx](../web/src/routes/applications.tsx), [queries.ts](../src/server/queries.ts). |
| Filtro do board por etapa e cadastro manual sem vínculo de vaga | [store.ts](../src/applications/store.ts), [types.ts](../src/applications/types.ts), [application-board.tsx](../web/src/routes/application-board.tsx). |
| Estados, vínculos e persistência | [schema.ts](../src/db/schema.ts), [inicialização do banco](../src/db/index.ts), [store de preparação](../src/preparation/store.ts). |
| Limite de sessão e interação do agente | [launch.tsx](../web/src/routes/launch.tsx), [agent.ts](../web/src/lib/agent.ts), [sessão ACP](../src/acp/session.ts). |
| Demais áreas | [profile.tsx](../web/src/routes/profile.tsx), [recruiters.tsx](../web/src/routes/recruiters.tsx), [outreach.tsx](../web/src/routes/outreach.tsx), [interviews.tsx](../web/src/routes/interviews.tsx), [answers.tsx](../web/src/routes/answers.tsx), [activity.tsx](../web/src/routes/activity.tsx), [settings.tsx](../web/src/routes/settings.tsx). |
| Documentos e identidade | [PDF viewer](../web/src/components/pdf-viewer.tsx), [fontes do currículo](../web/src/components/resume-sources.tsx), [perfil configurável](../web/src/components/settings-profile.tsx). |
| Capacidades de CLI e limites de plataforma | [docs/desenvolvimento.md](desenvolvimento.md), [exportação Typst](../src/cli/export.ts). |

Este arquivo é documentação de produto. Não altera o comportamento do aplicativo nem executa candidaturas, contatos ou integrações.
