import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

const files = {
  packageJson: resolve(root, 'package.json'),
  releaseScript: resolve(root, 'scripts/release.sh'),
  testWorkflow: resolve(root, '.github/workflows/test.yml'),
  releaseWorkflow: resolve(root, '.github/workflows/release.yml'),
  eslintConfig: resolve(root, 'eslint.config.js'),
  cargoToml: resolve(root, 'src-tauri/Cargo.toml'),
};

const packageJson = JSON.parse(readFileSync(files.packageJson, 'utf8'));
const packageLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const releaseScript = readFileSync(files.releaseScript, 'utf8');
const testWorkflow = readFileSync(files.testWorkflow, 'utf8');
const releaseWorkflow = readFileSync(files.releaseWorkflow, 'utf8');
const eslintConfig = readFileSync(files.eslintConfig, 'utf8');
const cargoToml = readFileSync(files.cargoToml, 'utf8');

const requiredScripts = [
  'lint',
  'lint:ts',
  'lint:eslint',
  'lint:readme',
  'lint:i18n',
  'lint:ci-gates',
  'lint:macos-permissions',
  'lint:rust',
  'validate:fda-evidence',
  'validate:macos-app',
  'validate:macos-app:release',
  'validate:macos-permission-release',
  'test',
  'test:rust',
  'build',
  'clean:release',
];

const requiredScriptImplementations = new Map([
  ['build', 'vite build'],
  ['clean:release', 'rm -rf dist src-tauri/target/release/bundle src-tauri/target/universal-apple-darwin/release/bundle'],
  ['test', 'vitest run'],
  ['lint:ts', 'tsc --noEmit'],
  ['lint:eslint', 'eslint .'],
  ['lint:readme', 'node scripts/check-readme-sync.mjs'],
  ['lint:i18n', 'node scripts/check-i18n-coverage.mjs'],
  ['lint:ci-gates', 'node scripts/check-ci-gates.mjs'],
  ['lint:macos-permissions', 'node scripts/validate-macos-permission-model.mjs'],
  ['lint:rust', 'cd src-tauri && cargo clippy --lib -- -D warnings'],
  ['validate:fda-evidence', 'node scripts/validate-fda-evidence.mjs'],
  ['validate:macos-app', 'node scripts/validate-macos-app-bundle.mjs'],
  ['validate:macos-app:release', 'node scripts/validate-macos-app-bundle.mjs --require-signature'],
  ['validate:macos-permission-release', 'node scripts/validate-macos-permission-release-evidence.mjs'],
  ['test:rust', 'cd src-tauri && cargo test --lib'],
]);

const requiredTestCommands = [
  'npm run lint',
  'npm run lint:readme',
  'npm run lint:i18n',
  'npm run lint:ci-gates',
  'npm run lint:rust',
  'npm test',
  'npm run test:rust',
  'npm run build',
];

const requiredTestWorkflowBranches = [
  'main',
  "'feat/**'",
  "'fix/**'",
  "'test/**'",
  "'codex/**'",
  "'codex-*'",
];

const requiredPullRequestTarget = /pull_request:\n\s+branches:\s+\[main\]/;

const requiredReleaseGateCommands = [
  'npm run lint',
  'npm run lint:readme',
  'npm run lint:i18n',
  'npm run lint:ci-gates',
  'npm run lint:rust',
  'npm test',
  'npm run test:rust',
  'npm run build',
];

const requiredReleaseWorkflowTriggers = [
  'tags:',
  "- 'v*'",
  'workflow_dispatch:',
  'tag_name:',
  'required: true',
  'type: string',
];

const requiredReleaseWorkflowSecurityChecks = [
  'permissions:',
  'contents: write',
  "if: ${{ !contains(github.ref_name, '-adhoc') && !(github.event_name == 'workflow_dispatch' && contains(inputs.tag_name, '-adhoc')) }}",
  'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}',
  'APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}',
  'APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}',
  'missing TAURI_SIGNING_PRIVATE_KEY secret',
  'missing APPLE_CERTIFICATE secret; updater signing is not macOS app code signing',
  'APPLE_CERTIFICATE secret must be base64-encoded .p12 content',
  'openssl pkcs12 -in "$CERT_FILE" -nokeys -passin "pass:${APPLE_CERTIFICATE_PASSWORD:-}"',
  'openssl pkcs12 -in "$CERT_FILE" -nocerts -nodes -passin "pass:${APPLE_CERTIFICATE_PASSWORD:-}" -out "$KEY_FILE"',
  'APPLE_CERTIFICATE .p12 must include a private key for macOS app code signing',
  'GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
];

const requiredRustToolchainCommands = [
  'components: clippy',
];

const requiredTestWorkflowSetupCommands = [
  'actions/setup-node@v4',
  'node-version: 20',
  'cache: npm',
  'swatinem/rust-cache@v2',
  'workspaces: src-tauri',
  'npm ci',
];

