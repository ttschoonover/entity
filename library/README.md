# entity-modules

The module pack for [entity](https://github.com/): one folder per module. Entities
fetch a module from here only when their members install it by decision.

    titles  vocabulary  offices  value  deeds  threads  committees  authority
    polls  badges  elections  lending  wiki  finality  shares  budget
    meetings  tasks  passwords  passkeys  fund  agreements  shares  budget

## Using it from an entity

```sh
entity module source github:YOU/entity-modules@main
entity module available
entity module add shares --as YOUR-ID
```

`add` pins `main` to the commit it points at now; the proposal records that
commit, and every copy of the entity fetches exactly that code and checks its
digest. Publishing new commits here changes nothing in any entity until its
members upgrade (`entity module upgrade NAME`), which replays the entity's
whole record with the new code before anything is proposed.

## A module

Each folder holds `index.js` (the module), `parameters.yml` (its settings and
their defaults), `ui.js` (its tab on the page) and `tests.js`. See docs/MODULES.md
in entity.
