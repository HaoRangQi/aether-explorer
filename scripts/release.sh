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
#   GITHUB_REPO                       默认 HaoRangQi/aether-explorer

set -euo pipefail

REPO="${GITHUB_REPO:-HaoRangQi/aether-explorer}"
PRIVATE_KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/aether-updater.key}"
CONF_FILE="src-tauri/tauri.conf.json"

# ─── 前置校验 ────────────────────────────────────────────────────
[ -f "$CONF_FILE" ] || { echo "❌ 必须在仓库根目录运行：找不到 $CONF_FILE"; exit 1; }
[ -f "$PRIVATE_KEY_PATH" ] || { echo "❌ 私钥不存在：$PRIVATE_KEY_PATH"; exit 1; }
command -v jq >/dev/null || { echo "❌ 需要安装 jq"; exit 1; }
command -v gh >/dev/null || { echo "❌ 需要安装 gh CLI 并完成 gh auth login"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "❌ gh 未登录，请运行 gh auth login"; exit 1; }

# ─── 版本与 tag ──────────────────────────────────────────────────
VERSION="$(jq -r '.version' "$CONF_FILE")"
[ -n "$VERSION" ] && [ "$VERSION" != "null" ] || { echo "❌ 无法从 $CONF_FILE 读取 version"; exit 1; }
TAG="v$VERSION"
echo "📦 准备发布 $TAG"

# ─── 注入签名密钥环境变量 ────────────────────────────────────────
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$PRIVATE_KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

# ─── 构建 ────────────────────────────────────────────────────────
echo "🔨 构建前端 + Tauri bundle..."
npm run build
npx @tauri-apps/cli build

# ─── 收集产物 ────────────────────────────────────────────────────
BUNDLE_DIR="src-tauri/target/release/bundle"
DMG="$(find "$BUNDLE_DIR/dmg" -type f -name "*.dmg" 2>/dev/null | head -n 1 || true)"
APP_TAR="$(find "$BUNDLE_DIR/macos" -type f -name "*.app.tar.gz" 2>/dev/null | head -n 1 || true)"
APP_SIG="$(find "$BUNDLE_DIR/macos" -type f -name "*.app.tar.gz.sig" 2>/dev/null | head -n 1 || true)"

[ -f "$DMG" ]     || { echo "❌ 没找到 .dmg 产物"; exit 1; }
[ -f "$APP_TAR" ] || { echo "❌ 没找到 .app.tar.gz（updater 资产，需要 tauri.conf.json 启用 updater 插件且 TAURI_SIGNING_PRIVATE_KEY 已设置）"; exit 1; }
[ -f "$APP_SIG" ] || { echo "❌ 没找到 .app.tar.gz.sig（签名步骤失败）"; exit 1; }

echo "  DMG     : $DMG"
echo "  Updater : $APP_TAR"
echo "  Sig     : $APP_SIG"

# ─── 生成 latest.json ────────────────────────────────────────────
APP_TAR_NAME="$(basename "$APP_TAR")"
APP_TAR_URL="https://github.com/$REPO/releases/download/$TAG/$APP_TAR_NAME"
SIG_CONTENT="$(cat "$APP_SIG")"
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

LATEST_JSON="$(mktemp -t latest-json).json"
jq -n \
  --arg version "$VERSION" \
  --arg notes "Aether Explorer $VERSION" \
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

# ─── 上传到 GitHub Release ───────────────────────────────────────
if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "♻️  Release $TAG 已存在，覆盖上传 assets..."
  gh release upload "$TAG" -R "$REPO" \
    "$DMG" "$APP_TAR" "$APP_SIG" "$LATEST_JSON" --clobber
  # latest.json 文件名会保留为 mktemp 名称，重命名为标准名
  gh release upload "$TAG" -R "$REPO" \
    "$LATEST_JSON#latest.json" --clobber 2>/dev/null || true
else
  echo "✨ 创建新 Release $TAG..."
  gh release create "$TAG" -R "$REPO" \
    --title "$TAG" \
    --notes "Aether Explorer $VERSION" \
    "$DMG" "$APP_TAR" "$APP_SIG"
  gh release upload "$TAG" -R "$REPO" \
    "$LATEST_JSON#latest.json" --clobber
fi

# 确保 latest.json 以标准名上传一份（覆盖临时名）
gh release upload "$TAG" -R "$REPO" \
  "$LATEST_JSON#latest.json" --clobber

echo "✅ 发布完成：$TAG"
echo "   下载页：https://github.com/$REPO/releases/tag/$TAG"
echo "   manifest：https://github.com/$REPO/releases/latest/download/latest.json"
