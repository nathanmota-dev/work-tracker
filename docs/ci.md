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
| `performance.yml` | Microbenchmarks do backend e do frontend do commit-base e do PR, medidos no mesmo job e comparados |
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
  arquivos alterados (`scripts/ci/benchmark-layers.cjs`).

`npm run test:infra` inclui `scripts/workflows.test.cjs`, que verifica disparos,
concorrência e os filtros para mudanças exclusivas de backend, frontend,
contratos compartilhados, lockfile e documentação, além da seleção de camadas e
da estrutura do workflow de performance.

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

A integração instala `latexmk`, `texlive-latex-base`, `texlive-latex-recommended`,
`texlive-latex-extra`, `texlive-fonts-recommended`, `texlive-fonts-extra` e `poppler-utils`,
que cobrem os pacotes do preâmbulo do currículo base gerado. As
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
verificações falhas. Cenários que existem no PR e não no commit-base geram aviso,
sem bloquear.

Nenhuma baseline de benchmark é versionada. Os números dependem da máquina: um
arquivo medido em outro hardware bloqueia PRs sem regressão ou libera regressões
reais (no PR #58, uma baseline local cerca de 40% mais rápida que o runner
reprovou cenários que o PR nem alterava). Por isso, o commit-base e a mudança são
sempre medidos **na mesma máquina e na mesma execução**:

- `--capture <arquivo>` mede a árvore atual e grava a medição fora do
  repositório (caminhos dentro dele são recusados, para que nunca seja
  commitada);
- `--baseline <arquivo>` compara a árvore atual com essa medição.

Cada medição registra Node, sistema, arquitetura, uma impressão digital da
máquina (hostname, modelo e quantidade de CPUs) e o run/tentativa do CI. O gate
recusa uma baseline com qualquer um desses campos diferente, inclusive um arquivo
antigo sem impressão digital.

### CI

O `performance.yml` usa um único job:

1. faz checkout do `head.sha` em `pr-head/` e do `base.sha` em `pr-base/`;
2. escolhe as camadas pelo diff entre os dois commits;
3. instala as dependências do head e roda `npm run test:infra` com os scripts do
   PR;
4. instala as dependências do base, mede as camadas selecionadas e grava a
   medição com `--capture`;
5. copia `scripts/benchmark-gate.cjs`, `scripts/ci/benchmark.cjs` e
   `scripts/ci/common.cjs` do base para o head, mede o head com eles e compara
   com `--baseline`.

Assim, o executor e o gate que medem e julgam o PR são os do commit-base:
alterar o gate, o limite ou o executor no PR não muda a régua aplicada a ele. As
mudanças nesses scripts continuam cobertas pelo `test:infra` do próprio PR. O
relatório indica `main@<sha> (measured on this runner)` e mostra as duas
medições; o artifact `performance-<run>-<tentativa>` inclui os relatórios brutos
do base e do head e `base-benchmarks.json`. Falhas em qualquer medição, na
comparação ou no `test:infra` bloqueiam o job. Sem camada selecionada, nada é
medido e o relatório indica as camadas ignoradas.

Enquanto o commit-base for anterior a este fluxo (sem `--capture`), o workflow
mede as duas camadas do base com o modo bootstrap antigo e as compara usando o
gate antigo. Depois que a `main` contiver este fluxo, esse ramo deixa de ser
usado e pode ser removido.

### Execução local

```bash
npm run benchmark                        # mede apenas a árvore atual
npm run performance:check                # mede a main e o commit atual e compara
npm run performance:check -- --base origin/main
```

`npm run performance:check` (`scripts/performance-compare.cjs`) exige árvore
limpa (inclusive sem arquivos não rastreados), então commite a mudança antes. Ele
muda para o base em `--detach`, roda `npm run benchmark`, grava a medição em um
diretório temporário, volta para o branch de origem (também após falha ou
Ctrl+C), mede o branch e compara. O gate usado é o do branch, carregado antes da
troca. As dependências instaladas são as do branch; se o PR alterar o lockfile, a
medição do base usa esse `node_modules`.

### Limite, ruído e acúmulo

