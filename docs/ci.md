# CI, quality gate, performance e caches

Os pull requests destinados à `main` executam workflows independentes por camada.
Nenhum workflow roda em push ou merge na `main`; cada um tem seu próprio grupo de
concorrência por PR e cancela a execução anterior do mesmo PR. Os disparos são
abertura, atualização, reabertura e saída de draft.

| Workflow | Responsabilidade |
| --- | --- |
| `backend-ci.yml` | Audit, lint e typecheck do backend, CLI, Electron main/preload e fontes E2E; unitários com cobertura; quality gate; integração em job próprio |
| `frontend-ci.yml` | Audit, lint e typecheck de `web`; unitários e componentes com cobertura; quality gate |
| `quality-gate.yml` | Workflow reutilizável chamado por cada CI com a camada correspondente |
| `performance.yml` | Microbenchmarks do backend e do frontend comparados com a baseline do commit-base |
| `e2e.yml` | Suíte Electron/Playwright existente |

Backend CI e Frontend CI não dependem um do outro: quando ambos são acionados,
rodam em paralelo. A integração fica em um job próprio do Backend CI e não atrasa
o Frontend CI.

## Filtros por caminho

- **Backend CI:** `src/`, `desktop/`, `resources/`, `e2e/`, `scripts/`,
  `benchmarks/`, configurações de Electron, TypeScript, Vitest e Playwright do
  backend.
- **Frontend CI:** `web/` e os contratos importados pelo frontend,
  `src/applications/types.ts` e `src/preparation/types.ts`.
- **Ambos:** `package.json`, `package-lock.json`, `eslint.config.mjs`, scripts e
  baselines dos gates (`scripts/ci/`, `scripts/*.cjs`, `scripts/*.json`) e o
  workflow reutilizável.
- **Performance e E2E** rodam em todo PR. Performance escolhe as camadas pelos
  arquivos alterados; sem baseline no commit-base, mede ambas.

`npm run test:infra` inclui `scripts/workflows.test.cjs`, que verifica disparos,
concorrência e os filtros para mudanças exclusivas de backend, frontend,
contratos compartilhados, lockfile e documentação.

## Execução de cada camada

Cada job usa Ubuntu 24.04, Node 24 e `npm ci --prefer-offline --no-audit` na raiz
(lockfile único e workspace `web`). O audit é uma etapa própria:
`npm run audit:ci` audita a raiz e o workspace, incluindo dependências de
desenvolvimento; advisories **critical bloqueiam** e **high geram aviso**.

A suíte unitária de cada camada roda **uma única vez**, já com cobertura
(`npm run test:backend:coverage` ou `npm run test:frontend:coverage`). O lint
(`npm run lint:<camada>`) grava `reports/<camada>/eslint.json`. Cobertura e
ESLint recebem um arquivo `*.provenance.json` com camada, tipo, commit, run,
tentativa, digest das fontes da camada e SHA-256 do relatório. Só uma suíte que
passou gera esse carimbo.

O job de checks publica `coverage/<camada>/unit/` e `reports/<camada>/` como
artifact `<camada>-checks-<run>-<tentativa>`, mesmo quando uma etapa falha. O
quality gate baixa somente esse artifact. Relatórios ausentes, inválidos,
alterados, de outra camada, de outra execução ou de fontes diferentes reprovam o
gate. Para repetir uma execução, use **Re-run all jobs**: repetir apenas o gate
muda a tentativa e, por isso, rejeita o artifact anterior.

A integração instala `latexmk`, `texlive-latex-base` e `poppler-utils`. As
dependências gráficas e o Xvfb continuam somente no E2E.

## Quality gate

`scripts/quality-gate.cjs` adapta o comparador do Gestão Solo para avaliar uma
camada por vez:

- cobertura V8 de statements, branches, funções e linhas com piso de **80% por
  camada** e sem regressão frente à baseline;
- escopo de cobertura completo: todos os arquivos de produção do escopo
  configurado aparecem no relatório, inclusive os não importados pelos testes;
- ESLint com zero erros e avisos;
- duplicação (JSCPD, mínimo de 5 linhas e 50 tokens, modo strict) sem aumento de
  percentual nem de fragmentos;
- no máximo **350 linhas por arquivo** e **100 linhas por função**, incluindo
  métodos, arrow functions e callbacks.

Tamanho e duplicação analisam apenas o código de produção da camada (`src` e
`desktop/src`, ou `web/src`), sem testes, benchmarks, declarações ou código
gerado. O escopo de cobertura e as exclusões documentadas do backend ficam em
`scripts/ci/layers.json`, lido tanto pelos configs do Vitest quanto pelo gate.

