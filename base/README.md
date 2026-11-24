# Arquivos pessoais do currículo

Preencha pelo menos o currículo LaTeX. A pasta `data/` é a pasta de perfil:
tudo o que você deixar nela serve de evidência para os currículos adaptados. O
arquivo de dados JSON, o PDF exportado do LinkedIn e currículos já prontos em PDF
são opcionais.

| Exemplo versionável | Sua cópia local, ignorada pelo Git |
| --- | --- |
| `latex/resume.example.tex` | `latex/resume.tex` |
| `data/resume-data.example.json` | `data/resume-data.json` |
| — | `data/*.pdf` (export do LinkedIn e currículos de referência) |

Na raiz do repositório, copie os exemplos sem sobrescrever arquivos existentes:

```bash
cp -n base/latex/resume.example.tex base/latex/resume.tex
# Opcional:
cp -n base/data/resume-data.example.json base/data/resume-data.json
```

## Preencher o LaTeX

Substitua nome, contatos, formação, habilidades, experiências e projetos pelos
seus dados. Você também pode colocar seu projeto exportado do Overleaf em
`base/latex/`, com o arquivo principal chamado `resume.tex` e seus arquivos
auxiliares junto dele.

O exemplo usa pdfLaTeX. Compile no Overleaf ou em uma instalação LaTeX local com
os pacotes usados pelo documento. Para formação acadêmica, o exemplo apresenta
somente a conclusão; registre o início nos dados se quiser preservar o histórico.
Seções comentadas podem permanecer no arquivo e ser preenchidas futuramente.

## Preencher os dados opcionais

`resume-data.example.json` é um objeto JSON. Preencha informações de contato,
formação, experiências, habilidades e projetos. O campo `type` de um projeto aceita
`frontend`, `backend` ou `fullstack`. O formato TypeScript (`resume-data.ts`) não é
mais aceito: salve o objeto `RESUME_DATA` como `resume-data.json`.
As descrições e realizações devem explicar sua contribuição real. Use tecnologias
e frameworks nas listas, sem bibliotecas de ícones, animação ou componentes.
Datas no formato `AAAA-MM` preservam o mês; `Present` indica uma experiência atual.

## Export do LinkedIn e currículos de referência

No LinkedIn, abra o seu perfil e use **More → Save to PDF** (ou **Mais → Salvar como
PDF**); salve o arquivo em `base/data/`. O app lê esse export com um extrator
determinístico: headline, resumo, todas as experiências com cargo, período, local e
bullets, formação, idiomas e principais competências, em contas em inglês ou em
português. Outros PDFs da pasta, como um currículo focado em outra stack, entram
como currículos de referência: o agente usa o texto deles como evidência do seu
histórico.

São lidos os PDFs do nível superior da pasta (sem subpastas nem links simbólicos),
até 10 arquivos de até 20 MB cada. A importação roda antes de cada geração e pelo
botão **Import again** em **Profile → Base resume**; cada PDF é lido uma vez e
guardado pelo hash do conteúdo. Um PDF escaneado, sem texto, gera um aviso e não
bloqueia a geração.

Quando o JSON e o LinkedIn divergem em uma data ou no local de uma experiência ou
formação, **Profile → Base resume** mostra o conflito uma vez, com as duas opções e
**Decide later**. Ano igual com o mês ausente em uma das fontes não é conflito. A
escolha vale para as próximas gerações; enquanto não houver escolha, o agente mantém
o valor do LaTeX base.

## Versionamento e integração

O app detecta automaticamente `base/latex/resume.tex`, a pasta de perfil
`base/data/` e, se existir, `base/data/resume-data.json`.
Não é necessário selecionar nem salvar esses caminhos. Isso também funciona no
app instalado a partir deste checkout: o build guarda uma referência ao
repositório local, sem incluir seus arquivos pessoais no pacote.

Use **Settings → Resume sources** somente para escolher outra pasta, outro
arquivo principal, outro arquivo de dados, outra pasta de perfil ou outro
compilador. Uma configuração salva tem prioridade
sobre a detecção automática. Se mover ou apagar o checkout, atualize o app a
partir do novo local ou configure os novos caminhos. A variável
`WORK_TRACKER_REPO_ROOT` permite indicar outro checkout. A tela **Apply** compila
o PDF base e permite gerar uma versão por vaga.

O `.gitignore` ignora o conteúdo de `base/latex/` e `base/data/`, liberando apenas
os dois arquivos `.example`. Isso inclui fontes pessoais, arquivos auxiliares,
imagens, PDFs (inclusive o export do LinkedIn) e saídas de compilação. Mantenha os exemplos com informações
genéricas e edite suas cópias locais.

A geração usa o agente e modelo selecionados na tela Apply. O preenchimento do
portal é iniciado separadamente e deixa o envio final para revisão no navegador.
