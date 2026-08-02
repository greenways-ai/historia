---
title: Multiple repositories
description: Operate one independent Historian index per Git repository.
---

Use one complete Git checkout and one Historian SQLite database per repository. Shallow clones are rejected because the full ancestry is required.

Create a dedicated index directory for each repository, copy the example configuration, then run `init` and `index`. Do not combine unrelated repositories into one database. Repository identity should be based on the canonical remote URL rather than only the directory name.
