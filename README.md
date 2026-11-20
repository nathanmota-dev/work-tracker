# Work Tracker

Aplicativo desktop para organizar a sua busca de emprego: encontre vagas no
LinkedIn, salve e acompanhe cada oportunidade, gerencie candidaturas e mantenha
recrutadores, entrevistas e métricas do perfil em um só lugar.

## O que ele faz

- **Descoberta de vagas** no LinkedIn, com avaliação de aderência ao seu perfil.
- **Acompanhamento** de vagas salvas e de candidaturas, do primeiro contato à resposta final.
- **Currículo por vaga**: gera um currículo adaptado a cada oportunidade, compara PDFs e prepara o preenchimento da candidatura para você revisar e enviar.
- **Recrutadores e entrevistas**: contatos, mensagens de acompanhamento e agenda de entrevistas.
- **Métricas** do perfil e da busca ao longo do tempo.
- **Agentes de IA** conectados por ACP (OpenCode e Claude Code), e LinkedIn e navegador por MCP configurável.

Seus dados ficam no seu computador, em `~/.work-tracker`.

## Tecnologias

Electron, React, Tailwind CSS e shadcn/ui no frontend; TypeScript e Node.js 24+
no backend, com SQLite, API HTTP/WebSocket, Model Context Protocol e ACP.

## Instalação

Disponível para **Linux**.

1. Baixe o arquivo `work-tracker-X.Y.Z-x86_64.AppImage` da
   [última release](https://github.com/nathanmota-dev/work-tracker/releases/latest).
2. Torne-o executável e abra:

   ```bash
   chmod +x work-tracker-*-x86_64.AppImage
   ./work-tracker-*-x86_64.AppImage
   ```

   Se o seu sistema bloquear o sandbox (comum no Ubuntu com AppArmor), execute com
   `--no-sandbox`.

Guarde o AppImage em uma pasta onde o seu usuário possa escrever: o app verifica
atualizações automaticamente e, em **Settings → Updates**, você baixa e instala
a nova versão com um clique. Seus dados não são alterados nas atualizações.

Para gerar currículos em PDF, instale também `latexmk`, `pdflatex` e Poppler
(`pdfinfo` e `pdftotext`). Para usar agentes e LinkedIn, configure as integrações
em **Settings**.

## Documentação

Desenvolvimento, build a partir do código, CLI, integrações, testes e releases
estão em [docs/desenvolvimento.md](docs/desenvolvimento.md). Veja também a
[pasta docs](docs/) e, para as licenças de origem,
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licença

[MIT](LICENSE)
