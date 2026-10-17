export function words(params) {
  const w = (k, d) => (params.has(k) ? params.value(k) : d);
  return {
    participant: w('vocabulary.participant', 'participant'),
    participants: w('vocabulary.participants', 'participants'),
    assembly: w('vocabulary.assembly', 'Assembly'),
    proposal: w('vocabulary.proposal', 'proposal'),
  };
}