const requiredReleaseTestGateSetupCommands = [
  'actions/setup-node@v4',
  'node-version: 20',
  'cache: npm',
  'swatinem/rust-cache@v2',
  'workspaces: src-tauri',
  'npm ci',
];

const requiredReleaseJobSetupCommands = [
  'actions/setup-node@v4',
  'node-version: 20',
  'cache: npm',
  'swatinem/rust-cache@v2',
  'workspaces: src-tauri',
  'npm ci',
  'targets: aarch64-apple-darwin,x86_64-apple-darwin',
];

const requiredTimeoutChecks = [
  ['test.yml test job', testWorkflow, 'timeout-minutes: 20'],
  ['release.yml test-gate job', () => releaseGate, 'timeout-minutes: 20'],
  ['release.yml release job', () => releaseJob, 'timeout-minutes: 60'],
];

const requiredReleaseWorkflowCommands = [
  'npm run clean:release',
  'npx @tauri-apps/cli build --target universal-apple-darwin',
  'src-tauri/target/universal-apple-darwin/release/bundle',
  'find "$BUNDLE_DIR/dmg" -type f -name \'*.dmg\' 2>/dev/null | head -n 1 || true',
  'find "$BUNDLE_DIR/macos" -type f -name \'*.app.tar.gz\' 2>/dev/null | head -n 1 || true',
  'find "$BUNDLE_DIR/macos" -type f -name \'*.app.tar.gz.sig\' 2>/dev/null | head -n 1 || true',
  'APP_BUNDLE="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -type d -name \'*.app\' 2>/dev/null | head -n 1 || true)"',
  'npm run validate:macos-app:release -- "$APP_BUNDLE"',
  'SHA256SUMS',
  'shasum -a 256',
  'shasum -a 256 -c SHA256SUMS',
  'cmp -s "$CHECKSUMS" -',
  'gh release upload stable -R "$REPO" "$LATEST_JSON" --clobber',
  'gh release delete-asset stable "$asset" -R "$REPO" -y',
  '[.assets[].name] == ["latest.json"]',
  '--clobber',
];

const requiredReleaseScriptCommands = [
  'npm run build',
  'npm run clean:release',
  'npx @tauri-apps/cli build --target universal-apple-darwin',
  'src-tauri/target/universal-apple-darwin/release/bundle',
  'find "$BUNDLE_DIR/dmg" -type f -name "*.dmg" 2>/dev/null | head -n 1 || true',
  'find "$BUNDLE_DIR/macos" -type f -name "*.app.tar.gz" 2>/dev/null | head -n 1 || true',
  'find "$BUNDLE_DIR/macos" -type f -name "*.app.tar.gz.sig" 2>/dev/null | head -n 1 || true',
  'APP_BUNDLE="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -type d -name "*.app" 2>/dev/null | head -n 1 || true)"',
  'npm run validate:macos-app:release -- "$APP_BUNDLE"',
  'CHANGELOG.md',
  'NOTES="$(awk -v ver="$VERSION"',
  '[ -n "$NOTES" ] || NOTES="Aether Explorer $TAG"',
  '--arg notes "$NOTES"',
  '--notes "$NOTES"',
  'SHA256SUMS',
  'shasum -a 256',
  'shasum -a 256 -c SHA256SUMS',
  'cmp -s "$CHECKSUMS" -',
  'gh release upload stable -R "$REPO" "$LATEST_JSON" --clobber',
  'gh release delete-asset stable "$asset" -R "$REPO" -y',
  '[.assets[].name] == ["latest.json"]',
];

const requiredReleaseScriptSecurityChecks = [
  'PRIVATE_KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/aether-updater.key}"',
  '[ -f "$PRIVATE_KEY_PATH" ]',
  'command -v jq >/dev/null',
  'command -v gh >/dev/null',
  'command -v security >/dev/null',
  'command -v openssl >/dev/null',
  'gh auth status >/dev/null 2>&1',
  'APPLE_CERTIFICATE 必须是 base64 编码的 .p12 内容',
  'openssl pkcs12 -in "$CERT_FILE" -nokeys -passin "pass:${APPLE_CERTIFICATE_PASSWORD:-}"',
  'openssl pkcs12 -in "$CERT_FILE" -nocerts -nodes -passin "pass:${APPLE_CERTIFICATE_PASSWORD:-}" -out "$KEY_FILE"',
  'APPLE_CERTIFICATE .p12 必须包含用于 macOS app 代码签名的私钥',
  'security find-identity -v -p codesigning',
  '"Developer ID Application:',
  '缺少 Apple .app 代码签名身份',
  'TAURI_SIGNING_PRIVATE_KEY 只签 updater artifact',
  'export TAURI_SIGNING_PRIVATE_KEY="$(cat "$PRIVATE_KEY_PATH")"',
  'export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"',
  'export APPLE_CERTIFICATE="${APPLE_CERTIFICATE:-}"',
  'export APPLE_CERTIFICATE_PASSWORD="${APPLE_CERTIFICATE_PASSWORD:-}"',
];

