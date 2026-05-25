# Aether Explorer 测试与回归保障计划

> 起草日期：2026-05-17
> 目标：在不写"全套企业级测试"的前提下，建立**最小可用的回归网**，让你改完代码后能在 5 分钟内确认核心路径没坏。
> 原则：投入产出比优先 — 先盖"安全 + 路径 + 格式化"等纯逻辑、留拖拽 / 视觉给人工 smoke。

> 当前状态：自动化回归网已经落地。`npm test` 当前为 14 个测试文件、129 个用例通过；`npm run test:rust` 当前为 81 个 Rust 单元测试通过；`npm run lint`、`npm run lint:ci-gates`、`npm run lint:rust` 和 `npm run build` 已纳入合并 / 发版前门禁。

---

## 一、范围划分（三层防线）

```
                ┌──────────────────────────────────────────┐
   Layer 1      │  Rust 纯函数单元测试 (cargo test)         │ 自动 · 秒级
                │  覆盖：安全转义、路径、格式化、MIME 检测     │
                └──────────────────────────────────────────┘
                ┌──────────────────────────────────────────┐
   Layer 2      │  TS 纯函数 / 数据规范化测试 (vitest)       │ 自动 · 秒级
                │  覆盖：settings 规范化、迁移、URL 校验        │
                └──────────────────────────────────────────┘
                ┌──────────────────────────────────────────┐
   Layer 3      │  Smoke Test Checklist (人工 + console)    │ 半自动 · 5 分钟
                │  覆盖：UI 渲染、拖拽、跨窗口、快捷键          │
                └──────────────────────────────────────────┘
```

---

## 二、目录结构

```
src-tauri/src/
├── lib.rs
└── main.rs
    # Rust 测试内联在 lib.rs 的 #[cfg(test)] mod tests

src/
├── ...
├── lib/
│   ├── app-error.ts
│   ├── asset-url-cache.ts
│   ├── directory-signature.ts
│   ├── file-selection.ts
│   ├── keyboard-shortcuts.ts
│   ├── media-metadata.ts
│   ├── native-menu.ts
│   ├── navigation-history.ts
│   ├── path-helpers.ts
│   ├── settings.ts
│   ├── smoke.ts
│   ├── startup-diagnostics.ts
│   ├── url-guard.ts
│   ├── use-debounced-value.ts
│   └── use-prefers-reduced-motion.ts
└── __tests__/
    ├── app-error.test.ts
    ├── asset-url-cache.test.ts
    ├── directory-signature.test.ts
    ├── file-selection.test.ts
    ├── keyboard-shortcuts.test.ts
    ├── media-metadata.test.ts
    ├── native-menu.test.ts
    ├── navigation-history.test.ts
    ├── path-helpers.test.ts
    ├── settings.test.ts
    ├── startup-diagnostics.test.ts
    ├── url-guard.test.ts
    ├── use-debounced-value.test.ts
    └── use-prefers-reduced-motion.test.ts

docs/
├── TEST_PLAN.md                        # 本文档
└── SMOKE_TEST.md                       # 人工 checklist + console smoke 说明
```

> Rust 测试用 `#[cfg(test)] mod tests`（与代码同文件），不另开 `tests/` 集成测试目录 — 保持 lib.rs 重构后测试跟着走。
> 前端测试集中在 `src/__tests__/`，与 source 同根，vitest 默认会扫到。

---

## 三、Layer 1: Rust 纯函数单元测试

### 选取标准
- 不依赖 `tauri::WebviewWindow` / `tauri::State` 等 Tauri 上下文
- 不依赖外部进程（`std::process::Command`）
- 不依赖文件系统（或可走 `tempfile` 隔离）

### 当前覆盖与后续补强

