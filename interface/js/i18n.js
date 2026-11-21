// i18n · English and French for the shell and the screens built on the kit.
// The viewer's choice, kept in this browser (as tschoonover.com keeps its
// own): it changes nothing in the record. Words not yet translated fall back
// to English; the rest of the page follows (Day 5 of the plan).
const STRINGS = {
  en: {
    'nav.home': 'Home', 'nav.votes': 'Votes', 'nav.members': 'Members', 'nav.record': 'Record', 'nav.law': 'Law', 'nav.settings': 'Settings', 'nav.propose': 'Propose',
    'ctl.size': 'Text size', 'ctl.lang': 'Language', 'ctl.theme': 'Colours', 'ctl.light': 'Light', 'ctl.dark': 'Dark', 'ctl.auto': 'Auto', 'skip': 'Skip to the page',
    'home.needs': 'Needs your vote', 'home.open': 'Open', 'home.recent': 'Lately', 'home.health': 'This copy', 'home.modules': 'From the modules',
    'home.none.needs': 'Nothing needs your vote.', 'home.none.open': 'Nothing is open.', 'home.none.others': 'Nothing else is open.', 'home.all': 'Every proposal', 'home.propose': 'Propose something',
    'home.records': 'records', 'home.members': 'members', 'home.open.n': 'open',
    'h.verified': 'Verified in this browser', 'h.broken': 'Do not trust this copy', 'h.sealed': 'sealed', 'h.public': 'public', 'h.period': 'Key period', 'h.you': 'You',
    'h.out': 'Not signed in', 'h.reads': 'This browser opens the sealed records with your key.',
    'v.quorum': 'Turnout', 'v.share': 'In favour', 'v.closes': 'Closes', 'v.closed': 'Closed', 'v.laid': 'Laid', 'v.reading': 'Reading', 'v.enacted': 'Enacted', 'v.needs': 'needs',
    'v.for': 'Vote for', 'v.against': 'Vote against', 'v.abstain': 'Abstain', 'v.left': 'left', 'v.now': 'now',
    'c.title': 'Title', 'c.text': 'What it says', 'c.what': 'What it changes', 'c.motion': 'Nothing: a motion', 'c.find': 'Find a setting', 'c.new': 'New value',
    'c.preview': 'The change', 'c.rule': 'The rule it needs', 'c.sign': 'Sign this proposal', 'c.notitle': 'Give it a title.', 'c.same': 'That is already its value.',
    'c.motion.does': 'A motion changes nothing; it records what the members decide.', 'c.heading': 'Propose',
    's.heading': 'Settings', 's.change': 'Propose a change', 's.fixed': 'cannot be changed', 's.by': 'by the {rule} rule', 's.default': 'default', 's.search': 'Search settings',
    's.yes': 'yes', 's.no': 'no', 's.none': '(none)',
    'when.d': 'd', 'when.h': 'h', 'when.m': 'min', 'when.ago': 'ago', 'when.in': 'in',
    'you.who': 'Who you are', 'you.key': 'Your key', 'you.sealed': 'The sealed record', 'you.lost': 'If you lose your key',
    'you.active': 'an active {one}', 'you.applicant': 'applying, awaiting admission', 'you.left': 'has left', 'you.removed': 'removed on', 'you.unsettled': 'not yet on the register',
    'you.locked': 'locked', 'you.unlocked': 'not locked', 'you.notify': 'Notifications', 'you.notices': 'Notices for you',
    'r.heading': 'The record', 'r.cols': '#|When|What happened|By|Hash', 'r.checkpoints': 'Checkpoints',
    'm.cols': 'Id|Name|Status|Joined|Sealed record', 'm.applications': 'Applications',
    'l.heading': 'The law', 'l.statutes': 'Statutes',
    'list.search': 'Search', 'list.prev': 'Previous', 'list.next': 'Next', 'list.of': 'of', 'list.nomatch': 'Nothing matches.', 'list.empty': 'Nothing yet.',
  },
  fr: {
    'nav.home': 'Accueil', 'nav.votes': 'Votes', 'nav.members': 'Membres', 'nav.record': 'Registre', 'nav.law': 'Loi', 'nav.settings': 'Réglages', 'nav.propose': 'Proposer',
    'ctl.size': 'Taille du texte', 'ctl.lang': 'Langue', 'ctl.theme': 'Couleurs', 'ctl.light': 'Clair', 'ctl.dark': 'Sombre', 'ctl.auto': 'Auto', 'skip': 'Aller à la page',
    'home.needs': 'Attend votre vote', 'home.open': 'En cours', 'home.recent': 'Récemment', 'home.health': 'Cette copie', 'home.modules': 'Des modules',
    'home.none.needs': 'Rien n’attend votre vote.', 'home.none.open': 'Rien n’est en cours.', 'home.none.others': 'Rien d’autre n’est en cours.', 'home.all': 'Toutes les propositions', 'home.propose': 'Proposer quelque chose',
    'home.records': 'inscriptions', 'home.members': 'membres', 'home.open.n': 'en cours',
    'h.verified': 'Vérifié dans ce navigateur', 'h.broken': 'Ne vous fiez pas à cette copie', 'h.sealed': 'scellées', 'h.public': 'publiques', 'h.period': 'Période de clé', 'h.you': 'Vous',
    'h.out': 'Non connecté', 'h.reads': 'Ce navigateur ouvre les inscriptions scellées avec votre clé.',
    'v.quorum': 'Participation', 'v.share': 'Pour', 'v.closes': 'Clôture', 'v.closed': 'Clos', 'v.laid': 'Déposée', 'v.reading': 'Lecture', 'v.enacted': 'Adoptée', 'v.needs': 'requis',
    'v.for': 'Voter pour', 'v.against': 'Voter contre', 'v.abstain': 'S’abstenir', 'v.left': 'restant', 'v.now': 'maintenant',
    'c.title': 'Titre', 'c.text': 'Ce qu’elle dit', 'c.what': 'Ce qu’elle change', 'c.motion': 'Rien : une motion', 'c.find': 'Chercher un réglage', 'c.new': 'Nouvelle valeur',
    'c.preview': 'Le changement', 'c.rule': 'La règle requise', 'c.sign': 'Signer cette proposition', 'c.notitle': 'Donnez-lui un titre.', 'c.same': 'C’est déjà sa valeur.',
    'c.motion.does': 'Une motion ne change rien ; elle inscrit ce que décident les membres.', 'c.heading': 'Proposer',
    's.heading': 'Réglages', 's.change': 'Proposer un changement', 's.fixed': 'ne peut pas changer', 's.by': 'par la règle {rule}', 's.default': 'par défaut', 's.search': 'Chercher un réglage',
    's.yes': 'oui', 's.no': 'non', 's.none': '(aucun)',
    'when.d': 'j', 'when.h': 'h', 'when.m': 'min', 'when.ago': 'il y a', 'when.in': 'dans',
    'you.who': 'Qui vous êtes', 'you.key': 'Votre clé', 'you.sealed': 'Le registre scellé', 'you.lost': 'Si vous perdez votre clé',
    'you.active': 'actif · {one}', 'you.applicant': 'candidature en attente d’admission', 'you.left': 'a quitté', 'you.removed': 'radié le', 'you.unsettled': 'pas encore au registre',
    'you.locked': 'verrouillée', 'you.unlocked': 'non verrouillée', 'you.notify': 'Notifications', 'you.notices': 'Vos avis',
    'r.heading': 'Le registre', 'r.cols': 'N°|Quand|Ce qui s’est passé|Par|Empreinte', 'r.checkpoints': 'Points de contrôle',
    'm.cols': 'Identifiant|Nom|Statut|Entrée|Registre scellé', 'm.applications': 'Candidatures',
    'l.heading': 'La loi', 'l.statutes': 'Lois adoptées',
    'list.search': 'Chercher', 'list.prev': 'Précédent', 'list.next': 'Suivant', 'list.of': 'sur', 'list.nomatch': 'Rien ne correspond.', 'list.empty': 'Rien pour l’instant.',
  },
};

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } } };
let lang = store.get('entity:lang') === 'fr' ? 'fr' : 'en';

export const language = () => lang;
export function setLanguage(l) { lang = l === 'fr' ? 'fr' : 'en'; store.set('entity:lang', lang); document.documentElement.lang = lang; }
export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
// "in 3 d", "2 h ago": how far a time is from now, in the viewer's language.
export function until(iso, now = Date.now()) {
  const ms = Date.parse(iso) - now, a = Math.abs(ms);
  const n = a >= 864e5 ? `${Math.round(a / 864e5)} ${t('when.d')}` : a >= 36e5 ? `${Math.round(a / 36e5)} ${t('when.h')}` : `${Math.max(1, Math.round(a / 6e4))} ${t('when.m')}`;
  if (lang === 'fr') return ms >= 0 ? `${t('when.in')} ${n}` : `${t('when.ago')} ${n}`;
  return ms >= 0 ? `in ${n}` : `${n} ago`;
}
