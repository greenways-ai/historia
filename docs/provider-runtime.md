# Provider runtime

Historia providers are split into portable descriptors and capability-owning executor bindings.

```text
historia-core provider descriptor
  -> Historia broker binding
  -> Hara work/step execution
  -> sanitized provider observation
  -> content-addressed Git blobs
  -> append-only acquisition receipt commit
  -> provider-neutral source documents
```

`greenways/historia-core` owns only descriptors, request/result envelopes, source-document records and exact anchors. It does not own browser, network, process, filesystem, Git or credential capabilities.

The Historia runtime binds a registered provider ID to an executor function. The executor is wrapped as a `work/step`, receives a provider request plus the ordinary Hara work context, and returns a bounded `historia.provider-observation-result/0-alpha` value. Credentials remain inside the executor implementation. Request options, observations, completeness evidence and warnings are recursively checked for credential-shaped fields before persistence.

Original observation bytes are written to the bare Git vault before a receipt commit is published. The receipt records the exact request, accepted checkpoint, provider-neutral source documents, completeness evidence, warnings and the previous provider receipt commit. One atomic `git update-ref --stdin` transaction advances:

- the global acquisition head;
- the provider-specific acquisition head;
- the immutable request-ID receipt reference.

A repeated request ID resolves to the existing receipt without invoking the executor again. Reusing a request ID with different request metadata fails closed. Provider requests must continue from the last accepted checkpoint, and numeric checkpoint generations cannot move backwards.

This first broker slice intentionally remains read-only and local-first. Durable failure receipts, concurrent request fencing, document-ID collision references and production GitHub/ChatGPT executors remain follow-on work under the provider epic.
