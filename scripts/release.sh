#!/usr/bin/env bash
# 发布 Aether Explorer 的新版本：
#   1. 校验环境（私钥、gh、jq）
#   2. 读取 tauri.conf.json 的版本号作为 tag
#   3. 通过 tauri build 自动签名生成 .app.tar.gz / .app.tar.gz.sig
#   4. 生成 latest.json，连同 dmg / app.tar.gz / sig 一并上传到 GitHub Release
#
# 使用：
#   bash scripts/release.sh
#
# 环境变量：
#   TAURI_SIGNING_PRIVATE_KEY_PATH   私钥路径，默认 ~/.tauri/aether-updater.key
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  私钥密码，若空则按无密码处理
#   APPLE_CERTIFICATE                 可选，Developer ID Application .p12 的 base64 内容，用于 macOS .app 代码签名
#   APPLE_CERTIFICATE_PASSWORD        可选，Developer ID Application .p12 密码，若空则按无密码处理
#   GITHUB_REPO                       默认 HaoRangQi/aether-explorer

set -euo pipefail

REPO="${GITHUB_REPO:-HaoRangQi/aether-explorer}"
PRIVATE_KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/aether-updater.key}"
CONF_FILE="src-tauri/tauri.conf.json"
CARGO_FILE="src-tauri/Cargo.toml"
PACKAGE_FILE="package.json"
LOCK_FILE="package-lock.json"

# ─── 前置校验 ────────────────────────────────────────────────────
[ -f "$CONF_FILE" ] || { echo "❌ 必须在仓库根目录运行：找不到 $CONF_FILE"; exit 1; }
[ -f "$CARGO_FILE" ] || { echo "❌ 必须在仓库根目录运行：找不到 $CARGO_FILE"; exit 1; }
[ -f "$PACKAGE_FILE" ] || { echo "❌ 必须在仓库根目录运行：找不到 $PACKAGE_FILE"; exit 1; }
[ -f "$LOCK_FILE" ] || { echo "❌ 必须在仓库根目录运行：找不到 $LOCK_FILE"; exit 1; }
[ -f "$PRIVATE_KEY_PATH" ] || { echo "❌ 私钥不存在：$PRIVATE_KEY_PATH"; exit 1; }
command -v jq >/dev/null || { echo "❌ 需要安装 jq"; exit 1; }
command -v gh >/dev/null || { echo "❌ 需要安装 gh CLI 并完成 gh auth login"; exit 1; }
command -v security >/dev/null || { echo "❌ 需要 macOS security 工具检查代码签名身份"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "❌ gh 未登录，请运行 gh auth login"; exit 1; }

if [ -n "${APPLE_CERTIFICATE:-}" ]; then
  command -v openssl >/dev/null || { echo "❌ 需要 openssl 校验 APPLE_CERTIFICATE"; exit 1; }
  CERT_FILE="$(mktemp -t aether-apple-cert)"
  KEY_FILE="$(mktemp -t aether-apple-cert-key)"
  trap 'rm -f "$CERT_FILE" "$KEY_FILE"' EXIT
  printf '%s' "$APPLE_CERTIFICATE" | base64 -d > "$CERT_FILE" || {
    echo "❌ APPLE_CERTIFICATE 必须是 base64 编码的 .p12 内容"
    exit 1
  }
  CERT_BYTES="$(wc -c < "$CERT_FILE" | tr -d '[:space:]')"
  [ "$CERT_BYTES" -gt 100 ] || {
    echo "❌ APPLE_CERTIFICATE 解码后过小，不像有效 .p12 证书"
    exit 1
  }
  openssl pkcs12 -in "$CERT_FILE" -nokeys -passin "pass:${APPLE_CERTIFICATE_PASSWORD:-}" >/dev/null 2>&1 || {
    echo "❌ 无法把 APPLE_CERTIFICATE 作为有效 .p12 读取，请检查证书导出内容和 APPLE_CERTIFICATE_PASSWORD"
    exit 1
  }
  openssl pkcs12 -in "$CERT_FILE" -nocerts -nodes -passin "pass:${APPLE_CERTIFICATE_PASSWORD:-}" -out "$KEY_FILE" >/dev/null 2>&1 || {
    echo "❌ APPLE_CERTIFICATE 中读取不到私钥，请导出包含私钥的 Developer ID Application .p12"
    exit 1
  }
  grep -Eq 'BEGIN (RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY' "$KEY_FILE" || {
    echo "❌ APPLE_CERTIFICATE .p12 必须包含用于 macOS app 代码签名的私钥"
    exit 1
  }
