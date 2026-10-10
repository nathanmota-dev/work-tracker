# Cobertura unitária do backend

Registro da implementação em 2026-10-10, Linux, Node 24.18.0, Vitest 5.0.3 e coverage-v8 5.0.3.

Foram verificados **327 testes unitários em 32 arquivos**, **70 testes de integração em 5 arquivos**, a compilação da CLI e `npx tsc --noEmit -p tsconfig.node.json`. Todos passaram. As integrações são os casos anteriores reorganizados, sem novos cenários.

Cobertura total: **98.72% de statements**, **95.37% de branches**, **95.45% de funções** e **99.07% de linhas**. Não há meta percentual.

Os percentuais medem execução dos unitários, com I/O simulado. As integrações validam separadamente o SQL e a persistência reais. Uma linha executada ainda pode ter branches não exercitados. A coluna de lacunas inclui linhas de branches/funções não executados mesmo quando a cobertura de linhas é 100%. “—” significa que o V8 não apontou lacunas de execução.

## Resultado por arquivo

| Módulo | Statements | Branches | Funções | Linhas | Lacunas restantes |
| --- | ---: | ---: | ---: | ---: | --- |
| [src/acp/client.ts](../src/acp/client.ts) | 99.19% | 93.15% | 96.42% | 100.00% | Falha de callback de update/log, mensagem JSON sem método, resultado ausente e exceções que não são Error nos callbacks. Linhas: 82, 184, 190, 216, 226, 237. |
| [src/acp/process.ts](../src/acp/process.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/acp/providers.ts](../src/acp/providers.ts) | 100.00% | 96.77% | 100.00% | 100.00% | Seleção OpenCode sem configuração inline herdada ou personalizada. Linhas: 80. |
| [src/acp/session.ts](../src/acp/session.ts) | 100.00% | 97.82% | 100.00% | 100.00% | Fallback do displayName quando não há valor salvo nem parâmetro explícito. Linhas: 139. |
| [src/adapters/registry.ts](../src/adapters/registry.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/cli/doctor.ts](../src/cli/doctor.ts) | 100.00% | 83.33% | 100.00% | 100.00% | Expansões .cmd/.exe no Windows; fora do escopo Linux. Linhas: 6. |
| [src/cli/export.ts](../src/cli/export.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/cli/fetch-profile.ts](../src/cli/fetch-profile.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/cli/flags.ts](../src/cli/flags.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/cli/import-journey.ts](../src/cli/import-journey.ts) | 96.66% | 85.96% | 100.00% | 100.00% | Headers repetidos e algumas células undefined; vários fallbacks são inacessíveis após validar a quantidade de células. Linhas: 23, 30, 33, 42, 49, 50, 51, 60. |
| [src/cli/init.ts](../src/cli/init.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/cli/linkedin.ts](../src/cli/linkedin.ts) | 95.45% | 87.50% | 100.00% | 100.00% | Plataforma diferente de Linux e fallback de executável ausente. Linhas: 8, 14. |
| [src/cli/match.ts](../src/cli/match.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/cli/outreach.ts](../src/cli/outreach.ts) | 100.00% | 97.18% | 100.00% | 100.00% | Exceções que não são Error na atualização/retirada. Linhas: 74, 189. |
| [src/cli/records.ts](../src/cli/records.ts) | 100.00% | 98.97% | 100.00% | 100.00% | Score sem --signals. Linhas: 70. |
| [src/cli/recruiter.ts](../src/cli/recruiter.ts) | 100.00% | 98.27% | 100.00% | 100.00% | Exceção que não é Error no sync. Linhas: 92. |
| [src/cli/run.ts](../src/cli/run.ts) | 100.00% | 87.23% | 100.00% | 100.00% | Subcomando omitido em outreach, job, interview, application, answer e linkedin. Linhas: 116, 120, 129, 132, 135, 157. |
| [src/cli/skills.ts](../src/cli/skills.ts) | 96.42% | 87.50% | 90.00% | 95.23% | ensureSkillsSource apenas delega (sem teste exclusivo); caminho padrão da CLI empacotada. Linhas: 12, 26. |
| [src/db/index.ts](../src/db/index.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/db/notify.ts](../src/db/notify.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/db/sqlite.ts](../src/db/sqlite.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/match/matcher.ts](../src/match/matcher.ts) | 93.33% | 91.48% | 100.00% | 93.84% | Label vazio, empate ambíguo, ramo de string vazia na distância e fallback de união de tokens. Linhas: 63, 104, 148, 149, 150, 174, 179, 180. |
| [src/mcp/config.ts](../src/mcp/config.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/mcp/linkedin.ts](../src/mcp/linkedin.ts) | 100.00% | 92.85% | 91.66% | 100.00% | Callback de conexão antiga fechada e erro ao fechar o transporte em closeMcp. Linhas: 22, 47. |
| [src/mcp/search.ts](../src/mcp/search.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/mcp/transport.ts](../src/mcp/transport.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/outreach/core.ts](../src/outreach/core.ts) | 100.00% | 98.07% | 100.00% | 100.00% | Estado de origem desconhecido, fora da união de tipos. Linhas: 50. |
| [src/outreach/store.ts](../src/outreach/store.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/paths.ts](../src/paths.ts) | 100.00% | 100.00% | 100.00% | 100.00% | — |
| [src/recruiter/sync.ts](../src/recruiter/sync.ts) | 100.00% | 92.85% | 100.00% | 100.00% | Detecção com nomes/usernames vazios e referência sem text. Linhas: 116, 118, 174. |
| [src/server/index.ts](../src/server/index.ts) | 98.68% | 92.10% | 93.10% | 100.00% | Remoção do socket ao fechar, JSON malformado no sync, alguns campos opcionais ausentes na busca de pessoas/detalhes e fallbacks do adaptador HTTP. Linhas: 115, 138, 181, 183, 202, 210, 322, 323, 324, 328, 334. |
| [src/server/queries.ts](../src/server/queries.ts) | 87.03% | 97.14% | 61.11% | 84.78% | Leituras diretas de recruiters/jobs/metrics/interviews/applications/answers/activity; verificadas pela integração, sem testes exclusivos de delegação. Linhas: 89, 90, 120, 121, 130, 131, 140, 141, 149, 150, 162, 163, 171, 172. |

## Exclusões e reprodução

A medição exclui testes e seus helpers, declarações de tipos, versão gerada, schema e sinônimos estáticos, o stub de retirada de convite e os wrappers da CLI (setup/detect-portal). O ponto de entrada da CLI também fica fora da medição: os unitários exercitam o despacho em runCli, e as integrações usam o bundle real. As consultas simples que ficam no mesmo arquivo das transformações continuam visíveis na tabela.

Os unitários ficam ao lado do módulo. O setup impede I/O real nas fronteiras usadas pelo backend, e os doubles fornecem respostas explícitas de statements e eventos de processos, sem interpretar SQL. SQLite em memória pertence à integração. Estado dos caches/conexões é reiniciado nas suítes que o mantêm; ambiente, mocks, globais e timers são restaurados entre casos.

Para atualizar a medição, execute `npm run test:backend:coverage`. Os relatórios completos e atuais são `coverage/backend/unit/index.html` e `coverage/backend/unit/coverage-final.json`, ignorados pelo Git. Esta tabela é um registro da implementação, não é regenerada automaticamente.
