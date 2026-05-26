# 06 发布运行手册 (Release-Runbook)

**状态**: ✅ 已落地  **首次落地**: [2026-05-15]  **最近更新**: [2026-05-15]  **域**: 版本发布 / GitHub Release / Tauri Updater

← 返回 [索引](./README.md)

---

## 06.1 一句话总结

发布完成的定义不是“tag 推上去了”，也不是“workflow 跑过了”，而是 GitHub Release 中同时存在可下载包、updater 包、签名和 `latest.json`，且 `latest.json` 能被客户端下载校验。

## 06.2 决策与不变量

| 决策 | 规则 | 原因 |
|---|---|---|
| 首个正式基线 | `v0.2.0` | 之前 `v0.1.1` 是错误版本号与调试残留，后续不沿用它作为正式基线 |
| 构建架构 | `--target universal-apple-darwin` | 一个包覆盖 Apple Silicon 和 Intel，`latest.json` 两个平台指向同一个 updater 包 |
| 上传策略 | 构建、签名、manifest 齐全后再上传 | 避免远程 release 只出现半包资产 |
| 签名密钥 | GitHub Secrets 是 CI 真相源，本地 key 只服务应急脚本 | CI 不能依赖某台机器的 shell 环境 |
| 验收标准 | 命令验收，不靠页面肉眼判断 | GitHub 页面刷新慢，且缺 `latest.json` 时页面看起来也像“有包了” |

不可违反的不变量：

- `src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml` 的版本号必须一致。
- tag 必须是 `vX.Y.Z`，manifest 里的 `version` 必须是 `X.Y.Z`。
- CI 必须 checkout 到发布 tag，且 tag、Tauri version、Cargo version 三者必须一致。
- `src-tauri/tauri.conf.json` 的 `bundle.createUpdaterArtifacts` 必须是 `true`。
- `src-tauri/tauri.conf.json` 的 updater `pubkey` 必须匹配 `TAURI_SIGNING_PRIVATE_KEY`。
- Release 缺 `latest.json` 就不算完成，哪怕 `.dmg` 已经上传。

## 06.3 关键文件

| 文件 | 责任 |
|---|---|
| `src-tauri/tauri.conf.json` | Tauri 版本号、updater 公钥、updater endpoint、`createUpdaterArtifacts` |
| `src-tauri/Cargo.toml` | Rust crate 版本号，必须与 Tauri 配置一致 |
| `.github/workflows/release.yml` | CI 发布流程：校验输入、构建 universal 包、生成并上传 manifest，并在上传后强制验收 |
| `scripts/release.sh` | 本地应急发布脚本，逻辑必须与 CI 保持一致，脚本会校验版本一致性并在结束前验收远程资产 |
| `codex/01-updater.md` | 自动更新架构、数据契约和 updater 失败模式 |
| `codex/06-release-runbook.md` | 实际发版 SOP 和验收清单 |

## 06.4 标准发布流程

### 1. 选择版本号

版本号按 semver 递增。当前正式基线是 `0.2.0`，下一次按改动大小选择：

- bugfix：`0.2.1`
- 小功能：`0.3.0`
- 破坏性变更：`1.0.0` 或下一个约定大版本

### 2. 修改版本源

只改这两处，不改 `package.json`，因为 app 版本来自 Tauri：

```bash
# 示例：发 v0.2.1
# src-tauri/tauri.conf.json: "version": "0.2.1"
# src-tauri/Cargo.toml:      version = "0.2.1"
```

### 3. 本地校验

```bash
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

任何一步失败都不打 tag。

### 4. 提交、打 tag、推远程

```bash
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: 发版 v0.2.1"
git tag v0.2.1
git push origin main --tags
```

推 tag 会触发 `.github/workflows/release.yml`。workflow 会 checkout 到对应 tag，并校验 tag、`tauri.conf.json`、`Cargo.toml` 版本一致；缺任一资产或 manifest 字段都会失败。如果需要手动重跑：

```bash
gh workflow run release.yml -f tag_name=v0.2.1
```

### 5. 等 CI 完成

```bash
gh run list --workflow release.yml --limit 3
gh run watch <run-id> --exit-status
```

CI 失败不能算发布完成；必须看失败日志并修流程。不要因为 Release 页面上已经有部分资产就宣布完成。

## 06.5 验收清单

发布完成必须同时满足下面 5 条：

```bash
VERSION=0.2.1
TAG="v${VERSION}"
REPO="HaoRangQi/aether-explorer"