| 函数 / 主题 | 状态 | 测试要点 | 后续 |
|------|------|---------|-------|
| `format_size` / `format_kib` | 已覆盖 | 边界值、单位换算、解析失败回原值 | 持续保留 |
| `parse_df_line` / `parse_capacity` | 已覆盖 | 多空格列、mount 含空格、列数不足、百分比截断 | 持续保留 |
| `detect_mime` | 已覆盖 | 图片 / 音视频 / code / text / archive / `.app` / 无扩展名 | 持续保留 |
| `unique_destination` | 已覆盖 | 不存在路径、`copy` 后缀递增、无扩展名 | 持续保留 |
| `encode_query_component` | 已覆盖 | safe chars 保留，空格 / `/` / `&` / `=` 百分号编码 | 持续保留 |
| `shell_quote` | 已覆盖 | 单引号、空字符串、`$()`、反引号、`;`、`|`、`&&`、空格路径 | 持续保留 |
| `validate_shell_fragment` | 已覆盖 | safe input trim、quoted file placeholders、注入字符、未闭合 quote、空字符串 | 持续保留 |
| `is_allowed_terminal` | 已覆盖 | 允许 Terminal / iTerm / Warp / WezTerm，拒绝注入、空值、未知 app、`.app` 后缀 | 持续保留 |
| `apple_quote` | 已覆盖 | AppleScript 字符串包裹、双引号和反斜杠转义 | 持续保留 |
| `open_terminal_at` | 已覆盖 | 非白名单终端返回结构化 `InvalidPath` 错误 | 持续保留 |
| copy / move conflict | 已覆盖 | skip conflict、same-dir、copy into self、transfer 统计 | 持续保留 |
| symlink copy | 已覆盖 | 目录 symlink、self symlink、dangling symlink、命令入口复制 symlink | 持续保留 |
| transfer cancel cleanup | 已覆盖 | staged target、replace backup、copy file / dir cancel 清理 | 持续保留 |
| `safe_canonicalize` | 待补强 | 不存在路径、`..`、symlink 相关路径边界 | 改路径安全链路时 TDD |
| `format_modified` / `format_system_time` | 待补强 | 时间格式与无效元数据 | 低风险补充 |
| `add_dir_to_zip` 入口校验 | 待补强 | 不存在、权限拒绝、正常压缩 | 改压缩链路时补 |

> 安全相关测试优先级仍高于覆盖率数字。后续如改终端执行、路径 canonicalize、压缩或 AppleScript 相关链路，先补 failing case，再改实现。