else
  security find-identity -v -p codesigning | grep -Eq '"Developer ID Application:' || {
    echo "❌ 缺少 Apple .app 代码签名身份：请导出 APPLE_CERTIFICATE，或在钥匙串安装有效 Developer ID Application 证书"
    echo "   注意：TAURI_SIGNING_PRIVATE_KEY 只签 updater artifact，不能替代 macOS .app 的 TeamIdentifier 签名"
    exit 1
  }
fi

# ─── 版本与 tag ──────────────────────────────────────────────────
VERSION="$(jq -r '.version' "$CONF_FILE")"
[ -n "$VERSION" ] && [ "$VERSION" != "null" ] || { echo "❌ 无法从 $CONF_FILE 读取 version"; exit 1; }
PACKAGE_VERSION="$(jq -r '.version' "$PACKAGE_FILE")"
LOCK_VERSION="$(jq -r '.version' "$LOCK_FILE")"
CARGO_VERSION="$(awk -F ' *= *' '/^version = / { gsub(/\"/, "", $2); print $2; exit }' "$CARGO_FILE")"
[ "$PACKAGE_VERSION" = "$VERSION" ] || { echo "❌ $PACKAGE_FILE version $PACKAGE_VERSION 与 $CONF_FILE version $VERSION 不一致"; exit 1; }
[ "$LOCK_VERSION" = "$VERSION" ] || { echo "❌ $LOCK_FILE version $LOCK_VERSION 与 $CONF_FILE version $VERSION 不一致"; exit 1; }
[ "$CARGO_VERSION" = "$VERSION" ] || { echo "❌ $CARGO_FILE version $CARGO_VERSION 与 $CONF_FILE version $VERSION 不一致"; exit 1; }
TAG="v$VERSION"
echo "📦 准备发布 $TAG"

# ─── 测试门槛（本地发版与 CI test-gate 使用同一口径） ────────────────
echo "🧪 跑本地 release gate..."
npm run lint
npm run lint:readme
npm run lint:i18n
npm run lint:ci-gates
npm test
npm run test:rust
npm run lint:rust

# ─── 注入签名密钥环境变量 ────────────────────────────────────────
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$PRIVATE_KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
export APPLE_CERTIFICATE="${APPLE_CERTIFICATE:-}"
export APPLE_CERTIFICATE_PASSWORD="${APPLE_CERTIFICATE_PASSWORD:-}"

# ─── 构建 ────────────────────────────────────────────────────────
echo "🔨 构建前端 + Tauri bundle..."
npm run clean:release
npm run build
npx @tauri-apps/cli build --target universal-apple-darwin

# ─── 收集产物 ────────────────────────────────────────────────────
if [ -d "src-tauri/target/universal-apple-darwin/release/bundle" ]; then
  BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
else
  BUNDLE_DIR="src-tauri/target/release/bundle"
fi

DMG="$(find "$BUNDLE_DIR/dmg" -type f -name "*.dmg" 2>/dev/null | head -n 1 || true)"
APP_TAR="$(find "$BUNDLE_DIR/macos" -type f -name "*.app.tar.gz" 2>/dev/null | head -n 1 || true)"
APP_SIG="$(find "$BUNDLE_DIR/macos" -type f -name "*.app.tar.gz.sig" 2>/dev/null | head -n 1 || true)"
APP_BUNDLE="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -type d -name "*.app" 2>/dev/null | head -n 1 || true)"

[ -f "$DMG" ]     || { echo "❌ 没找到 .dmg 产物"; exit 1; }
[ -f "$APP_TAR" ] || { echo "❌ 没找到 .app.tar.gz（updater 资产，需要 tauri.conf.json 启用 updater 插件且 TAURI_SIGNING_PRIVATE_KEY 已设置）"; exit 1; }
[ -f "$APP_SIG" ] || { echo "❌ 没找到 .app.tar.gz.sig（签名步骤失败）"; exit 1; }
[ -d "$APP_BUNDLE" ] || { echo "❌ 没找到 .app 产物，无法验收 macOS 权限发布前置条件"; exit 1; }