gh release view "$TAG" -R "$REPO" --json isDraft,isPrerelease,assets,url \
  | jq '{isDraft,isPrerelease,assets:[.assets[].name]}'

curl -fsSL "https://github.com/$REPO/releases/latest/download/latest.json" \
  | jq -e --arg version "$VERSION" '
      .version == $version
      and (.platforms["darwin-aarch64"].signature | length > 0)
      and (.platforms["darwin-x86_64"].signature | length > 0)
      and (.platforms["darwin-aarch64"].url | contains("/releases/download/"))
      and (.platforms["darwin-x86_64"].url | contains("/releases/download/"))
    '
```

资产清单必须包含：

- `Aether.Explorer_<version>_universal.dmg`
- `Aether.Explorer_universal.app.tar.gz`
- `Aether.Explorer_universal.app.tar.gz.sig`
- `latest.json`

验收失败时不准口头宣布“发完了”。

## 06.6 本地应急发布

只有 CI 连续失败且原因已定位时才走本地应急路径：

```bash
# 前置：gh auth status 正常
# 前置：~/.tauri/aether-updater.key 存在，且与 tauri.conf.json 的 pubkey 匹配

export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='私钥密码，没有密码则留空或不设置'
bash scripts/release.sh
```

本地脚本内置同一套上传后验收。脚本显示 `远程发布验收通过` 才算完成；如果中途失败，按 [06.5 验收清单](#065-验收清单) 手动复核远程状态。

## 06.7 失败模式与处理

| 现象 | 根因 | 处理 |
|---|---|---|
| Release 只有 `.dmg` / `.app.tar.gz`，没有 `.sig` | 没启用 `createUpdaterArtifacts` 或签名密钥缺失 | 确认 `createUpdaterArtifacts: true`，检查 GitHub Secrets |
| Release 有 `.sig`，没有 `latest.json` | manifest 步骤找错 bundle 目录或上传失败 | 修 `.github/workflows/release.yml` 的 `BUNDLE_DIR`，手动生成并上传 `latest.json` 后再修 CI |
| CI 日志显示 `Missing script: tauri` | `tauri-action` 默认跑 `npm run tauri`，仓库没有该 script | 直接使用 `npx @tauri-apps/cli build --target universal-apple-darwin` |
| CI 日志显示 `Missing comment in secret key` | `TAURI_SIGNING_PRIVATE_KEY` secret 为空或内容不是完整私钥 | 用 `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/aether-updater.key` 重写 secret |
| CI 日志显示 `Wrong password for that key` | 私钥有密码但 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 不匹配 | 重写 password secret，或更换无密码 key 并同步 pubkey |
| CI 日志显示 version 不匹配 | tag、`tauri.conf.json`、`Cargo.toml` 三者不一致 | 修版本源后重新提交并打新 tag，不要复用错误 tag |
| `latest.json.version` 还是旧版本 | tag、Tauri version、manifest 生成参数不一致 | 重新核对 `RELEASE_TAG` 和两处版本源，不要手改 manifest 凑数 |
| updater 检查失败 `missing field signature` | `latest.json` 没有 `platforms.*.signature` | 重新生成 manifest，signature 必须来自 `.app.tar.gz.sig` 完整内容 |
| updater 检查失败 `signature mismatch` | app 内公钥和签名私钥不配套 | 同步 `tauri.conf.json` pubkey 与 GitHub Secret 私钥，重新发更高版本 |
| 客户端报 `The signature verification failed` | 手写 `latest.json` 并复用旧版本的签名，导致签名与 app 包内容不匹配 | 删除该 release，重新打 tag 让 CI 自动构建；或用正确的密钥为新版本 app 包重新签名 |
| Release 里出现 `latest-json.xxxxx.json` 而不是 `latest.json` | `gh release upload/create` 的 `file#label` 只改显示标签，不改真实资产名 | 上传前先把文件写成真正的 `latest.json`，不要依赖 label 冒充文件名 |
| `latest.json` 里的 URL 指向 `Aether Explorer.app.tar.gz` 等旧名 | manifest 用了原始构建文件 basename，而不是最终上传资产名 | 先把 release 资产归一化命名，再基于最终文件名生成 manifest |

