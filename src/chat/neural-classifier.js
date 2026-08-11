import { sha256 } from "./identity.js";

export const NEURAL_CLASSIFIER_SCHEMA = "historia.chat.neural-classifier/0-alpha";
export const DEFAULT_NEURAL_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_NEURAL_MODEL_REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";
export const DEFAULT_NEURAL_DIMENSIONS = 384;
export const DEFAULT_TRANSFORMERS_MODULE = "@huggingface/transformers";

export const DEFAULT_LABEL_PROTOTYPES = Object.freeze({
  question: "A question asking for information, clarification, explanation, or verification.",
  request: "A request asking someone or an agent to perform an action or produce something.",
  proposal: "A proposal or suggestion for a possible design, plan, feature, or course of action.",
  constraint: "A requirement, limitation, prohibition, invariant, or condition that must be respected.",
  rejection: "A rejection, objection, negative preference, or statement that an option should not be used.",
  acceptance: "An acceptance, approval, confirmation, or agreement to proceed with an option.",
  decision: "A settled decision, chosen direction, adopted design, or committed course of action.",
  status: "A progress or operational status report describing completion, failure, deployment, or current state.",
  rationale: "A reason, justification, explanation, cause, tradeoff, or motivation for a choice.",
  correction: "A correction, replacement, revision, clarification, or reframing of an earlier statement."
});

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

export function normalizeVector(values) {
  const source = Array.from(values ?? [], (value, index) => finiteNumber(value, `vector[${index}]`));
  if (!source.length) throw new Error("embedding vector must not be empty");
  const norm = Math.sqrt(source.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= 0) throw new Error("embedding vector has zero or invalid norm");
  return Float32Array.from(source, (value) => value / norm);
}

export function cosineSimilarity(left, right) {
  if (!left || !right || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index]);
    const rightValue = Number(right[index]);
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator > 0 ? dot / denominator : 0;
}

export function vectorToBlob(vector) {
  const normalized = vector instanceof Float32Array ? vector : Float32Array.from(vector ?? []);
  const bytes = Buffer.allocUnsafe(normalized.length * 4);
  for (let index = 0; index < normalized.length; index += 1) bytes.writeFloatLE(normalized[index], index * 4);
  return bytes;
}

export function blobToVector(blob, dimensions = null) {
  const bytes = Buffer.from(blob ?? []);
  if (bytes.length % 4 !== 0) throw new Error("float32 vector blob length must be divisible by four");
  const count = bytes.length / 4;
  if (dimensions !== null && Number(dimensions) !== count) {
    throw new Error(`vector dimensions mismatch: expected ${dimensions}, received ${count}`);
  }
  const vector = new Float32Array(count);
  for (let index = 0; index < count; index += 1) vector[index] = bytes.readFloatLE(index * 4);
  return vector;
}

function normalizedTexts(texts) {
  const values = (Array.isArray(texts) ? texts : [texts]).map((value) => String(value ?? "").normalize("NFKC").trim());
  if (!values.length) throw new Error("at least one text value is required");
  return values;
}

function normalizeEmbeddingBatch(vectors, count, expectedDimensions = null) {
  if (!Array.isArray(vectors) || vectors.length !== count) {
    throw new Error(`embedding adapter returned ${Array.isArray(vectors) ? vectors.length : "an invalid value"}; expected ${count} vectors`);
  }
  let dimensions = expectedDimensions;
  const normalized = vectors.map((vector, index) => {
    const value = normalizeVector(vector);
    dimensions ??= value.length;
    if (value.length !== dimensions) throw new Error(`embedding ${index} has ${value.length} dimensions; expected ${dimensions}`);
    return value;
  });
  return { vectors: normalized, dimensions };
}