O limite continua em 20%. Em 10 execuções locais de `npm run performance:check`
sem mudança de código medido (A/A, `main` contra o branch), a maior diferença
foi de 5,3% (ATS 2,9%, outreach 3,9%, filtragem 5,3%, histórico 3,0%). Medições
espaçadas no tempo, com outras cargas na máquina, variaram bem mais (até ~55% no
primeiro cenário de uma medição), o que reforça medir base e head em sequência.
O ruído entre base e head no mesmo runner do GitHub ainda não foi medido com 10
execuções; reduzir o limite para ~10% só deve acontecer depois disso.

Cada PR é comparado com o seu próprio commit-base, então várias perdas abaixo do
limite podem se acumular sem que nenhum PR falhe. Para acompanhar a tendência,
compare periodicamente a `main` com uma referência mais antiga, por exemplo
`npm run performance:check -- --base <tag>`. Um job agendado com essa comparação
é uma melhoria possível; hoje nenhum workflow roda fora de PRs.

## Caches

- **CI:** cache de downloads do npm (`setup-node`) e de downloads do Electron e
  electron-builder, restaurado antes do `npm ci`.
- **Electron E2E / apt:** `awalsh128/cache-apt-pkgs-action` v1.6.3, fixado
  por SHA completo, instala e cacheia os arquivos dos pacotes e suas dependências.
  A lista inclui o equivalente a `playwright install-deps chromium` no Ubuntu
  24.04, além de Xvfb, Xauth, GTK, LaTeX e Poppler. `test:infra` compara essa lista
  com o dry-run do Playwright instalado. A versão `electron-e2e-apt-v1` inclui
  sistema, arquitetura, distribuição, imagem do runner, lockfile e script de
  instalação; incremente `v1` para invalidar manualmente. Mudanças na lista ou
  no Playwright invalidam o cache automaticamente. Somente o E2E usa esse cache.
  A configuração gerada em `/etc/texmf`, `/var/lib/texmf`, `/var/cache/fontconfig`
  e `/etc/fonts/conf.d` é preservada em um tar separado via `actions/cache`
  v4.2.4 (SHA completo), com a mesma versão e sem restauração parcial. Isso mantém
  os formatos TeX e as fontes sem repetir os triggers do dpkg em cada hit.
  Antes do E2E, o script atualiza o linker e compila um documento real com
  `latexmk`, verificando o PDF com `pdfinfo` e `pdftotext`. Falha de qualquer
  cache, configuração ausente ou probe inválido aciona uma instalação apt normal
  com `--no-install-recommends`. Erros reais de instalação/compilação bloqueiam o
  job. `test:infra` verifica hit, miss e os fallbacks. Build e execução da suíte
  permanecem iguais. Para medir, compare Cache + Restore + Validate + Save na
  primeira execução e em **Re-run all jobs** no mesmo commit, confirmando os dois
  hits na segunda. A primeira pode ser encerrada após salvar os dois caches;
  a segunda deve concluir a suíte E2E.
- **Ferramentas:** ESLint (cache por conteúdo), TypeScript incremental e
  transformações persistentes do Vitest ficam em `.cache/work-tracker/`, ignorado
  pelo Git, separados em `backend`, `frontend`, `integration` e `benchmarks`.
  As chaves do CI combinam sistema, arquitetura, versão do Node, lockfile,
  configurações e fontes relevantes, com restauração parcial sem o hash das
  fontes. O workflow de performance não restaura o cache de `benchmarks`, porque
  mede duas árvores; cada medição começa com o mesmo estado.
- **Worktrees:** `scripts/create-worktree-local.sh` copia `.cache/work-tracker`
  como cópia independente (`--reflink=auto`) e tolera a ausência do diretório.
  Os caches globais de npm, Electron e electron-builder continuam reutilizados.

Os caches apenas aceleram as ferramentas: testes, cobertura, integração, E2E,
audit e benchmarks rodam em toda validação. Entradas vinculadas a caminhos ou
conteúdos antigos são invalidadas pela própria ferramenta. Na implementação, a
execução com cache aquecido reduziu lint de 3,3 s para 1,4 s e typecheck de
5,4 s para 2,5 s, com relatórios de cobertura idênticos aos da execução fria.