### 写法范例（追加到 `src-tauri/src/lib.rs` 末尾）

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_size_boundaries() {
        assert_eq!(format_size(0), "0 B");
        assert_eq!(format_size(1023), "1023 B");
        assert_eq!(format_size(1024), "1.0 KB");
        assert_eq!(format_size(1024 * 1024), "1.0 MB");
        assert_eq!(format_size(1024_u64.pow(3)), "1.0 GB");
        assert_eq!(format_size(1024_u64.pow(4)), "1024.0 GB"); // 故意暴露当前实现不到 TB
    }

    #[test]
    fn shell_quote_escapes_single_quote() {
        assert_eq!(shell_quote("hello"), "'hello'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote(""), "''");
        // 安全要求：包含命令注入字符也必须被引号围住
        assert_eq!(shell_quote("$(rm -rf /)"), "'$(rm -rf /)'");
    }

    #[test]
    fn detect_mime_handles_common_types() {
        assert_eq!(detect_mime("foo.png", false), "image");
        assert_eq!(detect_mime("foo.PNG", false), "image"); // 大小写不敏感
        assert_eq!(detect_mime("README.md", false), "text");
        assert_eq!(detect_mime("script.sh", false), "code");
        assert_eq!(detect_mime("MyApp.app", true), "application");
        assert_eq!(detect_mime("Folder", true), "folder");
        assert_eq!(detect_mime("Makefile", false), "file"); // 无扩展名
    }

    #[test]
    fn unique_destination_appends_copy_suffix() {
        let tmp = std::env::temp_dir();
        let base = tmp.join(format!("aether-test-{}", std::process::id()));
        let _ = std::fs::create_dir(&base);
        let file = base.join("a.txt");
        std::fs::write(&file, "").unwrap();

        let next = unique_destination(&base.join("a.txt"));
        assert_eq!(next.file_name().unwrap(), "a copy.txt");

        std::fs::write(&base.join("a copy.txt"), "").unwrap();
        let next2 = unique_destination(&base.join("a.txt"));
        assert_eq!(next2.file_name().unwrap(), "a copy 2.txt");

        std::fs::remove_dir_all(&base).ok();
    }

    // ...其他测试
}
```

### 验证
```bash
cd src-tauri
cargo test --lib       # 仅测 lib.rs（不重编 bin）
cargo test -- --nocapture format_size
```

预期：所有测试通过，当前基线为 81 个 Rust 单元测试。

---

## 四、Layer 2: 前端 TS 纯函数测试（vitest）

### 当前配置

```bash
npm install -D vitest @vitest/ui jsdom
```

`vite.config.ts` 已配置：
```ts
test: {
  environment: 'jsdom',
  globals: false,
  include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
}
```

`package.json` 已配置：
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### 当前覆盖

| 文件 / 函数 | 测试要点 | 后续 |
|-----------|---------|-------|
| `settings.test.ts` | theme settings 默认值、迁移、context menu extension 规范化、localStorage 容错 | 持续保留 |
| `ai-ops-log.test.ts` | 历史 index 迁移、分页、关键词/日期过滤、retention 清理、删除一致性 | 持续保留 |
| `url-guard.test.ts` | `safeShellOpen` / wallpaper URL / action template interpolation / shell escaping | 持续保留 |
| `app-error.test.ts` | app error normalize / directory error kind | 持续保留 |
| `asset-url-cache.test.ts` | asset URL cache 复用与释放 | 持续保留 |
| `directory-signature.test.ts` | 目录签名首次记录、无变化、变化刷新判断 | 持续保留 |
| `file-selection.test.ts` | lookup、last selected、selected files、键盘相邻选择解析 | 持续保留 |
| `keyboard-shortcuts.test.ts` | Explorer 快捷键解析 | 改键盘 effect 前先补 case |
| `media-metadata.test.ts` | duration formatting | 持续保留 |
| `native-menu.test.ts` | 原生菜单 display-mode 命令解析 | 持续保留 |
| `navigation-history.test.ts` | back / forward / navigate history | 持续保留 |
| `path-helpers.test.ts` | path leaf、虚拟路径、初始 tabs、共同父目录 | 持续保留 |
| `startup-diagnostics.test.ts` | panic log fingerprint、启动异常提示去重 | 持续保留 |
| `use-debounced-value.test.ts` | debounce 行为 | 持续保留 |
| `use-prefers-reduced-motion.test.ts` | reduced motion 订阅与 fallback | 持续保留 |

### 写法范例

```ts
// src/__tests__/settings.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeThemeSettings } from '../lib/settings';  // 待抽出

describe('normalizeThemeSettings', () => {
  it('fills in defaults for missing fields', () => {
    const result = normalizeThemeSettings({} as any);
    expect(result.mode).toBe('auto');
    expect(result.blurIntensity).toBe(32);
    expect(result.contextMenuExtensions).toBeDefined();
  });

  it('removes deprecated extension ids', () => {
    const result = normalizeThemeSettings({
      contextMenuExtensions: [
        { id: 'open', label: 'old', enabled: true } as any,
        { id: 'custom-x', label: 'new', enabled: true } as any,
      ],
    } as any);
    expect(result.contextMenuExtensions?.map(e => e.id)).toEqual(['custom-x']);
  });
});
```

> `normalizeThemeSettings` 已抽到 `src/lib/settings.ts`，后续继续按“先抽纯函数，再补测试”的模式处理高风险 UI 逻辑。

### 验证
```bash
npm test
npm run test:watch    # 改代码时实时回归
```

预期：当前 14 个测试文件、129 个用例通过。

---

## 五、Layer 3: Smoke Test Checklist（人工 + console 脚本）

已写到 `docs/SMOKE_TEST.md`，**每次合并前过一遍**，5 分钟内能完成。

### 结构示例
```markdown
# Aether Smoke Test
> 每次合 PR 前过一遍。预计耗时：5 分钟。