function classifierDescriptor(encoderDescriptor, labelPrototypes) {
  const labels = Object.entries(labelPrototypes)
    .map(([label, prototype]) => ({ label, prototype: String(prototype) }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const value = {
    $schema: NEURAL_CLASSIFIER_SCHEMA,
    runtime: encoderDescriptor.runtime ?? "custom",
    runtime_module: encoderDescriptor.runtime_module ?? null,
    model_id: encoderDescriptor.model_id ?? "custom",
    model_revision: encoderDescriptor.model_revision ?? null,
    device: encoderDescriptor.device ?? "custom",
    dtype: encoderDescriptor.dtype ?? "float32",
    pooling: encoderDescriptor.pooling ?? "mean",
    normalize: encoderDescriptor.normalize !== false,
    dimensions: Number(encoderDescriptor.dimensions) || null,
    strategy: "prototype-cosine",
    labels
  };
  return { ...value, fingerprint: sha256(value) };
}

export function createPrototypeClassifier({
  descriptor = {},
  embed,
  labelPrototypes = DEFAULT_LABEL_PROTOTYPES
} = {}) {
  if (typeof embed !== "function") throw new Error("a neural embedding function is required");
  const classifier = classifierDescriptor(descriptor, labelPrototypes);
  let prototypePromise = null;
  let resolvedDimensions = classifier.dimensions;

  const embedBatch = async (texts) => {
    const values = normalizedTexts(texts);
    const raw = await embed(values);
    const normalized = normalizeEmbeddingBatch(raw, values.length, resolvedDimensions);
    resolvedDimensions ??= normalized.dimensions;
    return normalized.vectors;
  };

  const labelVectors = async () => {
    if (!prototypePromise) {
      prototypePromise = (async () => {
        const entries = classifier.labels;
        const vectors = await embedBatch(entries.map((entry) => entry.prototype));
        return new Map(entries.map((entry, index) => [entry.label, vectors[index]]));
      })();
    }
    return prototypePromise;
  };

  const classifyBatch = async (texts, {
    threshold = 0.42,
    maxLabels = 4
  } = {}) => {
    const values = normalizedTexts(texts);
    const [vectors, prototypes] = await Promise.all([embedBatch(values), labelVectors()]);
    return values.map((text, index) => {
      const scores = [...prototypes].map(([label, vector]) => ({
        label,
        score: Number(cosineSimilarity(vectors[index], vector).toFixed(6))
      })).sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
      const selected = scores.filter((entry) => entry.score >= Number(threshold))
        .slice(0, Math.max(1, Math.min(20, Number(maxLabels) || 4)));
      return {
        text,
        vector: vectors[index],
        labels: selected,
        top_labels: scores.slice(0, Math.max(1, Math.min(20, Number(maxLabels) || 4)))
      };
    });
  };

  return {
    descriptor: classifier,
    embed: embedBatch,
    classifyBatch,
    dispose: async () => {}
  };
}

async function dynamicImport(specifier) {
  const importer = new Function("value", "return import(value)");
  return importer(specifier);
}

export async function createTransformersJsClassifier({
  moduleSpecifier = process.env.HISTORIA_TRANSFORMERS_MODULE ?? DEFAULT_TRANSFORMERS_MODULE,
  modelId = process.env.HISTORIA_NEURAL_MODEL ?? DEFAULT_NEURAL_MODEL_ID,
  modelRevision = process.env.HISTORIA_NEURAL_MODEL_REVISION ?? DEFAULT_NEURAL_MODEL_REVISION,
  device = process.env.HISTORIA_NEURAL_DEVICE ?? null,
  dtype = process.env.HISTORIA_NEURAL_DTYPE ?? null,
  dimensions = DEFAULT_NEURAL_DIMENSIONS,
  cacheDir = process.env.HISTORIA_NEURAL_CACHE ?? null,
  localFilesOnly = false,
  labelPrototypes = DEFAULT_LABEL_PROTOTYPES
} = {}) {
  let transformers;
  try {
    transformers = await dynamicImport(moduleSpecifier);
  } catch (error) {
    throw new Error(
      `Transformers.js is optional and could not be loaded from ${moduleSpecifier}. `
      + "Install @huggingface/transformers beside the Historia source checkout, or set "
      + "HISTORIA_TRANSFORMERS_MODULE to an importable module path. "
      + `Underlying error: ${error.message}`
    );
  }
  if (typeof transformers.pipeline !== "function") throw new Error(`${moduleSpecifier} does not export pipeline()`);
  if (transformers.env) {
    if (cacheDir) transformers.env.cacheDir = cacheDir;
    if (localFilesOnly) {
      transformers.env.allowRemoteModels = false;
      transformers.env.allowLocalModels = true;
    }
  }
  const selectedDevice = device || "wasm";
  const selectedDtype = dtype || (selectedDevice === "webgpu" ? "fp16" : "q8");
  const options = {
    revision: modelRevision,
    dtype: selectedDtype
  };
  if (selectedDevice !== "wasm") options.device = selectedDevice;
  const extractor = await transformers.pipeline("feature-extraction", modelId, options);
  const embed = async (texts) => {
    const output = await extractor(texts, {
      pooling: "mean",
      normalize: true,
      truncation: true
    });
    const values = typeof output?.tolist === "function" ? output.tolist() : output;
    return Array.isArray(values?.[0]) ? values : [values];
  };
  const classifier = createPrototypeClassifier({
    descriptor: {
      runtime: "transformers.js",
      runtime_module: moduleSpecifier,
      model_id: modelId,
      model_revision: modelRevision,
      device: selectedDevice,
      dtype: selectedDtype,
      pooling: "mean",
      normalize: true,
      dimensions
    },
    embed,
    labelPrototypes
  });
  return {
    ...classifier,
    dispose: async () => {
      if (typeof extractor?.dispose === "function") await extractor.dispose();
    }
  };
}