const requiredReleaseWorkflowVersionChecks = [
  'invalid RELEASE_TAG',
  'tauri.conf.json version $TAURI_VERSION does not match $RELEASE_TAG',
  'package.json version $PACKAGE_VERSION does not match $RELEASE_TAG',
  'package-lock.json version $LOCK_VERSION does not match $RELEASE_TAG',
  'Cargo.toml version $CARGO_VERSION does not match $RELEASE_TAG',
];

const requiredReleaseScriptVersionChecks = [
  'PACKAGE_VERSION="$(jq -r \'.version\' "$PACKAGE_FILE")"',
  'LOCK_VERSION="$(jq -r \'.version\' "$LOCK_FILE")"',
  'CARGO_VERSION="$(awk -F \' *= *\'',
  '$PACKAGE_FILE version $PACKAGE_VERSION 与 $CONF_FILE version $VERSION 不一致',
  '$LOCK_FILE version $LOCK_VERSION 与 $CONF_FILE version $VERSION 不一致',
  '$CARGO_FILE version $CARGO_VERSION 与 $CONF_FILE version $VERSION 不一致',
];

const requiredLocalReleaseGateCommands = [
  'npm run lint',
  'npm run lint:readme',
  'npm run lint:i18n',
  'npm run lint:ci-gates',
  'npm test',
  'npm run test:rust',
  'npm run lint:rust',
  'npm run build',
];

const requiredDependencyResolutions = [
  ['@vitejs/plugin-react', 'node_modules/@vitejs/plugin-react', /^5\./],
  ['motion', 'node_modules/motion', /^12\./],
  ['vite', 'node_modules/vite', /^6\./],
];

const failures = [];

for (const scriptName of requiredScripts) {
  if (!packageJson.scripts?.[scriptName]) {
    failures.push(`package.json is missing script "${scriptName}".`);
  }
}

for (const [scriptName, requiredCommand] of requiredScriptImplementations) {
  const actualCommand = packageJson.scripts?.[scriptName];
  if (!actualCommand?.includes(requiredCommand)) {
    failures.push(`package.json script "${scriptName}" must run "${requiredCommand}".`);
  }
}

if (
  !packageJson.scripts?.lint?.includes('lint:ts')
  || !packageJson.scripts?.lint?.includes('lint:eslint')
  || !packageJson.scripts?.lint?.includes('lint:macos-permissions')
) {
  failures.push('package.json script "lint" must run lint:ts, lint:eslint, and lint:macos-permissions.');
}

if (packageJson.dependencies?.vite) {
  failures.push('package.json must not list vite in dependencies; keep it in devDependencies only.');
}

if (!packageJson.devDependencies?.vite) {
  failures.push('package.json must keep vite in devDependencies.');
}

for (const [dependencyName, lockPath, versionPattern] of requiredDependencyResolutions) {
  const lockedVersion = packageLock.packages?.[lockPath]?.version;
  if (!lockedVersion || !versionPattern.test(lockedVersion)) {
    failures.push(`package-lock.json must resolve ${dependencyName} to the expected major version.`);
  }
}

