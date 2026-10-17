// Projections for interfaces. Read-only.
import { count } from './count.js';

export function proposals(state) {
  return Object.values(state.proposals).map(p => ({
    id: p.id, title: p.title, text: p.text, by: p.by, at: p.at, rule: p.rule, deadline: p.deadline,
    reading: p.reading, readings: p.terms.readings, changes: p.changes || null, admit: p.admit || null,
    paths: p.paths || null, enacted: p.enacted, awaiting: p.awaiting, notEnacted: p.notEnacted || null,
    tally: count(state, p.id),
  })).sort((a, b) => (a.at < b.at ? 1 : -1));
}
