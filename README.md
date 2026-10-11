# Work Tracker

Aplicativo Electron com backend Node independente, importado do Mercury 0.9.1.
O backend inclui SQLite, API HTTP/WebSocket, CLI, clientes MCP, sessões ACP,
matching de formulários e sete skills próprias. O React e o preload existentes
continuam sem integração com essa API nesta etapa.

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
work-tracker.db             SQLite, WAL, foreign keys, migração inicial própria
config.json                configuração própria, inicialmente {}
backend.lock               porta, token aleatório e PID; removido ao encerrar
workspace/                 cwd privado dos agentes e skills work-tracker-*
artifacts/                 artefatos gerados
bin/                       wrapper work-tracker disponível no PATH dos agentes
agents/                    configuração/autenticação privada dos providers
browsers/linkedin/profile/ perfil legado, preservado para recuperação
browsers/chrome/profile/   perfil da janela de login aberta pelo app
```

Não há leitura de banco, configuração, skills ou checkout do Mercury, instalação
automática de MCPs ou atualizador externo. `setup` copia apenas recursos deste app
para seu workspace; não instala skills nos diretórios globais dos agentes.
A versão da CLI vem do `package.json`. Código e licença de origem estão em
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Dependências locais e configuração

Banco e API abrem mesmo sem MCPs ou agentes instalados. `doctor` verifica os
executáveis; ausência de login, compatibilidade de ferramentas e conectividade
são verificadas quando a funcionalidade é solicitada.
Instale manualmente os executáveis que quiser usar:

- `mcp-server-linkedin` (por exemplo, `uv tool install mcp-server-linkedin`).
- `chrome-devtools-mcp` (por exemplo, `npm install -g chrome-devtools-mcp`).
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
Skills e CLI são distribuídas em `resources/work-tracker`, fora do ASAR; a CLI
é um bundle Node que pode ser executado com Node 24 sem o checkout original.

## Verificação

```bash
npm run typecheck
npm test
npm run package
node scripts/smoke-electron.mjs
node scripts/smoke-electron.mjs node_modules/.bin/electron-vite dev --watch --noSandbox
node scripts/smoke-electron.mjs './release/Work Tracker-1.0.0.AppImage' --no-sandbox
```

Os unitários do backend ficam ao lado dos módulos (`<modulo>.test.ts`), usam
Vitest em ambiente Node e são executados sem compilar a CLI. As fronteiras de
SQLite, arquivos, HTTP, rede e subprocessos são simuladas; datas, cache e timeouts
usam relógio controlado quando necessário. O setup da suíte rejeita operações de
I/O não configuradas e restaura ambiente, globais e relógio entre os casos.

```bash
npm run test:backend              # somente unitários do backend
npm run test:backend:watch        # acompanha os unitários
npm run test:backend:coverage     # texto, HTML e JSON de cobertura unitária
npm run test:backend:integration  # compila a CLI e executa as integrações preservadas
npx tsc --noEmit -p tsconfig.node.json  # tipos do backend e desktop
```

`npm test` executa os unitários do backend e os testes do frontend. A suíte de
integração é explícita: fica em `src/test/integration`, usa SQLite real (inclusive
em memória), homes temporários com espaços, arquivos, HTTP/WebSocket e
subprocessos locais. Preserva os cenários anteriores de persistência, CLI,
autenticação, notificações e protocolos MCP/ACP; não acessa contas LinkedIn reais.

Os relatórios completos ficam em `coverage/backend/unit/index.html` e
`coverage/backend/unit/coverage-final.json`, ignorados pelo Git. Não há meta
percentual de cobertura. Consulte o [relatório por arquivo](docs/backend-unit-coverage.md)
para os resultados desta implementação, exclusões e lacunas restantes.

O smoke verifica `ready → shutdown → stopped`, banco vazio e remoção do lock.
Não envia mensagens nem acessa contas LinkedIn reais. As integrações com serviços
reais exigem instalação e autenticação locais. Validação de execução nesta etapa:
Linux; Windows e macOS ainda não validados.