if (!/ssh2\s*=\s*\{[^\n]*features\s*=\s*\[[^\]]*"vendored-openssl"/.test(cargoToml)) {
  failures.push('src-tauri/Cargo.toml must enable ssh2 vendored-openssl for universal macOS release builds.');
}

if (!eslintConfig.includes("'react-hooks/exhaustive-deps': 'error'")) {
  failures.push('eslint.config.js must keep react-hooks/exhaustive-deps at error severity.');
}

if (!eslintConfig.includes("'react-hooks/rules-of-hooks': 'error'")) {
  failures.push('eslint.config.js must keep react-hooks/rules-of-hooks at error severity.');
}

if (!eslintConfig.includes("'no-restricted-globals': ['error', 'alert', 'prompt', 'confirm']")) {
  failures.push('eslint.config.js must keep browser alert/prompt/confirm globally restricted.');
}

if (!eslintConfig.includes("'no-console': ['error', { allow: ['warn', 'error', 'info', 'group', 'groupEnd', 'table'] }]")) {
  failures.push('eslint.config.js must keep console.log/debug restricted while allowing intentional console diagnostics.');
}

for (const command of requiredTestCommands) {
  if (!testWorkflow.includes(command)) {
    failures.push(`test.yml is missing required gate command: ${command}`);
  }
}

for (const command of requiredTestWorkflowSetupCommands) {
  if (!testWorkflow.includes(command)) {
    failures.push(`test.yml is missing required CI setup command: ${command}`);
  }
}

for (const branchPattern of requiredTestWorkflowBranches) {
  if (!testWorkflow.includes(branchPattern)) {
    failures.push(`test.yml is missing work branch trigger: ${branchPattern}`);
  }
}

if (!requiredPullRequestTarget.test(testWorkflow)) {
  failures.push('test.yml must run on pull_request targeting main.');
}

for (const trigger of requiredReleaseWorkflowTriggers) {
  if (!releaseWorkflow.includes(trigger)) {
    failures.push(`release.yml is missing release trigger configuration: ${trigger}`);
  }
}

for (const check of requiredReleaseWorkflowSecurityChecks) {
  if (!releaseWorkflow.includes(check)) {
    failures.push(`release.yml is missing release security configuration: ${check}`);
  }
}

for (const command of requiredRustToolchainCommands) {
  if (!testWorkflow.includes(command)) {
    failures.push(`test.yml is missing required Rust toolchain option: ${command}`);
  }
  if (!releaseWorkflow.includes(command)) {
    failures.push(`release.yml is missing required Rust toolchain option: ${command}`);
  }
}

const releaseGateMatch = releaseWorkflow.match(/jobs:\n[\s\S]*?\n {2}release:/);
const releaseGate = releaseGateMatch?.[0] ?? '';
const releaseJobMatch = releaseWorkflow.match(/\n {2}release:\n[\s\S]*?(?=\n {2}\S|\n?$)/);
const releaseJob = releaseJobMatch?.[0] ?? '';

if (!releaseGate) {
  failures.push('release.yml is missing a test-gate job before the release job.');
} else {
  for (const command of requiredReleaseGateCommands) {
    if (!releaseGate.includes(command)) {
      failures.push(`release.yml test-gate is missing required command: ${command}`);
    }
  }
  for (const command of requiredReleaseTestGateSetupCommands) {
    if (!releaseGate.includes(command)) {
      failures.push(`release.yml test-gate is missing required CI setup command: ${command}`);
    }
  }
}

if (!releaseJob.includes('\n    needs: test-gate')) {
  failures.push('release.yml release job must depend on test-gate.');
}

for (const [label, source, timeout] of requiredTimeoutChecks) {
  const content = typeof source === 'function' ? source() : source;
  if (!content.includes(timeout)) {
    failures.push(`${label} must keep ${timeout}.`);
  }
}

for (const command of requiredReleaseJobSetupCommands) {
  if (!releaseJob.includes(command)) {
    failures.push(`release.yml release job is missing required CI setup command: ${command}`);
  }
}

for (const command of requiredReleaseWorkflowCommands) {
  if (!releaseWorkflow.includes(command)) {
    failures.push(`release.yml is missing release integrity command: ${command}`);
  }
}

for (const command of requiredReleaseWorkflowVersionChecks) {
  if (!releaseWorkflow.includes(command)) {
    failures.push(`release.yml is missing release version validation: ${command}`);
  }
}

for (const command of requiredReleaseScriptCommands) {
  if (!releaseScript.includes(command)) {
    failures.push(`scripts/release.sh is missing release integrity command: ${command}`);
  }
}

for (const check of requiredReleaseScriptSecurityChecks) {
  if (!releaseScript.includes(check)) {
    failures.push(`scripts/release.sh is missing release security check: ${check}`);
  }
}

for (const command of requiredReleaseScriptVersionChecks) {
  if (!releaseScript.includes(command)) {
    failures.push(`scripts/release.sh is missing release version validation: ${command}`);
  }
}

for (const command of requiredLocalReleaseGateCommands) {
  if (!releaseScript.includes(command)) {
    failures.push(`scripts/release.sh is missing local release gate command: ${command}`);
  }
}

if (failures.length > 0) {
  console.error('CI gate check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `CI gate check passed: ${requiredTestCommands.length} test gates, ${requiredReleaseGateCommands.length} release gates, ${requiredLocalReleaseGateCommands.length} local release gates, ${requiredScriptImplementations.size} script implementations, ${requiredDependencyResolutions.length} dependency resolution checks, ${requiredTestWorkflowSetupCommands.length + requiredReleaseTestGateSetupCommands.length + requiredReleaseJobSetupCommands.length} CI setup checks, ${requiredTimeoutChecks.length} timeout checks, ${requiredTestWorkflowBranches.length} work branch triggers, 1 pull request target, ${requiredReleaseWorkflowTriggers.length} release trigger checks, ${requiredReleaseWorkflowSecurityChecks.length + requiredReleaseScriptSecurityChecks.length} release security checks, ${requiredReleaseWorkflowVersionChecks.length + requiredReleaseScriptVersionChecks.length} version checks, and release integrity checks verified.`,
);
