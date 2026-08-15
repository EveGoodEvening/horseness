const FORBIDDEN_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "CI_JOB_TOKEN",
  "OPENAI_API_KEY",
]);

const ALLOWED_NONSECRET_FIELD_NAMES = new Set(["authMode"]);
const FORBIDDEN_FIELD_TOKENS = new Set(["authorization", "cookie", "credential", "password", "secret", "token"]);

function fieldNameTokens(key) {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map(token => token.toLowerCase());
}

function isCredentialBearingFieldName(key) {
  if (ALLOWED_NONSECRET_FIELD_NAMES.has(key)) return false;
  const tokens = fieldNameTokens(key);
  if (tokens.some(token => FORBIDDEN_FIELD_TOKENS.has(token))) return true;
  return tokens.some((token, index) => token === "key" && (tokens[index - 1] === "api" || tokens[index - 1] === "private"));
}

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
        if (FORBIDDEN_ENV_KEYS.has(key.toUpperCase()) || isCredentialBearingFieldName(key)) {
          findings.push(`${pathLabel(childPath)} has a credential-bearing key`);
        }
        visit(child, childPath);
      }
      return;
    }

    if (typeof current !== "string") return;

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
