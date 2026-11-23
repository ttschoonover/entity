# Republics

What belongs to one republic and nobody else: its website, its founding script, its own pages.

    core       entity: the record, the node, the module host        changes rarely, by decision
    modules    library/ (or github:ttschoonover/entity-modules)     each pinned by digest, upgraded by decision
    republics  republics/<name>/                                     a site and its content; no core change

A republic changes its site with its own `ship-site.sh`, and its modules with `entity module upgrade`.
Neither touches the core or any other republic.
