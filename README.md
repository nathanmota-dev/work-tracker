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

Sem override, todos os dados ficam em `~/.work-tracker`:

```text
work-tracker.db             SQLite, WAL, foreign keys, migração inicial própria
config.json                configuração própria, inicialmente {}
backend.lock               porta, token aleatório e PID; removido ao encerrar
workspace/                 cwd privado dos agentes e skills work-tracker-*
artifacts/                 artefatos gerados
bin/                       wrapper work-tracker disponível no PATH dos agentes
agents/                    configuração/autenticação privada dos providers
browsers/linkedin/profile/ perfil dedicado do LinkedIn
browsers/chrome/profile/   perfil dedicado do Chrome DevTools
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

Não inclua flags de perfil nos argumentos MCP: o app injeta `--user-data-dir`
para LinkedIn e `--userDataDir` para Chrome. O LinkedIn recebe também
`--no-auto-import`, evitando importar sessões de outro navegador. Para login manual:

```bash
export WORK_TRACKER_HOME="${WORK_TRACKER_HOME:-$HOME/.work-tracker}"
mcp-server-linkedin --user-data-dir "$WORK_TRACKER_HOME/browsers/linkedin/profile" --login
```

A pasta pai do perfil LinkedIn é exclusiva desse servidor. `linkedin reset`
limpa somente processos Chrome/Chromium com o argumento exato desse perfil e os
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

Os testes usam dados sintéticos, homes temporários com espaços e subprocessos
simulados. Cobrem SQLite vazio, persistência, parâmetros SQL, rollback, CLI,
autenticação HTTP/WS, notificações, MCP, streaming ACP, erros, timeout e cancelamento.
O smoke verifica `ready → shutdown → stopped`, banco vazio e remoção do lock.
Não envia mensagens nem acessa contas LinkedIn reais. As integrações com serviços
reais exigem instalação e autenticação locais. Validação de execução nesta etapa:
Linux; Windows e macOS ainda não validados.
