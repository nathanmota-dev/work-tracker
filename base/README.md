# Dados do currículo

O currículo base é **gerado pelo app** a partir do seu perfil. Não é preciso
escrever LaTeX: envie em **Profile → Import resume** uma destas fontes, que se
substituem (enviar uma pede confirmação e remove a outra):

- **Dados do currículo (`.json`)**: o formato mais completo, documentado em
  [`data/resume-data.example.json`](data/resume-data.example.json).
- **PDF do LinkedIn**: no seu perfil, **More → Save to PDF** (ou **Mais → Salvar
  como PDF**). Ele não traz projetos nem grupos de habilidades: o currículo sai sem
  a seção de projetos e com as principais competências numa lista única.

Outros PDFs enviados, como currículos que você já tem, ficam como texto de
referência: o agente os usa como evidência do seu histórico ao adaptar currículos,
mas eles não entram no currículo base.

Os arquivos ficam em `~/.work-tracker/profile/` e o LaTeX gerado em
`~/.work-tracker/resume/resume.tex`. Toda mudança no perfil (um novo envio ou um
dado pessoal editado no Profile) gera o LaTeX de novo; a página **Resumes → Base
resume** mostra o código, somente leitura, e o PDF.

## Formato do JSON

| Campo | Uso no currículo |
| --- | --- |
| `name`, `location` | Cabeçalho |
| `contact.email`, `contact.tel`, `contact.social[].url`, `personalWebsiteUrl` | Linhas de contato e links |
| `summary` | Resumo Profissional |
| `education[]`: `school`, `location`, `degree`, `start`, `end` | Formação Acadêmica |
| `skillGroups[]`: `name`, `items` | Habilidades agrupadas; sem grupos, usa `skills` numa lista única |
| `work[]`: `company`, `title`, `start`, `end`, `techStack`, `highlights` | Experiência Profissional |
| `projects[]`: `name`, `description`, `date`, `techStack`, `highlights` | Projetos |
| `certifications[]` | Certificações |

- Datas no formato `AAAA-MM` aparecem como `MM/AAAA`; `Present` aparece como
  `Atual`.
- Um item de `work`, `education` ou `projects` com `"hidden": true` fica fora do
  currículo base, mas continua disponível como evidência para currículos
  adaptados.
- Os textos aparecem exatamente como escritos. Seções sem dados são omitidas.
- Descrições e realizações devem explicar sua contribuição real. Use tecnologias
  e frameworks nas listas, sem bibliotecas de ícones, animação ou componentes.

O PDF é compilado com pdfLaTeX e precisa de `latexmk`, Poppler (`pdfinfo` e
`pdftotext`) e dos pacotes LaTeX Roboto, titlesec, enumitem e fancyhdr.

## Versionamento

O `.gitignore` ignora o conteúdo de `base/data/`, exceto o exemplo, e a pasta
antiga `base/latex/`. Mantenha o exemplo com informações genéricas.
