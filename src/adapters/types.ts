export type PortalId = "greenhouse" | "lever" | "ashby" | "generic";

/** How a field must be interacted with — drives the skill's Chrome MCP steps. */
export type Widget =
  | "text" // plain input: set value + dispatch input/change
  | "tel" // phone input, often an intl-tel widget that reformats — OK
  | "native-select" // a real <select>: select the option
  | "react-select" // Greenhouse combobox: click to open, click option
  | "listbox" // Ashby button/listbox: click to open, click option
  | "file"; // upload widget: click attach, upload, verify filename shown

/**
 * @property key Canonical applicant_answers key this field corresponds to.
 * @property selectors CSS selectors to try in order. The first that exists on the page wins; selectors target the ATS's stable markup.
 */
export interface FieldSpec {
  key: string;
  selectors: string[];
  widget: Widget;
}

/**
 * @property hostPatterns Host substrings that select this ATS.
 * @property fields Stable, known fields keyed to canonical answer keys.
 * @property notes Human- or agent-facing notes on quirks such as file uploads, dropdowns, and captchas.
 */
export interface Adapter {
  portal: PortalId;
  hostPatterns: string[];
  fields: FieldSpec[];
  notes: string[];
}
