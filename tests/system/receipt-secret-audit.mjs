const FORBIDDEN_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "CI_JOB_TOKEN",
  "OPENAI_API_KEY",
]);

const FORBIDDEN_FIELD_NAMES = /^(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|session[_-]?token|token)$/iu;
const FORBIDDEN_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]+/iu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /\b(?:gh[oprsu]_[A-Za-z0-9]{20,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,})\b/u,
];

function pathLabel(path) {
  return path.length === 0 ? "$" : `$.${path.join(".")}`;
}

export function findReceiptAuthMaterial(value) {
  const findings = [];

  function visit(current, path) {
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        visit(current[index], [...path, String(index)]);
      }
      return;
    }

    if (current !== null && typeof current === "object") {
      for (const [key, child] of Object.entries(current)) {
        const childPath = [...path, key];
        if (FORBIDDEN_ENV_KEYS.has(key.toUpperCase()) || FORBIDDEN_FIELD_NAMES.test(key)) {
          findings.push(`${pathLabel(childPath)} has a credential-bearing key`);
        }
        visit(child, childPath);
      }
      return;
    }

    if (typeof current !== "string") return;
    const containerKey = path.at(-2);
    if (containerKey === "prohibitedFields") return;
    if (FORBIDDEN_ENV_KEYS.has(current.toUpperCase())) {
      findings.push(`${pathLabel(path)} names a credential environment variable`);
      return;
    }
    if (FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(current))) {
      findings.push(`${pathLabel(path)} contains credential-shaped material`);
    }
  }

  visit(value, []);
  return findings;
}