## 启动 / 窗口
- [ ] `npx tauri dev` 能正常启动
- [ ] 窗口圆角、毛玻璃显示正常
- [ ] Cmd+N 能新建窗口；Cmd+W 关闭标签页

## 文件浏览
- [ ] 默认主页可见，文件列表加载 < 2 秒
- [ ] 切换列表 / 网格 / 分栏视图，状态正常
- [ ] 隐藏文件开关切换有效

## 文件操作
- [ ] Cmd+C / Cmd+V 复制粘贴
- [ ] 拖文件到子文件夹，移动成功
- [ ] 重命名（双击 / 右键）

## 跨窗口拖拽（feat/cross-window-drag）
- [ ] A 窗口拖文件出去，B 窗口出现 banner
- [ ] 松手在 B 内 → 复制成功；松手在窗口外 → 静默取消
- [ ] ⌘ 修饰键切换 copy/move
- [ ] 设置改为"移动"后，松手 = 移动
- [ ] 从 Finder 拖文件进 Aether，复制成功

## 设置
- [ ] 主题切换（浅色/深色/自动）即时生效
- [ ] 字体切换生效
- [ ] 空格键预览开关：开 → 按空格 Quick Look 弹出；关 → 不弹

## Console 自检（dev 模式）
打开 DevTools 控制台，粘贴：
```js
window.__aether?.smoke()
```
应输出 `{ ok: true, total: N, failed: [] }`。
```

### Console 自检脚本（已落地）

`src/lib/smoke.ts` 已提供 dev-only 工具，并在 `src/main.tsx` 中导入：
```ts
if (import.meta.env.DEV) {
  window.__aether = { smoke };
}
```

当前 smoke 覆盖主题 CSS var、根节点、settings store、`get_home_dir`、`list_directory`、`get_child_count`、`list_volumes`、localStorage theme、URL guard、shell escape、`raise_window_at` 和当前窗口 label。收益：连"控制台敲一行命令"都能验证 N 个隐式假设是否仍成立。

---

## 六、CI 接入

```yaml
npm run lint
npm run lint:readme
npm run lint:i18n
npm run lint:ci-gates
npm test
npm run test:rust
npm run lint:rust
npm run build
```

收益：未来你或贡献者写 PR，CI 自动跑前端 lint、文档 / i18n / gate 检查、Vitest、Rust test、Rust clippy 和 production build。test workflow 覆盖 `main`、`feat/**`、`fix/**`、`test/**`、`codex/**` 和 `codex-*` 工作分支，`lint:ci-gates` 会防止这些 push 触发或 `pull_request` 到 `main` 的触发被误删。`lint:ci-gates` 也会确认关键 npm scripts 仍指向真实检查器或真实命令，并分别检查 test workflow、release `test-gate` 和 release job 保留 Node 20、npm cache、`npm ci`、Rust cache、release universal targets 与明确的 `timeout-minutes`，同时检查 release job 依赖 `test-gate`，并检查 release workflow / 本地 release 脚本保留版本一致性校验，避免绕过发版门禁。`scripts/release.sh` 本地版也使用同一组 release gate，避免本地发版弱于 CI。

---

## 七、执行计划

### Phase 1：地基（半天）
- [x] 加 `vitest` 依赖 + `vite.config.ts` 配置
- [x] 创建 `src/__tests__/` 目录
- [x] 在 `lib.rs` 末尾添加 `#[cfg(test)] mod tests`
- [x] 抽出 `normalizeThemeSettings` 到 `src/lib/settings.ts`（便于测试）
- [x] 写出 Rust 纯函数测试：`format_size / shell_quote / detect_mime / unique_destination / parse_df_line` 等
- [x] 写出 TS 测试：settings、URL guard、file selection、keyboard shortcuts、navigation history、path helpers、startup diagnostics 等
- [x] 跑通 `npm test` 与 `cargo test --lib`

### Phase 2：补全（半天）
- [x] Layer 1 扩展到 81 个 Rust 单元测试
- [x] Layer 2 扩展到 14 个测试文件、129 个 Vitest 用例
- [x] CI test workflow 接入 lint / docs / i18n / gate / Vitest / Rust test / clippy / build，并覆盖声明的 push 分支与 PR 到 `main`
- [x] release workflow 接入 `test-gate`，并由 `lint:ci-gates` 防止关键 npm scripts 退化为空命令、release job 绕过该依赖或删除版本一致性校验
- [x] `scripts/release.sh` 加 release gate：lint / README sync / i18n / CI gate / Vitest / Rust test / clippy / build

### Phase 3：Smoke layer（半天）
- [x] 写 `docs/SMOKE_TEST.md` checklist
- [x] 写 `src/lib/smoke.ts` console 自检脚本
- [x] 在 `src/main.tsx` 导入 dev-only smoke，注入 `window.__aether`
- [ ] 每个发版候选手动跑一轮 `docs/SMOKE_TEST.md`

后续投入应集中在：给 `ExplorerView` 拖拽 / 外部导入 / 键盘 effect 的纯解析层补测试，避免直接重构大型 effect；给路径、压缩、终端执行等高风险链路补缺口。

---

## 八、与未来工作的耦合

| 未来工作 | 测试关联 |
|---------|---------|
| `RELEASE_AUDIT.md` P0-1 命令注入 | `shell_quote`、`validate_shell_fragment`、`is_allowed_terminal`、`apple_quote` 和非白名单终端错误已覆盖；改 terminal / AppleScript 链路前继续先补 case |
| `RELEASE_AUDIT.md` P0-2 shell.open 白名单 | `safeShellOpen` / `isValidWallpaperUrl` 已覆盖，改白名单前先补 case |
| `RELEASE_AUDIT.md` P0-4 路径校验 | 先写 `safe_canonicalize` 测试 |
| `PERF_PLAN.md` L2-B 异步 list_directory | 改成 spawn_blocking 时，原 `format_size / detect_mime / unique_destination` 等纯函数保留，测试不变 |
| `IMPROVEMENT_PROPOSALS.md` 1.1 状态机 | 把 reducer 单独写成纯函数，超容易测 |
| `IMPROVEMENT_PROPOSALS.md` 8.1 settings migrator | `migrateV1ToV2` 是纯函数，直接覆盖 |

每次做新功能 / 修 bug，优先在 `__tests__` 或 Rust `#[cfg(test)]` 中加一条 failing case，再改代码到 pass。对拖拽 / 跨窗口 / Finder 导入这类系统集成路径，先补纯函数和人工 smoke 步骤，不盲目引入脆弱自动化。

---

## 九、不会做什么

- **不会**做 React 组件渲染测试（@testing-library/react）— 维护成本极高，且 ExplorerView 3800 行难拆。等架构拆分后再考虑。
- **不会**做 E2E（Playwright / Tauri WebDriver）— 跨窗口拖拽 / 系统集成等场景 E2E 极脆弱。
- **不会**追求覆盖率数字 — 目标是覆盖"会踩坑且不易复测"的代码，不是覆盖一切。
- **不会**做拖拽自动化测试 — 留给 Layer 3 人工 smoke。

---

## 一句话总结

**Rust 纯函数 + TS 纯函数 + Console 自检 + Smoke checklist** = 每次改完跑 `npm run lint && npm test && npm run build && git diff --check`，涉及 Rust 时再跑 `npm run test:rust && npm run lint:rust`；发版候选再补 5 分钟人工 smoke。

这套回归网的目标是让高风险行为有证据可查，同时避免为了追求覆盖率去改坏 ExplorerView 的拖拽、导入、快捷键和刷新链路。
