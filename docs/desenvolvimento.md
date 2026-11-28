# Work Tracker — desenvolvimento e operação

Aplicativo Electron com backend Node independente, importado do Mercury 0.9.1.
O backend inclui SQLite, API HTTP/WebSocket, CLI, clientes MCP, sessões ACP,
matching de formulários e sete skills próprias. A interface React se conecta à
API pelo preload e inclui uma tela Apply para gerar currículos por vaga,
comparar PDFs e preparar o preenchimento de candidaturas.

## Desenvolvimento

Requer **Node.js 24 ou superior**, npm e ambiente gráfico para Electron.

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm start
npm run package
```

`dev` compila a CLI e acompanha alterações do backend e desktop com electron-vite.
Alterações na CLI exigem `npm run build:cli` para atualizar a CLI usada pelos agentes.
`out/` é exclusivamente saída gerada; o AppImage é gerado em `release/`.
As execuções locais usam `--no-sandbox` por compatibilidade com AppArmor.
O pacote mantém o sandbox padrão; em hosts que o bloqueiam, passe `--no-sandbox`
explicitamente ao executável.

## Instalação por release e atualização dentro do app

Cada versão publicada em GitHub Releases traz um AppImage
(`work-tracker-X.Y.Z-x86_64.AppImage`). Baixe, torne executável
(`chmod +x`) e execute de uma pasta onde seu usuário possa escrever. O app
verifica atualizações a cada 12 horas; em **Settings → Updates** você também
pode verificar na hora, baixar e reiniciar na nova versão. O build instalado
pelo menu de aplicativos (abaixo) não se atualiza sozinho. Veja
[docs/releases.md](releases.md) para publicar uma versão.

## Instalação no Linux pelo menu de aplicativos

A instalação por usuário copia o aplicativo completo para
`~/.local/opt/work-tracker` e registra **Work Tracker** no menu de aplicativos.
Ela não exige `sudo` e usa o ícone do projeto. Os dados continuam separados em
`~/.work-tracker` (ou no override `WORK_TRACKER_HOME`).

Use a worktree que está na branch `main`; consulte `git worktree list` para
identificá-la. No checkout atual, o caminho é
`/mnt/linux-data/projects/git/work-tracker`. Para instalar o último commit da
`main`, esse checkout também deve estar sem alterações locais de código: o build
inclui as alterações presentes nos arquivos, mesmo que ainda não tenham commit.

Com as dependências npm instaladas, feche o Work Tracker e execute o bloco abaixo
na raiz dessa worktree. Além dos requisitos de desenvolvimento, ele usa `rsync`,
`desktop-file-validate` e `update-desktop-database` (os dois últimos são fornecidos
por `desktop-file-utils`).

```bash
(
  set -eu
  if [ "$(git branch --show-current)" != "main" ]; then
    printf '%s\n' 'Execute na worktree da branch main.' >&2
    exit 1
  fi

  npm run build
  ./node_modules/.bin/electron-builder --linux --dir --config desktop/electron-builder.yml

  install_dir="$HOME/.local/opt/work-tracker"
  applications_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  desktop_file="$applications_dir/dev.nathanmota.worktracker.desktop"
  mkdir -p "$install_dir" "$applications_dir"
  rsync -a --delete release/linux-unpacked/ "$install_dir/"
  cp web/src/public/logo.png "$install_dir/icon.png"

  cat > "$desktop_file" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Work Tracker
Comment=Organize sua busca de emprego e acompanhe candidaturas
Exec="$install_dir/work-tracker-app" --no-sandbox
TryExec=$install_dir/work-tracker-app
Path=$install_dir
Icon=$install_dir/icon.png
Terminal=false
Categories=Office;
StartupNotify=true
StartupWMClass=work-tracker-app
EOF

  chmod 644 "$desktop_file"
  desktop-file-validate "$desktop_file"
  update-desktop-database "$applications_dir"
)
```

Procure **Work Tracker** no menu de aplicativos. Para testar o mesmo atalho pelo
terminal:

```bash
gio launch "${XDG_DATA_HOME:-$HOME/.local/share}/applications/dev.nathanmota.worktracker.desktop"
```

`--no-sandbox` é o argumento usado na instalação validada neste Ubuntu, conforme
a compatibilidade com AppArmor descrita acima. O atalho aponta para a cópia
instalada e continua funcionando se o checkout mudar de branch ou de lugar.

### Atualizar durante o desenvolvimento, somente a partir da main

Não é necessário gerar um AppImage nem recriar o atalho a cada atualização.
Feche o app e execute na worktree da `main`:

```bash
(
  set -eu
  if [ "$(git branch --show-current)" != "main" ]; then
    printf '%s\n' 'Execute na worktree da branch main.' >&2
    exit 1
  fi

  npm run build
  ./node_modules/.bin/electron-builder --linux --dir --config desktop/electron-builder.yml
  rsync -a --delete release/linux-unpacked/ "$HOME/.local/opt/work-tracker/"
  cp web/src/public/logo.png "$HOME/.local/opt/work-tracker/icon.png"
)
```

`npm run build` atualiza `out/`; `electron-builder --dir` monta o aplicativo com
o runtime Electron, dependências, CLI e recursos em `release/linux-unpacked`,
sem gerar AppImage. A cópia dessa pasta atualiza o aplicativo que abre pelo menu,
preservando seus dados. Execute a instalação completa primeiro para criar o
atalho e os diretórios.

Se o último `npm run build` nessa worktree já foi feito na `main` e, desde então,
não houve alterações de código/dependências, troca de branch ou execução de
`npm run dev`, pode omitir apenas a etapa `npm run build` e reutilizar `out/`.
As pastas geradas não registram a branch ou o commit de origem; se houver dúvida,
refaça o build na `main` antes de instalar.

A atualização é manual: só executar `npm run build` não altera a instalação.
Uma build em outra branch ou worktree também não a atualiza; ela continua usando
a última versão copiada da `main`.

## Execução isolada e CLI

```bash
npm run build:cli
export WORK_TRACKER_HOME="/tmp/work tracker exemplo"
node out/cli/work-tracker.cjs init
node out/cli/work-tracker.cjs setup
node out/cli/work-tracker.cjs doctor
node out/cli/work-tracker.cjs serve
```

O servidor anuncia endereço, porta e token em JSON. `Ctrl+C` encerra suas conexões.
A CLI possui `--help`, `fetch-profile`, `recruiter`, `job`, `metric`, `score`,
`interview`, `application`, `answer`, `activity`, `outreach`, `match`,
`detect-portal`, `export` e importação **explícita** de um arquivo `import-journey`.
`dashboard` é um alias legado de `serve`, sem servir a UI antiga.

Sem override, os dados do app ficam em `~/.work-tracker`; a sessão do LinkedIn MCP
fica no perfil padrão do próprio servidor (`~/.linkedin-mcp/profile`):

```text
work-tracker.db             SQLite, WAL, foreign keys, migrações versionadas
config.json                configuração própria, inicialmente {}
backend.lock               porta, token aleatório e PID; removido ao encerrar
logs/backend.log           saída do backend na sessão atual (a anterior fica em .previous)
workspace/                 cwd privado dos agentes e skills work-tracker-*
artifacts/                 artefatos gerados
bin/                       wrapper work-tracker disponível no PATH dos agentes
agents/                    configuração/autenticação privada dos providers
browsers/linkedin/profile/ perfil legado, preservado para recuperação
browsers/chrome/profile/   perfil da janela de login aberta pelo app
backups/                   cópias consistentes antes de migrações incompatíveis
```

Versões do esquema, verificações de integridade e recuperação a partir de uma
cópia pré-migração estão em [Migrações do banco e recuperação](database-migrations.md).

Não há leitura de banco, configuração, skills ou checkout do Mercury, instalação
automática de MCPs ou atualizador externo. `setup` copia apenas recursos deste app
para seu workspace; não instala skills nos diretórios globais dos agentes.
A versão da CLI vem do `package.json`. Código e licença de origem estão em
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Dependências locais e configuração

### Currículo pessoal e exemplos

O currículo base é gerado a partir do perfil; não há projeto LaTeX para preparar.
O usuário envia em **Profile → Import resume** uma fonte estruturada: o
`resume-data.json` (formato em [`base/README.md`](../base/README.md)) ou o PDF do
LinkedIn. As duas se substituem, com confirmação. Outros PDFs enviados ficam como
currículos de referência. Tudo fica em `~/.work-tracker/profile`.

Os PDFs são lidos com Poppler (`pdftotext -bbox-layout` para o export do
LinkedIn, `pdftotext -layout` para os demais) e o resultado fica em cache por hash
em `profile_imports`. O export do LinkedIn é convertido para o formato do JSON
(`src/profile/linkedin-data.ts`), e o perfil chega ao agente em `profile.json`, com
o texto dos currículos de referência em `profileSources.references` (veja
`src/profile/`). Na CLI, `work-tracker profile sources` mostra os arquivos e
`work-tracker profile import [--force]` importa a pasta.

Antes de cada snapshot do currículo base, `src/resume/` gera
`~/.work-tracker/resume/resume.tex` a partir do perfil, com um preâmbulo fixo
(`src/resume/template.ts`) e os dados pessoais editados no Profile com
prioridade. O arquivo só é regravado quando muda, e a versão das fontes muda junto
com o perfil: prévias, currículos salvos e o Apply seguem essa versão. Arquivos
colocados à mão na pasta de perfil também são importados sem clique: o backend
importa o que estiver pendente ao iniciar, acompanha a pasta (`fs.watch`) e, como
reserva, importa o que estiver pendente quando a tela é lida. A tela **Apply** está
no menu e nos botões de preparação de Jobs e Applications. Ela mostra o PDF base,
gera um currículo no idioma da vaga usando o agente ACP selecionado, registra
versões e relatórios, e preenche o portal com o PDF escolhido para revisão e envio
manual.

A compilação exige `latexmk`, `pdflatex`, `pdfinfo` e `pdftotext` (Poppler),
além dos pacotes LaTeX Roboto, titlesec, enumitem e fancyhdr. Instale-os
com TeX Live, TinyTeX ou MiKTeX e disponibilize os executáveis no PATH. A tela
mostra as dependências ausentes e a CLI `doctor` também as verifica.

Cada execução trabalha sobre uma cópia do currículo base em
`$WORK_TRACKER_HOME/artifacts/applications/`. Histórico e PDFs anteriores
permanecem disponíveis quando uma nova execução falha.

### Executáveis e integrações

Banco e API abrem mesmo sem MCPs ou agentes instalados. `doctor` verifica os
executáveis; ausência de login, compatibilidade de ferramentas e conectividade
são verificadas quando a funcionalidade é solicitada.

Os MCPs padrão são instalados pelo app, em segundo plano, a cada início do
backend (e por `work-tracker setup`), somente quando faltam e somente para os
comandos padrão; um comando configurado em `config.json` nunca é instalado.
Tudo fica em `~/.work-tracker/bin` (primeiro no PATH dos MCPs e agentes) e
`~/.work-tracker/tools` (veja `src/mcp/install/`):

- `mcp-server-linkedin` (versão fixada): instalado com `uv tool install`, usando
  o `uv` do PATH ou uma versão fixada baixada do GitHub e verificada por SHA-256.
  O `uv` baixa o Python suportado; o servidor prepara o próprio navegador.
- `chrome-devtools-mcp` (versão fixada, dependência do app, copiada para
  `extraResources`): copiado para fora do pacote, já que o AppImage muda de
  caminho a cada execução, e iniciado com o Node do PATH, como a CLI. Sem
  Chrome/Chromium no computador, o app baixa o Chrome for Testing estável
  (`@puppeteer/browsers`) e o usa no MCP e no login.

Servidores que o usuário já instalou no PATH são mantidos. O estado
(`installing`, `ready`, `failed`, `custom`) aparece em
`/api/integrations/status` e em **Settings → Integrations**, com **Try again**
(`POST /api/integrations/install`). `WORK_TRACKER_SKIP_MCP_INSTALL=1` desliga a
instalação; os testes de integração e os smoke checks usam essa variável.
Instale manualmente os demais executáveis que quiser usar:

- `opencode` para ACP OpenCode.
- `claude` e `claude-code-acp` (adaptador `@zed-industries/claude-code-acp`) para ACP Claude Code.
- `typst`, opcional, somente para `work-tracker export`.

Exemplo de `config.json` (substitua os caminhos pelos executáveis locais):

```json
{
  "provider": "opencode",
  "mcp": {
    "linkedin": {
      "command": "/caminho/mcp-server-linkedin",
      "args": [],
      "env": {"TOOL_TIMEOUT": "180"}
    },
    "chrome": {
      "command": "/caminho/chrome-devtools-mcp",
      "args": ["--headless"],
      "env": {}
    }
  },
  "acp": {
    "opencode": {"command": "opencode", "args": ["acp"], "env": {}},
    "claude-code": {"command": "claude-code-acp", "args": [], "env": {}}
  }
}
```

Sem `acp`, os comandos padrão são `opencode acp --cwd <workspace>` e
`claude-code-acp`. Cada sessão recebe cwd, MCPs (comando/argumentos/ambiente),
skills empacotadas e a CLI no PATH. Para isolar configurações globais dos agentes,
o app define `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` e
`OPENCODE_CONFIG_DIR` dentro de seu diretório. Faça login nesses ambientes próprios
ou forneça as credenciais necessárias em `acp.<provider>.env`; o app não copia
credenciais de outros ambientes.

Ao abrir pelo menu do Linux, o app acrescenta ao PATH dos processos externos as
pastas existentes `~/.opencode/bin`, `~/.local/bin`, `~/.bun/bin` e as instalações
Node 24+ do NVM (em `$NVM_DIR` ou `~/.nvm`), priorizando a versão mais recente do
NVM sobre o Node do sistema. Isso permite encontrar os agentes sem depender da
configuração do terminal. O PATH herdado e os comandos personalizados continuam
disponíveis.

O modelo escolhido para uma execução é repassado mesmo com comandos ACP
personalizados, preservando as demais configurações do provider.
`/api/acp/providers` consulta os modelos anunciados na inicialização ACP com o
mesmo comando, ambiente e workspace privado das execuções. A consulta não envia
prompts nem fornece MCPs à sessão de descoberta; tem timeout de 15 segundos e
cache de cinco minutos, invalidado quando o comando ou ambiente muda. Se o agente
estiver indisponível ou não anunciar modelos, o fallback é `opus`, `sonnet` e
`haiku` para Claude Code, ou uma lista vazia para OpenCode.

O LinkedIn MCP usa seus argumentos e perfil persistente padrão, como no Mercury:
o app não injeta `--user-data-dir` nem `--no-auto-import`. Assim, uma sessão válida
de `~/.linkedin-mcp/profile` pode ser reutilizada, e o servidor pode importar uma
sessão do LinkedIn já aberta no Chrome. Para separar a sessão explicitamente,
configure `--user-data-dir` nos argumentos do LinkedIn; `--no-auto-import` também
é respeitado quando configurado. Os MCPs recebem os diretórios XDG do desktop,
sem herdar os diretórios privados do agente. O Chrome MCP inicia normalmente,
sem selecionar perfis do computador. Para login manual no perfil padrão:

```bash
uvx mcp-server-linkedin@latest --chrome-path /usr/bin/google-chrome --login
```

Para login Google no Chrome usado pelo agente, abra **Settings → Browser sign-in →
Open sign-in browser** antes da execução. O app inicia o Chrome normal com seu
perfil privado e uma porta de depuração dinâmica em `127.0.0.1`; o Chrome MCP se
conecta a essa janela. Mantenha-a aberta durante a execução. Ela continua aberta
entre execuções e é encerrada quando o app fecha. Nenhum executável é instalado
por essa ação: Chrome e Chrome MCP precisam estar disponíveis/configurados.
O comando Chrome é `google-chrome`, ou o `--executablePath`/`--channel` configurado
nos argumentos MCP. O app preserva `--chrome-arg`, `--proxyServer` e o ambiente
configurado ao abrir a janela.

Os perfis LinkedIn MCP e Chrome MCP são separados: cada um pode pedir seu próprio
login. A mensagem "login is still in progress" do LinkedIn é uma espera, e o agente
deve repetir a mesma ferramenta após cerca de 30 segundos sem reiniciar o servidor.
Se o agente encerrar o turno nessa espera, o app mantém o processo ACP e o navegador
abertos. Conclua o login e clique em **Retry after sign-in**: a mesma sessão é
reutilizada com o mesmo provider/modelo/configuração. **Cancel** ou fechar o app
encerra a sessão; mudar de provider/modelo/configuração também inicia outra conexão.
Uma tarefa auxiliar marcada Completed não indica que o login terminou.
Quando o Google fica em loop no navegador do LinkedIn MCP, entre no LinkedIn pelo
Chrome habitual e tente novamente. Um login no Gmail sozinho não autentica o LinkedIn;
Settings → Browser sign-in autentica o Chrome MCP, não o LinkedIn MCP.
O painel do agente reúne as atualizações de uma chamada no mesmo cartão e mantém
comandos, argumentos, saídas e diagnósticos recolhidos.

Conexões Chrome explícitas com `--browser-url`/`--browserUrl` ou `--ws-endpoint`/
`--wsEndpoint` usam a janela indicada e não recebem `--userDataDir`, pois são modos
de conexão, não de lançamento. Uma configuração explícita `--autoConnect` segue
o comportamento padrão do Chrome MCP. A conexão explícita tem
precedência sobre uma janela aberta pelo app. Esse fluxo segue a
[documentação do Chrome MCP para login em navegador existente](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md#connecting-to-a-running-chrome-instance).

`linkedin reset` recupera somente o perfil privado legado em
`~/.work-tracker/browsers/linkedin/profile`, sem tocar na sessão compartilhada
`~/.linkedin-mcp`. Limpa processos Chrome/Chromium com o argumento exato e os
três locks Singleton desse diretório. Essa recuperação foi implementada para Linux.

O Work Tracker é atualmente exclusivo para Linux. Após concluir as funcionalidades
planejadas, avaliar suporte a Windows e macOS; essa expansão deverá incluir a
adaptação do `linkedin reset` para esses sistemas, preservando o isolamento dos
perfis próprios do app.

Referências: [LinkedIn MCP](https://github.com/stickerdaniel/linkedin-mcp-server),
[ferramentas Chrome DevTools](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md).
As skills usam chamadas sequenciais às ferramentas anunciadas pelo servidor.

## API e ciclo de vida

`src/server/index.ts` exporta `startBackend() → { address, port, token, close }`.
O servidor usa apenas `127.0.0.1` e porta dinâmica por padrão.
Rotas `/api/*` e `/ws` exigem `?token=...`. A CLI lê `backend.lock` e envia
`POST /_internal/changed` com `x-work-tracker-token`; os sockets recebem `changed`.
As consultas incluem overview, jobs, recruiters, outreach, metrics, interviews,
applications, answers, activity, profile e profile-snapshot. Foram preservadas as
rotas de busca, escrita de respostas, recruiter sync e execução/cancelamento ACP.

O Electron usa `utilityProcess`, recebe `ready`/`failed`/`stopped` e envia
`shutdown` ao fechar. O backend encerra servidor, sockets, SQLite e grupos dos
subprocessos da sessão. Há um fallback de término após cinco segundos no main.
Se o backend encerrar inesperadamente, a janela continua aberta e mostra o estado
`Backend unavailable` com a ação “Restart backend”, que cria um processo novo e
reconecta a API e o WebSocket sem duplicar listeners; as telas abertas recarregam
e as execuções ativas aparecem como interrompidas, sem repetição automática. Não
há reinício automático: após três falhas seguidas, o app mostra o erro e o caminho
de `logs/backend.log`. Os testes do processo principal ficam em `desktop/src`.
Skills e CLI são distribuídas em `resources/work-tracker`, fora do ASAR; a CLI
é um bundle Node que pode ser executado com Node 24 sem o checkout original.

## Verificação

```bash
npm run typecheck
npm test
npm run test:backend:integration
npm run package
node scripts/smoke-electron.mjs
node scripts/smoke-electron.mjs node_modules/.bin/electron-vite dev --watch --noSandbox
node scripts/smoke-electron.mjs "./release/work-tracker-$(node -p "require('./package.json').version")-x86_64.AppImage" --no-sandbox
node scripts/smoke-apply.mjs node_modules/.bin/electron-vite dev --watch --noSandbox
node scripts/smoke-apply.mjs "./release/work-tracker-$(node -p "require('./package.json').version")-x86_64.AppImage" --no-sandbox
npm run test:e2e
npm run lint
npm run test:infra
npm run audit:ci
npm run test:backend:coverage
npm run test:frontend:coverage
npm run quality:check
npm run performance:check
```

Os checks adicionais reproduzem localmente os gates do CI: lint com zero erros e
avisos, testes dos scripts e dos workflows, audit (critical bloqueia, high avisa),
cobertura de cada camada com piso de 80%, duplicação, limites de 350 linhas por
arquivo e 100 por função e microbenchmarks do `main` e do branch medidos na mesma
máquina (`performance:check` exige árvore limpa). Consulte [CI, quality gate,
performance e caches](ci.md).

Os unitários do backend ficam ao lado dos módulos (`<modulo>.test.ts`), usam
Vitest em ambiente Node e são executados sem compilar a CLI. As fronteiras de
SQLite, arquivos, HTTP, rede e subprocessos são simuladas; datas, cache e timeouts
usam relógio controlado quando necessário. O setup da suíte rejeita operações de
I/O não configuradas e restaura ambiente, globais e relógio entre os casos.

```bash
npm run test:backend              # somente unitários do backend
npm run test:backend:watch        # acompanha os unitários
npm run test:backend:coverage     # unitários uma vez, com cobertura (texto, HTML, JSON e resumo)
npm run test:frontend:coverage    # unitários e componentes do frontend com cobertura
npm run test:backend:integration  # compila a CLI e executa as integrações preservadas
npm run typecheck:backend         # backend, CLI, Electron main/preload e E2E
npm run typecheck:frontend        # web
npm run lint:backend              # ESLint com cache por conteúdo
npm run lint:frontend
```

`npm test` executa os unitários do backend e os testes do frontend. A suíte de
integração é explícita: fica em `src/test/integration`, usa SQLite real (inclusive
em memória), homes temporários com espaços, arquivos, HTTP/WebSocket e
subprocessos locais. Preserva os cenários anteriores de persistência, CLI,
autenticação, notificações e protocolos MCP/ACP; não acessa contas LinkedIn reais.

Os relatórios completos ficam em `coverage/<camada>/unit/` (`index.html`,
`coverage-final.json` e `coverage-summary.json`), ignorados pelo Git. O quality
gate exige 80% em statements, branches, funções e linhas em cada camada e impede
regressões frente à baseline. Consulte o [relatório por arquivo](backend-unit-coverage.md)
para os resultados do backend, exclusões e lacunas restantes.

O smoke verifica `ready → shutdown → stopped`, banco vazio e remoção do lock.
Não envia mensagens nem acessa contas LinkedIn reais. As integrações com serviços
reais exigem instalação e autenticação locais. Validação de execução nesta etapa:
Linux; Windows e macOS ainda não validados.

### E2E com Playwright

`npm run test:e2e` compila o app e executa os testes no Electron real, com backend,
SQLite e CLI reais, além de agentes ACP, LinkedIn MCP e Chrome simulados. A suíte
cobre as 14 telas da sidebar, funcionalidades, persistência e jornadas entre telas.
Cada teste usa um workspace e um perfil Electron temporários; os dados pessoais
em `~/.work-tracker` não são usados.

Requer Node 24+, `xvfb`, `xauth`, `latexmk`,
`pdflatex` e Poppler (`pdfinfo` e `pdftotext`). O fixture E2E usa apenas a classe
LaTeX `article`; os smoke checks existentes continuam exigindo os pacotes do
currículo de exemplo.

No Linux, E2E e os smoke checks do Electron e Apply executam automaticamente
em um display virtual Xvfb, inclusive em sessões Wayland. As janelas dos testes
ficam isoladas do desktop; o terminal continua mostrando o andamento e o resultado.
Instale o display virtual com `sudo apt-get install xvfb xauth`. A falta dessas
ferramentas interrompe a execução com instruções de instalação.

O debug abre o Electron e o inspector no desktop. Para acompanhar qualquer teste
ou smoke de forma visível, use `WORK_TRACKER_TEST_DISPLAY=host` antes do comando.

```bash
npm run test:e2e
npm run test:e2e:debug
npm run test:e2e:report
# Reutilizar um build de produção atualizado e selecionar testes:
npm run test:e2e:run -- e2e/apply.spec.ts
# Diagnóstico visível no desktop:
WORK_TRACKER_TEST_DISPLAY=host npm run test:e2e:run -- e2e/apply.spec.ts
```

O workflow **Electron E2E** executa a suíte em pull requests destinados à `main`.
Relatórios HTML e evidências de falhas ficam disponíveis como artifacts por sete
dias. Consulte [a documentação da suíte](e2e.md).
