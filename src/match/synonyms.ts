/**
 * Canonical answer keys → the human-readable form labels they map to.
 *
 * Used by the portal-filler matcher to turn an ATS form's visible
 * field labels into Work Tracker `applicant_answers` keys. Synonyms are matched
 * case-insensitively against normalized labels.
 *
 * EEO/demographic keys are listed so the matcher can RECOGNIZE them — but they
 * are flagged `neverAutofill`, so the matcher reports them as deliberately
 * skipped (human-only at review time) rather than filling them.
 */
export type Category = "contact" | "eligibility" | "profile" | "links" | "eeo" | "custom";

/**
 * @property synonyms Lowercase phrases that match this key within a normalized label.
 * @property neverAutofill EEO or demographic fields are recognized but never auto-filled.
 */
export interface KeySpec {
  key: string;
  category: Category;
  synonyms: string[];
  neverAutofill?: boolean;
}

export const KEY_SPECS: KeySpec[] = [
  {
    key: "first_name",
    category: "contact",
    synonyms: ["first name", "given name", "legal first name", "primeiro nome"],
  },
  {
    key: "last_name",
    category: "contact",
    synonyms: ["last name", "surname", "family name", "legal last name", "sobrenome", "ultimo nome"],
  },
  {
    key: "full_name",
    category: "contact",
    synonyms: ["full name", "your name", "name", "nome completo", "nome"],
  },
  {
    key: "email",
    category: "contact",
    synonyms: ["email", "email address", "e-mail", "work email", "endereco de email", "endereco de e-mail"],
  },
  {
    key: "phone",
    category: "contact",
    synonyms: ["phone", "phone number", "mobile", "telephone", "cell", "telefone", "celular", "whatsapp"],
  },
  {
    key: "location",
    category: "contact",
    synonyms: ["location", "current location", "where are you based", "localizacao", "localidade"],
  },
  {
    key: "work_authorization",
    category: "eligibility",
    synonyms: [
      "work authorization",
      "authorized to work",
      "autorizacao de trabalho",
      "legally authorized to work",
      "work authorisation",
      "right to work",
    ],
  },
  {
    key: "requires_sponsorship",
    category: "eligibility",
    synonyms: [
      "require sponsorship",
      "need sponsorship",
      "visa sponsorship",
      "will you now or in the future require sponsorship",
      "immigration sponsorship",
    ],
  },
  {
    key: "salary_expectation",
    category: "eligibility",
    synonyms: [
      "salary expectation",
      "pretensao salarial",
      "expectativa salarial",
      "salario desejado",
      "expected salary",
      "compensation expectation",
      "desired salary",
      "salary requirements",
    ],
  },
  {
    key: "notice_period",
    category: "eligibility",
    synonyms: ["notice period", "availability", "earliest start date", "start date", "disponibilidade", "data de inicio", "aviso previo"],
  },
  {
    key: "linkedin_url",
    category: "links",
    synonyms: ["linkedin", "linkedin url", "linkedin profile", "perfil do linkedin"],
  },
  {
    key: "github_url",
    category: "links",
    synonyms: ["github", "github url", "github profile"],
  },
  {
    key: "portfolio_url",
    category: "links",
    synonyms: ["portfolio", "website", "personal website", "portfolio url", "site pessoal", "site"],
  },
  {
    key: "birth_date",
    category: "contact",
    synonyms: ["birth date", "date of birth", "birthday", "data de nascimento", "nascimento"],
  },
  {
    key: "country",
    category: "contact",
    synonyms: ["country", "country of residence", "pais"],
  },
  {
    key: "state",
    category: "contact",
    synonyms: ["state", "province", "region", "state/region", "estado", "estado/regiao"],
  },
  {
    key: "city",
    category: "contact",
    synonyms: ["city", "town", "cidade"],
  },
  {
    key: "neighborhood",
    category: "contact",
    synonyms: ["neighborhood", "district", "bairro"],
  },
  {
    key: "address",
    category: "contact",
    synonyms: ["address", "street address", "address line 1", "endereco", "logradouro", "rua"],
  },
  {
    key: "postal_code",
    category: "contact",
    synonyms: ["postal code", "zip", "zip code", "postcode", "cep", "codigo postal"],
  },
  {
    key: "desired_role",
    category: "profile",
    synonyms: ["desired role", "desired position", "position applying for", "cargo pretendido", "cargo desejado", "vaga pretendida"],
  },
  {
    key: "preferred_locations",
    category: "profile",
    synonyms: ["preferred locations", "preferred location", "locais de interesse", "locais preferidos"],
  },
  {
    key: "experience_level",
    category: "profile",
    synonyms: ["experience level", "seniority", "seniority level", "nivel de experiencia", "senioridade", "nivel profissional"],
  },
  {
    key: "professional_category",
    category: "profile",
    synonyms: ["professional category", "job category", "job function", "categoria profissional", "area de atuacao"],
  },
  {
    key: "summary",
    category: "profile",
    synonyms: ["summary", "professional summary", "about you", "resumo", "resumo das qualificacoes", "resumo profissional", "sobre voce"],
  },
  {
    key: "languages",
    category: "profile",
    synonyms: ["languages", "language skills", "idiomas", "linguas"],
  },
  {
    key: "accepts_clt",
    category: "eligibility",
    synonyms: ["accepts clt", "clt", "aceita contratacao clt", "aceita clt", "regime clt"],
  },
  {
    key: "social_links",
    category: "links",
    synonyms: ["social networks", "social media", "other links", "redes sociais", "redes sociais/paginas"],
  },
  {
    key: "eeo_gender",
    category: "eeo",
    neverAutofill: true,
    synonyms: ["gender", "gender identity", "genero", "identidade de genero"],
  },
  {
    key: "eeo_race",
    category: "eeo",
    neverAutofill: true,
    synonyms: ["race", "ethnicity", "race/ethnicity", "raca", "cor ou raca", "etnia"],
  },
  {
    key: "eeo_veteran",
    category: "eeo",
    neverAutofill: true,
    synonyms: ["veteran", "veteran status", "protected veteran", "veterano"],
  },
  {
    key: "eeo_disability",
    category: "eeo",
    neverAutofill: true,
    synonyms: ["disability", "disability status", "deficiencia", "pcd", "pessoa com deficiencia"],
  },
];

export const KEY_BY_NAME: Map<string, KeySpec> = new Map(
  KEY_SPECS.map((s) => [s.key, s]),
);