## 06.8 流程防卡规则

这几条是硬规则，不按它们走就容易重复卡发布：

- CI 和本地脚本都必须在上传后验收，不准只负责上传。
- 新增或修改发布资产命名时，必须同步修改 workflow、`scripts/release.sh` 和本文件的资产清单。
- universal 构建产物优先从 `src-tauri/target/universal-apple-darwin/release/bundle` 读取，`src-tauri/target/release/bundle` 只作为 fallback。
- 发布时先把产物复制到 staging 目录并改成最终上传名，再生成 `latest.json`；不要直接拿临时文件名或原始构建名拼 URL。
- `latest.json` 不手写，不临时凑字段，只从实际 `.app.tar.gz.sig` 生成。
- 任何一次发布事故都要把根因写回本文件或 `codex/01-updater.md`，不能只靠聊天记录记忆。

## 06.9 发布事故复盘规则

每次 release 卡住后必须补文档，不准只修当下命令：

- 如果是流程问题，更新 `.github/workflows/release.yml` 和本文件。
- 如果是本地应急脚本问题，同步更新 `scripts/release.sh`。
- 如果是 updater 数据契约问题，同步更新 `codex/01-updater.md`。
- 如果远程 release 已经半成品，先补齐或删除半成品，再宣布状态。

## 06.10 v0.2.1 事故记录

### 事故现象

- `v0.2.1` 第一次 CI 构建成功，但 workflow 最终失败。
- GitHub Release 已被创建，且已有 `.dmg`、`.app.tar.gz`、`.sig` 和一个看似 manifest 的 JSON。
- 实际资产名是 `latest-json.<随机串>.json`，不是 `latest.json`。
- 该 JSON 里的 updater URL 指向 `Aether Explorer.app.tar.gz`，而不是最终 release 资产名 `Aether.Explorer_universal.app.tar.gz`。

### 根因

1. `gh release upload/create` 的 `file#label` 写法只修改 asset label，不会修改真实文件名；因此 `"$LATEST_JSON#latest.json"` 仍会以上传源文件名落盘。
2. manifest 是按原始构建产物 basename 生成 URL，而 release 对外发布使用的是归一化后的资产名；两者脱钩后，manifest 即使存在也会指向错误地址。
3. workflow 在创建 release 后立刻做资产校验，因此第一次失败点不是构建，而是“发布后验收”。

### 修复动作

1. workflow 和 `scripts/release.sh` 改为先把产物复制到 staging 目录，并重命名为最终上传资产名：
   - `Aether.Explorer_<version>_universal.dmg`
   - `Aether.Explorer_universal.app.tar.gz`
   - `Aether.Explorer_universal.app.tar.gz.sig`
   - `latest.json`
2. manifest 改为基于 staging 后的最终文件名生成 URL，不再读取原始 bundle basename。
3. 上传前显式清理已知错误资产名，避免幂等重跑时远程残留脏资产。
4. 资产校验和 manifest 校验都加短重试，容忍 GitHub Release API / CDN 的瞬时可见性延迟。
5. 对已存在的 `v0.2.1` 半成品 release，手动删除错误资产并补传正确四件套，而不是重打更高版本号。

### 以后怎么做

- 看到“构建成功但 release 失败”时，先查远程 release 实际资产名，不要立刻重新 bump 版本号。
- 如果失败只发生在命名或 manifest 层，且二进制本身正确，可原地修复该 tag 的 release。
- 只有二进制本身、签名、版本号或 pubkey 出错，才应该放弃该 tag 并发更高版本。

## 06.10 v0.3.0 事故记录

### 事故现象

- 本地手动构建 v0.3.0，生成了 `.dmg` 和 `.app.tar.gz`，但没有 `.sig` 文件。
- 手写 `latest.json`，从 v0.2.1 的旧签名中复制，导致签名与 v0.3.0 的 app 包内容不匹配。
- 上传到 GitHub Release 后，客户端尝试更新时报错：`The signature verification failed`。

### 根因

