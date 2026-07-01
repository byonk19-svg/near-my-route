const phiPatterns = [
  /\bpatient\b/i,
  /\bDOB\b/i,
  /\bdate of birth\b/i,
  /\bMRN\b/i,
  /\bmedical record\b/i,
  /\bdiagnos(?:is|es|ed)?\b/i,
  /\bdysphagia\b/i,
  /\baspirat(?:e|ed|ion)\b/i,
  /\bstroke\b/i,
  /\bpneumonia\b/i,
  /\bNPO\b/i,
];

export function dogfoodNotePhiWarning(note: string) {
  const trimmed = note.trim();
  if (!trimmed) return undefined;
  if (phiPatterns.some((pattern) => pattern.test(trimmed))) {
    return "Dogfood notes must stay workflow-only. Remove patient names, clinical details, DOBs, MRNs, or diagnoses before saving.";
  }
  if (/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(trimmed)) {
    return "Dogfood notes must stay workflow-only. Remove dates that could identify a person before saving.";
  }
  return undefined;
}