No CI, a baseline vem do commit-base do PR (`scripts/quality-baseline.json`).
Assim, alterar a baseline no próprio branch não enfraquece a comparação. Enquanto
a `main` não tiver baseline, o gate usa a versão do branch como bootstrap, mas
mantém pisos e limites absolutos. Os relatórios ficam em
`reports/<camada>/quality-gate.md`, `.json` e `quality-candidate-baseline.json`,
e são publicados no resumo do job e como artifact.

Códigos de saída: `0` aprovado, `1` regressão ou violação, `2` entrada ausente
ou inválida.

### Execução local

```bash
npm run lint
npm run test:backend:coverage
npm run test:frontend:coverage
npm run quality:check      # ambas as camadas e total ponderado
npm run quality:backend    # somente uma camada
npm run quality:frontend
```

`npm run quality:check` grava `reports/quality-gate.md` com o total ponderado
quando há relatórios atuais das duas camadas. Atualize a baseline somente após
uma mudança revisada de política ou de patamar:
`node scripts/quality-gate.cjs --update-baseline`. A atualização exige as duas
camadas, recusa métricas que violam a política e é bloqueada com `CI=true`.

## Performance

Os microbenchmarks usam a fixture `bench` do Vitest 5 em projetos de benchmark
dedicados, com dados sintéticos fixos, aquecimento, execução sequencial
(`maxWorkers: 1`, sem paralelismo de arquivos) e verificação dos resultados
antes e depois da medição:

| Camada | Cenários |
| --- | --- |
| Backend (`benchmarks/backend.bench.ts`) | Correspondência de 100 campos ATS; avaliação de 10.000 tentativas de outreach |
| Frontend (`web/benchmarks/frontend.bench.ts`) | Filtragem de 5.000 candidaturas; montagem de histórico com 2.000 eventos |

`scripts/benchmark-gate.cjs` lê o reporter JSON atual
(`testResults[].assertionResults[].benchmarks[].tasks[]`) e bloqueia perda de
throughput **superior a 20%**, cenários removidos e resultados inválidos ou com
verificações falhas. Cenários novos geram aviso até entrarem na baseline.

```bash
npm run benchmark            # backend e frontend
npm run performance:check    # compara com scripts/benchmark-baseline.json
```

A primeira baseline é produzida no runner do CI. Sem
`scripts/benchmark-baseline.json` no commit-base, o workflow mede as duas
camadas em modo bootstrap e publica `reports/benchmark-candidate-baseline.json`
(com `"kind": "bootstrap"`, Node, sistema, arquitetura e run) no artifact
`performance-<run>-<tentativa>`. Incorpore esse arquivo como
`scripts/benchmark-baseline.json`; depois do merge, os PRs seguintes passam a ser
comparados com ele. Localmente, sem baseline, `performance:check` também roda em
bootstrap, mas isso não conta como verificação: gere a baseline a partir do
código da `main` no próprio worktree e compare com ela, conforme o `AGENTS.md`.
Com a baseline do CI, a comparação local é apenas indicativa, porque depende da
máquina.

## Caches

- **CI:** cache de downloads do npm (`setup-node`) e de downloads do Electron e
  electron-builder, restaurado antes do `npm ci`.
- **Ferramentas:** ESLint (cache por conteúdo), TypeScript incremental e
  transformações persistentes do Vitest ficam em `.cache/work-tracker/`, ignorado
  pelo Git, separados em `backend`, `frontend`, `integration` e `benchmarks`.
  As chaves do CI combinam sistema, arquitetura, versão do Node, lockfile,
  configurações e fontes relevantes, com restauração parcial sem o hash das
  fontes.
- **Worktrees:** `scripts/create-worktree-local.sh` copia `.cache/work-tracker`
  como cópia independente (`--reflink=auto`) e tolera a ausência do diretório.
  Os caches globais de npm, Electron e electron-builder continuam reutilizados.

Os caches apenas aceleram as ferramentas: testes, cobertura, integração, E2E,
audit e benchmarks rodam em toda validação. Entradas vinculadas a caminhos ou
conteúdos antigos são invalidadas pela própria ferramenta. Na implementação, a
execução com cache aquecido reduziu lint de 3,3 s para 1,4 s e typecheck de
5,4 s para 2,5 s, com relatórios de cobertura idênticos aos da execução fria.
