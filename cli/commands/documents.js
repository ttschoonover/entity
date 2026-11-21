// entity documents · partnership certificates and signed agreements as PDFs (LaTeX)
//
//   entity documents certificate <number|member> [--out file.pdf] [--tex]   one certificate
//   entity documents certificates [--out folder]                           every certificate in force
//   entity documents agreement [page] [--out file.pdf] [--tex]             an agreement with its signatures
//
// --tex writes the LaTeX source instead of the PDF. Needs pdflatex (TeX Live).
import fs from 'node:fs';
import path from 'node:path';
import { refuse, openEntity, out } from '../context.js';
import * as D from '../documents.js';

export async function documentsCommand({ pos, opt }) {
  const sub = pos[0];
  const e = await openEntity(opt);
  const mod = async (m) => { if (!e.params.value('entity.modules').includes(m)) refuse(`the ${m} module is not enabled here`); return import(new URL(`file://${path.join(e.dir, 'modules', m, 'index.js')}`).href); };
  const write = (doc, file) => {
    const target = file || `${doc.name}.${opt.tex ? 'tex' : 'pdf'}`;
    if (opt.tex) { fs.writeFileSync(target, doc.tex); for (const [f, b] of Object.entries(doc.files)) fs.writeFileSync(path.join(path.dirname(target), f), b); }
    else fs.writeFileSync(target, D.pdf(e, doc));
    out(`wrote ${target}`);
  };
  if (sub === 'certificate' || sub === 'certificates') {
    const { certificates } = await mod('partnership');
    const certs = certificates(e.views || e.records, e.params.value('partnership.unit_class'));
    if (sub === 'certificates') {
      const dir = opt.out || '.'; fs.mkdirSync(dir, { recursive: true });
      for (const c of certs.filter(x => !x.cancelled)) write(D.certificateTex(e, c.number, certs), path.join(dir, `certificate-${c.number}.${opt.tex ? 'tex' : 'pdf'}`));
      return;
    }
    const which = pos[1] || refuse('which certificate? a number, or a member id for their certificate in force');
    const c = /^\d+$/.test(which) ? certs.find(x => x.number === Number(which)) : certs.find(x => x.partner === which && !x.cancelled);
    if (!c) refuse(`no certificate ${/^\d+$/.test(which) ? `no. ${which}` : `in force for ${which}`}`);
    return write(D.certificateTex(e, c.number, certs), opt.out);
  }
  if (sub === 'agreement') {
    const ag = await mod('agreements');
    const page = pos[1] || e.params.value('agreements.required')[0] || refuse('which page?');
    return write(D.agreementTex(e, page, ag), opt.out);
  }
  refuse('entity documents certificate <number|member> | certificates | agreement [page]   [--out file] [--tex]');
}
