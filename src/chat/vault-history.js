function assertHistoriaRef(ref) {
  if (typeof ref !== "string" || !ref.startsWith("refs/historia/sources/") || /[\0\n\r\t ]/.test(ref)) {
    throw new Error(`invalid Historia ref: ${ref}`);
  }
  return ref;
}

export async function listHistoriaSourceRefs(vault, prefix = "refs/historia/sources/") {
  assertHistoriaRef(prefix);
  const output = await vault.git(["for-each-ref", "--format=%(refname)%09%(objectname)", prefix]);
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("\t");
    if (separator < 0) throw new Error(`unexpected Git ref listing: ${line}`);
    return { ref: line.slice(0, separator), oid: line.slice(separator + 1) };
  }).sort((left, right) => left.ref.localeCompare(right.ref));
}

export async function commitsForHistoriaRef(vault, ref) {
  assertHistoriaRef(ref);
  const output = await vault.git(["rev-list", "--topo-order", "--reverse", ref]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

export async function historiaCommitMetadata(vault, oid) {
  if (!/^[a-f0-9]{40,64}$/i.test(String(oid))) throw new Error(`invalid commit oid: ${oid}`);
  const output = await vault.git([
    "show",
    "-s",
    "--format=%H%x00%P%x00%aI%x00%cI%x00%B",
    oid
  ]);
  const [commitOid, parentText, authoredAt, committedAt, ...messageParts] = output.split("\0");
  return {
    oid: commitOid,
    parents: parentText ? parentText.split(" ").filter(Boolean) : [],
    authoredAt: authoredAt || null,
    committedAt: committedAt || null,
    message: messageParts.join("\0").trim()
  };
}

export async function changedHistoriaPaths(vault, oid, parentOid = null) {
  const args = parentOid
    ? ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", parentOid, oid, "--"]
    : ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", oid, "--"];
  const output = await vault.git(args);
  return output ? [...new Set(output.split("\0").filter(Boolean))].sort() : [];
}
