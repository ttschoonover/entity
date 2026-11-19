// i18n.js · the ICHF's two official languages on its own pages. Every string
// the ICHF's pages write exists in English and French; the reader's choice is
// kept in this browser. Names, acronyms and mottos come from each entity's own
// republic.names, in the languages that entity has made official.
const KEY = 'ichf:lang';
export const LANGS = { en: 'English', fr: 'Français', es: 'Español' };
export function lang() {
  try { const l = localStorage.getItem(KEY); if (l === 'en' || l === 'fr') return l; } catch { /* storage may be blocked */ }
  return /^fr/i.test(navigator.language || '') ? 'fr' : 'en';
}
export function setLang(l) { try { localStorage.setItem(KEY, l); } catch { /* not kept */ } document.documentElement.lang = l; }

const S = {
  join: ['Join through a national federation', 'Adhérer par une fédération nationale'],
  signin: ['Sign in', 'Se connecter'],
  intro: ['A federation of national federations of housing co-operatives. Each national federation governs itself, in its own languages; together they keep one Council, one General Assembly and one unit of account, the labor credit.',
    'Une fédération de fédérations nationales de coopératives d’habitation. Chacune se gouverne elle-même, dans ses propres langues ; ensemble, elles tiennent un Conseil, une Assemblée générale et une unité de compte, le crédit de travail.'],
  bilingual: ['Officially bilingual: English and French have equal standing.', 'Officiellement bilingue : l’anglais et le français ont un statut égal.'],
  street: ['The street', 'La rue'],
  streetCap: ['One house for every member, coloured by national federation. The empty house at the end is for whoever joins next.', 'Une maison par membre, aux couleurs de sa fédération nationale. La maison vide, au bout, attend le prochain membre.'],
  feds: ['National federations', 'Fédérations nationales'],
  fedsLede: ['Each sets its own name, acronym, motto and official languages. Members belong to exactly one, and through it to the ICHF.', 'Chacune fixe son nom, son sigle, sa devise et ses langues officielles. Chaque membre appartient à une seule, et par elle à la FIHC.'],
  languages: ['Official languages', 'Langues officielles'],
  members: ['Members', 'Membres'],
  inIchf: ['in the ICHF', 'à la FIHC'],
  council: ['Council delegates', 'Délégué·es au Conseil'],
  assembly: ['Assembly seats', 'Sièges à l’Assemblée'],
  chair: ['Chair', 'Présidence'],
  itsPage: ['Its page', 'Sa page'],
  apply: ['Apply to join', 'Demander l’adhésion'],
  report: ['Report to the ICHF', 'Transmettre à la FIHC'],
  enroll: ['Join the ICHF', 'Rejoindre la FIHC'],
  stale: ['Its members or delegates have changed since it last reported.', 'Ses membres ou délégué·es ont changé depuis sa dernière transmission.'],
  matches: ['The ICHF’s register matches its record.', 'Le registre de la FIHC correspond au sien.'],
  unreachable: ['Its record could not be reached.', 'Son registre est injoignable.'],
  credits: ['Labor credits', 'Crédits de travail'],
  creditsLede: ['One international unit for every house: 1.00 labor credit is one hour of ordinary co-operative work. Verified work pays it; members of any federation send it to each other.', 'Une unité internationale pour toutes les maisons : 1,00 crédit de travail est une heure de travail coopératif ordinaire. Le travail vérifié le rapporte ; les membres de toute fédération se l’échangent.'],
  circulation: ['in circulation', 'en circulation'],
  holders: ['holders', 'détenteurs'],
  yours: ['yours', 'les vôtres'],
  hours: ['hours of verified work', 'heures de travail vérifié'],
  wanted: ['Work wanted', 'Travail demandé'],
  noWork: ['Nothing posted. Any member can post work the ICHF or a house needs.', 'Rien de publié. Tout membre peut publier un travail dont la FIHC ou une maison a besoin.'],
  allWork: ['All work', 'Tout le travail'], send: ['Send credits', 'Envoyer des crédits'], statute: ['The Labor Credit Statute', 'Le Statut du crédit de travail'],
  votes: ['Open votes', 'Votes en cours'],
  votesLede: ['What the Council and Assembly, and each national federation, are deciding now. Sign in once; your vote goes where it belongs.', 'Ce que décident en ce moment le Conseil et l’Assemblée, et chaque fédération nationale. Une seule connexion ; chaque vote va où il doit.'],
  councilAssembly: ['the Council and the General Assembly', 'le Conseil et l’Assemblée générale'],
  nothingOpen: ['Nothing open.', 'Rien en cours.'],
  officers: ['Officers and committees', 'Dirigeants et comités'],
  officersLede: ['Elected by all members for two years, acting only within powers granted on the record.', 'Élus par l’ensemble des membres pour deux ans ; ils n’agissent que dans les pouvoirs accordés au registre.'],
  vacant: ['Vacant', 'Vacant'], notAppointed: ['Not yet appointed', 'Pas encore désigné'],
  elections: ['Elections', 'Élections'], stand: ['Stand', 'Se présenter'], vote: ['Vote', 'Voter'], count: ['Count', 'Dépouiller'],
  nominations: ['Nominations close', 'Candidatures jusqu’au'], votingCloses: ['Voting closes', 'Vote jusqu’au'], standing: ['Standing', 'Candidat·es'], noOne: ['no one yet', 'personne pour l’instant'],
  texts: ['Founding texts', 'Textes fondateurs'],
  textsLede: ['Adopted in both languages; both versions are equally authoritative.', 'Adoptés dans les deux langues ; les deux versions font également foi.'],
  letters: ['Letters', 'Lettres'], noLetters: ['No letters yet.', 'Aucune lettre pour l’instant.'],
  wiki: ['The wiki', 'Le wiki'], adopted: ['adopted', 'adopté'], draft: ['draft', 'brouillon'],
  signedAs: ['Signed in as', 'Connecté·e en tant que'], memberOf: ['member of', 'membre de'], notEnrolled: ['not yet in the ICHF', 'pas encore à la FIHC'],
  newHere: ['Join a national federation, and through it the ICHF. Nobody belongs to two.', 'Adhérez à une fédération nationale, et par elle à la FIHC. Personne n’appartient à deux.'],
  back: ['All federations', 'Toutes les fédérations'],
  motto: ['Motto', 'Devise'], acronym: ['Acronym', 'Sigle'],
  pages: ['Pages', 'Pages'], openVotes: ['open votes', 'votes en cours'],
  chatCap: ['Chat', 'Discussion'], institutions: ['Institutions', 'Institutions'],
};
export const t = (k) => { const v = S[k]; return v ? v[lang() === 'fr' ? 1 : 0] : k; };

// An entity's names in a language: { name, acronym, motto, lang }, from its
// own republic.names; falls back to its first official language.
export function names(r, l = lang()) {
  const p = r.params, list = p.has('republic.names') ? p.value('republic.names') : [];
  const langs = p.has('republic.languages') ? p.value('republic.languages') : ['en'];
  const base = { name: p.value('entity.name'), acronym: p.has('republic.acronym') ? p.value('republic.acronym') : '', motto: p.has('republic.motto') ? p.value('republic.motto') : '', lang: langs[0] };
  const own = list.find(x => x.lang === l) || list.find(x => x.lang === langs[0]);
  return own ? { ...base, ...own } : base;
}
export const officialLanguages = (r) => (r.params.has('republic.languages') ? r.params.value('republic.languages') : ['en']);

// Bilingual titles written "English · Français": the half for this language.
export const half = (s, l = lang()) => { const parts = String(s).split(' · '); return parts.length === 2 ? parts[l === 'fr' ? 1 : 0] : s; };
