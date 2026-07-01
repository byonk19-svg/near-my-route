import assert from "node:assert/strict";
import test from "node:test";
import { dogfoodNotePhiWarning } from "./privacy";

test("dogfoodNotePhiWarning allows workflow friction notes", () => {
  assert.equal(dogfoodNotePhiWarning("Import felt slow and the Maps handoff was hard to find."), undefined);
});

test("dogfoodNotePhiWarning blocks obvious patient and clinical details", () => {
  assert.match(dogfoodNotePhiWarning("Patient had dysphagia and was NPO.") ?? "", /workflow-only/);
  assert.match(dogfoodNotePhiWarning("MRN 12345 was on the pasted schedule.") ?? "", /workflow-only/);
  assert.match(dogfoodNotePhiWarning("DOB 1/2/1940 appeared in the route text.") ?? "", /workflow-only/);
});
