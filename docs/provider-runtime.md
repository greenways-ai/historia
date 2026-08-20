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

The broker defaults to the store-free `work.eval/run` interpretation. This keeps the first provider runtime dependent only on the Work algebra and an executor; it does not construct a run journal, checkpoint store, outbox, receipt publisher, lease manager or SQL provider. Repeating an ordinary provider execution therefore invokes the provider again.

A caller may inject a canonical five-key Runtime with `:work/runtime`. A Runtime whose `:work/store` is nil remains bare while retaining its executor, registry, policy and hooks. A Runtime with an `IWorkStore` selects the managed path explicitly; managed provider execution is not the default until its native Historia conformance is independently green.

Work durability and Historia durability are deliberately separate:

- `IWorkStore` records execution runs, step checkpoints and committed Work events when a managed Runtime is selected.
- The Git acquisition ledger records original source bytes, provider checkpoints and immutable acquisition receipts.

The Git ledger is the cross-process authority. A process restart or a different broker instance can determine whether an acquisition was committed by reading the immutable request receipt from Git. Work execution storage may later add managed replay without changing provider envelopes, source-document records or archive identity.

## Acquisition ledger

Original observation bytes are written to the bare Git vault before a receipt commit is published. The receipt records the exact request, accepted checkpoint, provider-neutral source documents, completeness evidence, warnings and the previous provider receipt commit. One atomic `git update-ref --stdin` transaction advances:

- the global acquisition head;
- the provider-specific acquisition head;
- the immutable request-ID receipt reference.

A repeated request ID resolves to the existing receipt before Work is submitted, so it does not invoke the executor again and remains explicitly marked idempotent. The archive step repeats that lookup internally, which makes a retry safe if Git committed the acquisition before the Work interpretation returned.

Reusing a request ID with different request metadata fails closed. Provider requests must continue from the last accepted checkpoint, and numeric checkpoint generations cannot move backwards. Acquisition Work identity also includes the target vault so a future managed store cannot replay a receipt from one vault into another.

This broker remains read-only and local-first. Managed-runtime conformance, durable failure receipts, concurrent request fencing, document-ID collision references, portable qualified executor targets, and production GitHub/OpenAI/ChatGPT bindings remain follow-on work under the provider epic.