echo "  DMG     : $DMG"
echo "  Updater : $APP_TAR"
echo "  Sig     : $APP_SIG"
echo "  App     : $APP_BUNDLE"

echo "🔎 验收 macOS app bundle 签名身份与权限元数据..."
npm run validate:macos-app:release -- "$APP_BUNDLE"

# ─── 生成 latest.json ────────────────────────────────────────────
STAGING_DIR="$(mktemp -d -t release-assets)"
DMG_NAME="Aether.Explorer_${VERSION}_universal.dmg"
APP_TAR_NAME="Aether.Explorer_universal.app.tar.gz"
APP_SIG_NAME="Aether.Explorer_universal.app.tar.gz.sig"
LATEST_JSON="$STAGING_DIR/latest.json"
CHECKSUMS="$STAGING_DIR/SHA256SUMS"

cp "$DMG" "$STAGING_DIR/$DMG_NAME"
cp "$APP_TAR" "$STAGING_DIR/$APP_TAR_NAME"
cp "$APP_SIG" "$STAGING_DIR/$APP_SIG_NAME"

APP_TAR_URL="https://github.com/$REPO/releases/download/$TAG/$APP_TAR_NAME"
SIG_CONTENT="$(cat "$STAGING_DIR/$APP_SIG_NAME")"
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

NOTES=""
if [ -f CHANGELOG.md ]; then
  NOTES="$(awk -v ver="$VERSION" '
    $0 ~ "^## \\[" ver "\\]" { p=1; next }
    p && /^## / { exit }
    p { print }
  ' CHANGELOG.md)"
fi
[ -n "$NOTES" ] || NOTES="Aether Explorer $TAG"

jq -n \
  --arg version "$VERSION" \
  --arg notes "$NOTES" \
  --arg pub_date "$PUB_DATE" \
  --arg sig "$SIG_CONTENT" \
  --arg url "$APP_TAR_URL" \
  '{
    version: $version,
    notes: $notes,
    pub_date: $pub_date,
    platforms: {
      "darwin-aarch64": { signature: $sig, url: $url },
      "darwin-x86_64":  { signature: $sig, url: $url }
    }
  }' > "$LATEST_JSON"

echo "📄 latest.json 已生成：$LATEST_JSON"

(
  cd "$STAGING_DIR"
  shasum -a 256 "$DMG_NAME" "$APP_TAR_NAME" "$APP_SIG_NAME" latest.json > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
)

echo "🔐 SHA256SUMS 已生成：$CHECKSUMS"

cleanup_asset() {
  local name="$1"
  gh release delete-asset "$TAG" -R "$REPO" "$name" -y >/dev/null 2>&1 || true
}

cleanup_asset "Aether.Explorer.app.tar.gz"
cleanup_asset "Aether.Explorer.app.tar.gz.sig"
cleanup_asset "latest-json.y2Bv5nM25Z.json"
cleanup_asset "SHA256SUMS"

# ─── 上传到 GitHub Release ───────────────────────────────────────
if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "♻️  Release $TAG 已存在，覆盖上传 assets..."
  gh release upload "$TAG" -R "$REPO" \
    "$STAGING_DIR/$DMG_NAME" \
    "$STAGING_DIR/$APP_TAR_NAME" \
    "$STAGING_DIR/$APP_SIG_NAME" \
    "$LATEST_JSON" \
    "$CHECKSUMS" \
    --clobber
else
  echo "✨ 创建新 Release $TAG..."
  gh release create "$TAG" -R "$REPO" \
    --title "$TAG" \
    --notes "$NOTES" \
    "$STAGING_DIR/$DMG_NAME" \
    "$STAGING_DIR/$APP_TAR_NAME" \
    "$STAGING_DIR/$APP_SIG_NAME" \
    "$LATEST_JSON" \
    "$CHECKSUMS"
fi

