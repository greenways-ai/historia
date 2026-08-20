# Provider runtime

Historia providers are split into portable descriptors and capability-owning executor bindings.

```text
historia-core provider descriptor
  -> Historia broker binding
  -> canonical Hara Work plan
       provider invocation :step
       result validation   :pure
       source acquisition  :step
  -> content-addressed Git blobs
  -> append-only acquisition receipt commit
  -> provider-neutral source documents
```

`greenways/historia-core` owns only descriptors, request/result envelopes, source-document records and exact anchors. It does not own browser, network, process, filesystem, Git or credential capabilities.

## Work boundary

The Historia runtime binds a registered provider ID to an executor function. The binding remains application-local; no callback or credential enters the portable provider descriptor.

A provider execution is interpreted as canonical Work:

```text
provider :step
  -> validation :pure
```

A complete acquisition extends the same plan:

```text
provider :step
  -> validation :pure
  -> Git archive and receipt :step
```

The provider step receives the request plus the ordinary Hara Work context and returns a bounded `historia.provider-observation-result/0-alpha` value. Work normalizes direct and asynchronous results before the pure validation stage. Request options, observations, completeness evidence and warnings are recursively checked for credential-shaped fields before persistence.

The broker defaults to a canonical five-key `work/durable-runtime` backed by the baseline in-memory `IWorkStore`. This gives one broker instance managed run identity, checkpoint replay and committed Work history without requiring SQLite, PostgreSQL, an outbox or a receipt publisher. A caller may inject another canonical Runtime with `:work/runtime`, or explicitly set `:work/runtime nil` to use the store-free `work.eval/run` interpretation.

Work durability and Historia durability are deliberately separate:

- `IWorkStore` records execution runs, step checkpoints and committed Work events.
- The Git acquisition ledger records original source bytes, provider checkpoints and immutable acquisition receipts.

The Git ledger remains authoritative across process restarts. The default memory Work store accelerates and explains in-process replay; a persistent Work store can be injected later without changing provider or archive records.

## Acquisition ledger

Original observation bytes are written to the bare Git vault before a receipt commit is published. The receipt records the exact request, accepted checkpoint, provider-neutral source documents, completeness evidence, warnings and the previous provider receipt commit. One atomic `git update-ref --stdin` transaction advances:

- the global acquisition head;
- the provider-specific acquisition head;
- the immutable request-ID receipt reference.

A repeated request ID resolves to the existing receipt before Work is submitted, so it does not invoke the executor again and remains explicitly marked idempotent. The archive step repeats that lookup internally, which makes a retry safe if Git committed the acquisition before the Work checkpoint was recorded.

Reusing a request ID with different request metadata fails closed. Provider requests must continue from the last accepted checkpoint, and numeric checkpoint generations cannot move backwards.

This broker remains read-only and local-first. Durable failure receipts, concurrent request fencing, document-ID collision references, portable qualified executor targets, and production GitHub/OpenAI/ChatGPT bindings remain follow-on work under the provider epic.
