# Arquivos pessoais do currículo

Preencha pelo menos o currículo LaTeX. O arquivo de dados é opcional e permite
organizar experiências e projetos que a tela Apply seleciona conforme cada vaga.

| Exemplo versionável | Sua cópia local, ignorada pelo Git |
| --- | --- |
| `latex/resume.example.tex` | `latex/resume.tex` |
| `data/resume-data.example.ts` | `data/resume-data.ts` |

Na raiz do repositório, copie os exemplos sem sobrescrever arquivos existentes:

```bash
cp -n base/latex/resume.example.tex base/latex/resume.tex
# Opcional:
cp -n base/data/resume-data.example.ts base/data/resume-data.ts
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

`resume-data.example.ts` exporta o objeto `RESUME_DATA`; é TypeScript, não JSON.
Preencha informações de contato, formação, experiências, habilidades e projetos.
As descrições e realizações devem explicar sua contribuição real. Use tecnologias
e frameworks nas listas, sem bibliotecas de ícones, animação ou componentes.
Datas no formato `AAAA-MM` preservam o mês; `Present` indica uma experiência atual.

## Versionamento e integração

O app detecta automaticamente `base/latex/resume.tex` e, se existir,
`base/data/resume-data.ts` ou `base/data/resume-data.json` (JSON tem prioridade).
Não é necessário selecionar nem salvar esses caminhos. Isso também funciona no
app instalado a partir deste checkout: o build guarda uma referência ao
repositório local, sem incluir seus arquivos pessoais no pacote.

Use **Settings → Resume sources** somente para escolher outra pasta, outro
arquivo principal ou outro compilador. Uma configuração salva tem prioridade
sobre a detecção automática. Se mover ou apagar o checkout, atualize o app a
partir do novo local ou configure os novos caminhos. A variável
`WORK_TRACKER_REPO_ROOT` permite indicar outro checkout. A tela **Apply** compila
o PDF base e permite gerar uma versão por vaga.

O `.gitignore` ignora o conteúdo de `base/latex/` e `base/data/`, liberando apenas
os dois arquivos `.example`. Isso inclui fontes pessoais, arquivos auxiliares,
imagens, PDFs e saídas de compilação. Mantenha os exemplos com informações
genéricas e edite suas cópias locais.

A geração usa o agente e modelo selecionados na tela Apply. O preenchimento do
portal é iniciado separadamente e deixa o envio final para revisão no navegador.