1. **本地构建缺少签名**：`npx tauri build` 需要 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量，本地密钥有密码但密码不对，导致签名失败。
2. **手写 manifest 而不是从签名文件生成**：06.8 第 166 行明确规定"不手写，不临时凑字段，只从实际 `.app.tar.gz.sig` 生成"，但我直接手写了 JSON 并复用旧签名。
3. **签名与内容不匹配**：v0.3.0 的 app 包内容与 v0.2.1 不同，但用了 v0.2.1 的签名，导致验证失败。

### 修复动作

1. 删除不完整的 v0.3.0 release 和 tag。
2. 重新打 tag 并推送到远程，触发 CI workflow。
3. CI 自动调用 `npx @tauri-apps/cli build --target universal-apple-darwin`，使用 GitHub Secrets 中的密钥和密码自动签名。
4. CI 从生成的 `.app.tar.gz.sig` 文件读取签名内容，生成正确的 `latest.json`。
5. CI 上传完整的四件套资产并验收。

### 以后怎么做

- **永远不要本地手写 `latest.json`**：即使有签名文件，也要用 `jq` 从 `.sig` 文件内容生成，不要复制粘贴。
- **本地应急发布时**：如果本地密钥有密码但密码不对，不要尝试手工凑签名，而是：
  1. 确认 GitHub Secrets 中的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 是否正确。
  2. 如果本地密码与 Secrets 不一致，更新 Secrets 或重新生成无密码的密钥。
  3. 或者直接删除本地 release，让 CI 重新构建。
- **优先使用 CI 发布**：CI 有完整的密钥和密码配置，不容易出错。本地应急脚本只在 CI 连续失败且原因已定位时才使用。
- **验收时检查签名**：不仅要检查 `latest.json` 存在，还要检查 `platforms.*.signature` 字段长度 > 0，确保签名不是空字符串。

## 06.11 v0.2.0 已知基线

`v0.2.0` 是第一版正式可用发布基线。发布资产已验证包含：

- `Aether.Explorer_0.2.0_universal.dmg`
- `Aether.Explorer_universal.app.tar.gz`
- `Aether.Explorer_universal.app.tar.gz.sig`
- `latest.json`

`latest.json` 已验证：

- `.version == "0.2.0"`
- 包含 `darwin-aarch64` 与 `darwin-x86_64`
- 两个平台指向同一个 universal updater 包

历史 `v0.1.1` 属于错误版本号和调试过程产物，不作为正式发布基线。

## 06.12 v0.3.0 已知基线

`v0.3.0` 是颜色细化控制系统的首个发布版本。发布资产已验证包含：

- `Aether.Explorer_0.3.0_universal.dmg`
- `Aether.Explorer_universal.app.tar.gz`
- `Aether.Explorer_universal.app.tar.gz.sig`
- `latest.json`

`latest.json` 已验证：

- `.version == "0.3.0"`
- 包含 `darwin-aarch64` 与 `darwin-x86_64`
- 两个平台指向同一个 universal updater 包
- 签名验证通过（客户端可正常更新）

## 06.13 v0.4.2 发布执行记录

`v0.4.2` 是原生 Liquid Glass 与文件工作台治理版本。发布前本地已完成：

- `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 均为 `0.4.2`。
- `CHANGELOG.md` 已增加 `0.4.2` release notes，GitHub Release notes 可由 workflow 自动抽取。
- `codex/14-liquid-glass-file-workbench.md` 已沉淀原生 Liquid Glass、分栏状态、传输管理、大小统计、权限预检与版本线治理边界。
- 本地 release gate 已通过：`npm run lint`、`npm run lint:readme`、`npm run lint:i18n`、`npm run lint:ci-gates`、`npm test`、`npm run test:rust`、`npm run lint:rust`、`npm run build`。

版本线注意事项：

- 历史上存在 `v4.0.1` tag，这是异常版本线；本次继续按 `0.x` 正式 release 线发 `v0.4.2`。
- tag 必须指向合并后的 `develop` release commit，不从功能分支半路打 tag。
- 发布完成仍以 [06.5 验收清单](#065-验收清单) 为准：远程 release 必须包含 `.dmg`、`.app.tar.gz`、`.sig`、`latest.json` 和 `SHA256SUMS`，且 stable updater manifest 指向 `0.4.2`。