echo "📤 Release 资产已上传：$TAG"
echo "   下载页：https://github.com/$REPO/releases/tag/$TAG"
echo "   manifest：https://github.com/$REPO/releases/download/$TAG/latest.json"
echo "   checksums：https://github.com/$REPO/releases/download/$TAG/SHA256SUMS"

echo "📡 更新 stable updater manifest..."
if gh release view stable -R "$REPO" >/dev/null 2>&1; then
  gh release upload stable -R "$REPO" "$LATEST_JSON" --clobber
  gh release view stable -R "$REPO" --json assets -q '.assets[].name' \
    | while IFS= read -r asset; do
        [ "$asset" = "latest.json" ] && continue
        gh release delete-asset stable "$asset" -R "$REPO" -y
      done
else
  gh release create stable -R "$REPO" \
    --title "Stable updater manifest" \
    --notes "Mutable updater channel manifest. Versioned assets remain on $TAG." \
    "$LATEST_JSON"
fi
echo "   stable manifest：https://github.com/$REPO/releases/download/stable/latest.json"

# ─── 上传后验收 ──────────────────────────────────────────────────
echo "🔎 验收远程 Release 资产..."
for attempt in 1 2 3 4 5; do
  if gh release view "$TAG" -R "$REPO" --json assets \
    | jq -e \
      --arg dmg "$DMG_NAME" \
      --arg app "$APP_TAR_NAME" \
      --arg sig "$APP_SIG_NAME" '
        [.assets[].name] as $names
        | ($names | index($dmg))
        and ($names | index($app))
        and ($names | index($sig))
        and ($names | index("latest.json"))
        and ($names | index("SHA256SUMS"))
      ' >/dev/null; then
    break
  fi
  [ "$attempt" -lt 5 ] || { echo "❌ Release 资产校验失败"; exit 1; }
  sleep 2
done

echo "🔎 验收 checksum manifest..."
for attempt in 1 2 3 4 5; do
  if curl -fsSL --retry 5 --retry-delay 2 \
    "https://github.com/$REPO/releases/download/$TAG/SHA256SUMS" \
    | cmp -s "$CHECKSUMS" -; then
    break
  fi
  [ "$attempt" -lt 5 ] || { echo "❌ checksum manifest 校验失败"; exit 1; }
  sleep 2
done

echo "🔎 验收 stable release 资产集合..."
for attempt in 1 2 3 4 5; do
  if gh release view stable -R "$REPO" --json assets \
    | jq -e '[.assets[].name] == ["latest.json"]' >/dev/null; then
    break
  fi
  [ "$attempt" -lt 5 ] || { echo "❌ stable release 包含非 latest.json 资产"; exit 1; }
  sleep 2
done

echo "🔎 验收 updater manifest..."
for attempt in 1 2 3 4 5; do
  if curl -fsSL --retry 5 --retry-delay 2 \
    "https://github.com/$REPO/releases/download/$TAG/latest.json" \
    | jq -e \
      --arg version "$VERSION" \
      --arg url "$APP_TAR_URL" '
        .version == $version
        and (.platforms["darwin-aarch64"].signature | length > 0)
        and (.platforms["darwin-x86_64"].signature | length > 0)
        and .platforms["darwin-aarch64"].url == $url
        and .platforms["darwin-x86_64"].url == $url
      ' >/dev/null; then
    break
  fi
  [ "$attempt" -lt 5 ] || { echo "❌ updater manifest 校验失败"; exit 1; }
  sleep 2
done

echo "🔎 验收 stable updater manifest..."
for attempt in 1 2 3 4 5; do
  if curl -fsSL --retry 5 --retry-delay 2 \
    "https://github.com/$REPO/releases/download/stable/latest.json" \
    | jq -e \
      --arg version "$VERSION" \
      --arg url "$APP_TAR_URL" '
        .version == $version
        and (.platforms["darwin-aarch64"].signature | length > 0)
        and (.platforms["darwin-x86_64"].signature | length > 0)
        and .platforms["darwin-aarch64"].url == $url
        and .platforms["darwin-x86_64"].url == $url
      ' >/dev/null; then
    break
  fi
  [ "$attempt" -lt 5 ] || { echo "❌ stable updater manifest 校验失败"; exit 1; }
  sleep 2
done

echo "✅ 远程发布验收通过：$TAG"
