# The Orchard General Partnership: its website

A members' website for an investment club, built on the site kit (sites/kit)
and installed by make-orchard-gp.sh. The node is private: visitors see only
the sign-in page. Partners see:

- **Overview** (index.html, home.js): the club's value, their stake, what
  needs them, open votes, top holdings, recent activity.
- **Portfolio** (portfolio.html, portfolio.js): holdings, approved trades,
  transactions and capital accounts, open to every partner; proposing a trade;
  and the Treasurer's desk, shown only to the Treasurer, who alone records
  anything on the books (fund.bookkeeper).
- **Partners** (partners.html, partners.js): the register, officers, applicants.
- **Votes, Meetings, Agreement, Certificates, My details, Invite**: the
  partnership's modules, drawn in hall.html (config.js hide: lists what is
  kept but not shown, such as the wiki that stores the agreement's text).
