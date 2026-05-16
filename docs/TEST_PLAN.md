# Aether Explorer 测试与回归保障计划

> 起草日期：2026-05-17
> 目标：在不写"全套企业级测试"的前提下，建立**最小可用的回归网**，让你改完代码后能在 5 分钟内确认核心路径没坏。
> 原则：投入产出比优先 — 先盖"安全 + 路径 + 格式化"等纯逻辑、留拖拽 / 视觉给人工 smoke。

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
├── main.rs
└── tests/                              # NEW
    └── (内联在 lib.rs 的 #[cfg(test)] mod tests)

src/
├── ...
└── __tests__/                          # NEW
    ├── settings.test.ts
    ├── url-guard.test.ts
    └── path-helpers.test.ts

docs/
├── TEST_PLAN.md                        # 本文档
└── SMOKE_TEST.md                       # NEW — 人工 checklist + console 脚本
```

> Rust 测试用 `#[cfg(test)] mod tests`（与代码同文件），不另开 `tests/` 集成测试目录 — 保持 lib.rs 重构后测试跟着走。
> 前端测试集中在 `src/__tests__/`，与 source 同根，vitest 默认会扫到。

---

## 三、Layer 1: Rust 纯函数单元测试

### 选取标准
- 不依赖 `tauri::WebviewWindow` / `tauri::State` 等 Tauri 上下文
- 不依赖外部进程（`std::process::Command`）
- 不依赖文件系统（或可走 `tempfile` 隔离）

### 第一批必测函数（15 个）

| 函数 | 位置 | 测试要点 | 优先级 |
|------|------|---------|-------|
| `format_size` | lib.rs:75 | 边界值：0 / 1023 / 1024 / 1048576 / 巨大数；单位精度 | 🟡 |
| `format_kib` | lib.rs:92 | 解析失败回原值；正常 KiB→人类可读 | 🟡 |
| `parse_df_line` | lib.rs:98 | 多空格列 / mount 含空格 / 列数不足返 Err | 🟠 |
| `parse_capacity` | lib.rs:1278 | "85%" → 85；"" / "abc" → 0；">100%" → 100 cap | 🟡 |
| `detect_mime` | lib.rs:106 | 各扩展名分类正确；大小写不敏感；`.app` 识别；不带扩展名 → "file" | 🟠 |
| `unique_destination` | lib.rs:617 | 不存在 → 原路径；存在 → " copy" 后缀递增；含扩展名 / 不含 | 🟠 |
| `encode_query_component` | lib.rs:508 | 中文 / 空格 / & / # 正确百分号编码 | 🟡 |
| `shell_quote` | lib.rs:lookup | 单引号转义；空字符串；含 `$()` 反引号正确包裹 | 🔴 安全 |
| `apple_quote` | lib.rs:1451 | 双引号 / 反斜杠转义；当前死代码 — 写测试时同时考虑是否真接入（详见 RELEASE_AUDIT P0-1） | 🔴 安全 |
| `is_allowed_terminal` | 待新增 | 白名单匹配；大小写不敏感；拒绝注入字符串 | 🔴 安全 |
| `validate_shell_fragment` | 待新增 | 拒绝 `$(` `` ` `` `&&` `\|` `;` `>` `<` `\n`；接受普通命令 | 🔴 安全 |
| `safe_canonicalize` | 待新增 | 不存在路径 → Err；正常路径 → 绝对化；含 `..` → 解析 | 🔴 安全 |
| `format_modified` | lib.rs:297 | 时间格式 `YYYY-MM-DD HH:MM`；无效元数据 → "未知" | 🟡 |
| `format_system_time` | lib.rs:308 | Some/None；时区使用本地 | 🟡 |
| `add_dir_to_zip` 入口校验 | lib.rs | 不存在 / 权限拒绝 → Err；正常返回 Ok | 🟡 |

> 🔴 标的 5 个函数是 **`RELEASE_AUDIT.md` P0-1 命令注入修复的前置依赖** — 写测试时同时定型 API，避免修复时反复返工。

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

预期：所有测试 < 3 秒跑完，0 失败。

---

## 四、Layer 2: 前端 TS 纯函数测试（vitest）

### 安装

```bash
npm install -D vitest @vitest/ui @testing-library/dom jsdom
```

在 `vite.config.ts` 加：
```ts
import { defineConfig } from 'vitest/config';
// ...
test: {
  environment: 'jsdom',
  globals: true,
  include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
}
```

在 `package.json`：
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### 第一批必测函数（8 个 / 文件 3 个）

| 文件 / 函数 | 测试要点 | 优先级 |
|-----------|---------|-------|
| `src/__tests__/settings.test.ts` | | |
| ┖ `normalizeThemeSettings` | 缺字段填默认；旧版字段保留；contextMenuExtensions 过滤 deprecated | 🟠 |
| ┖ `normalizeContextMenuExtensions` | 已 deprecated IDs 被剔除；填默认 actionType；保留自定义 | 🟠 |
| ┖ `loadThemeFromLocalStorage` | 空 localStorage → DEFAULT；坏 JSON → DEFAULT | 🟡 |
| `src/__tests__/path-helpers.test.ts` | | |
| ┖ `getPathLeaf` (App.tsx 抽出) | 普通路径；尾随 `/`；空字符串；`aether://` 虚拟 | 🟡 |
| ┖ `getInitialTabs` | url 含 `path` 参数 → 单 tab；无参数 → 默认主页 | 🟡 |
| `src/__tests__/url-guard.test.ts` | | |
| ┖ `safeShellOpen` (待新增) | http/https/mailto 通过；javascript: / file: / about: 拒绝 | 🔴 安全 |
| ┖ `isValidWallpaperUrl` (待新增) | asset:// / http/https 通过；其他 false | 🔴 安全 |
| ┖ `interpolateActionTemplate` 转义 (待修) | 文件名含 `'` 时 shell-safe；含 `;` 时 shell-safe | 🔴 安全 |

> 🔴 三项与 `RELEASE_AUDIT.md` P0-2/3 的安全修复绑定，**先写测试 → 再改实现**（TDD）。

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

> **依赖工作**：normalizeThemeSettings 当前嵌在 App.tsx 里，需先抽到 `src/lib/settings.ts`。这是 `IMPROVEMENT_PROPOSALS.md` 1.1 / 8.1 的 settings migrator 重构的一部分，顺手做。

### 验证
```bash
npm test
npm run test:watch    # 改代码时实时回归
```

预期：< 2 秒跑完。

---

## 五、Layer 3: Smoke Test Checklist（人工 + console 脚本）

写到 `docs/SMOKE_TEST.md`，**每次合并前过一遍**，5 分钟内能完成。

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
- [ ] 右键 → 移至废纸篓，文件消失
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
应输出 `{ ok: true, checks: N }`。
```

### Console 自检脚本（一并落地）

在 `src/lib/smoke.ts` 写一段 dev-only 工具：
```ts
// 仅 dev 注入 window.__aether.smoke
if (import.meta.env.DEV) {
  (window as any).__aether = {
    async smoke() {
      const checks: Array<[string, () => boolean | Promise<boolean>]> = [
        ['theme loaded', () => !!document.documentElement.style.getPropertyValue('--primary')],
        ['store ready', async () => {
          const { load } = await import('@tauri-apps/plugin-store');
          const s = await load('settings.json', { autoSave: true });
          return !!s;
        }],
        ['list_directory works', async () => {
          const { invoke } = await import('@tauri-apps/api/core');
          const home = await invoke<string>('get_home_dir');
          const entries = await invoke<unknown[]>('list_directory', { dirPath: home, showHidden: false });
          return entries.length > 0;
        }],
        // 5-10 个更多检查
      ];
      const results = await Promise.all(checks.map(async ([name, fn]) => {
        try { return [name, await fn()] as const; }
        catch (e) { return [name, false, String(e)] as const; }
      }));
      const failed = results.filter(r => !r[1]);
      console.table(results.map(r => ({ check: r[0], ok: r[1], err: r[2] })));
      return { ok: failed.length === 0, checks: results.length, failed };
    },
  };
}
```

收益：连"控制台敲一行命令"都能验证 N 个隐式假设是否仍成立。

---

## 六、CI 接入

```yaml
# .github/workflows/release.yml 现有 release 流程之上加 job
jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: dtolnay/rust-toolchain@stable
      - run: npm ci
      - run: npm test
      - run: cd src-tauri && cargo test --lib

  release:
    needs: test    # 测试不过不发版
    # ...
```

收益：未来你或贡献者写 PR，CI 自动跑两层测试。`scripts/release.sh` 本地版也加：
```bash
echo "🧪 跑测试..."
npm test
cd src-tauri && cargo test --lib && cd ..
```

---

## 七、执行计划

### Phase 1：地基（半天）
- [ ] 加 `vitest` 依赖 + `vite.config.ts` 配置
- [ ] 创建 `src/__tests__/` 目录
- [ ] 在 `lib.rs` 末尾添加 `#[cfg(test)] mod tests`
- [ ] 抽出 `normalizeThemeSettings` 到 `src/lib/settings.ts`（便于测试）
- [ ] 写出 5 个 Rust 纯函数测试：`format_size / shell_quote / detect_mime / unique_destination / parse_df_line`
- [ ] 写出 3 个 TS 测试：`normalizeThemeSettings / getPathLeaf / loadThemeFromLocalStorage`
- [ ] 跑通 `npm test` 与 `cargo test --lib`

### Phase 2：补全（半天）
- [ ] Layer 1 剩余 10 个 Rust 测试
- [ ] Layer 2 剩余 5 个 TS 测试
- [ ] CI workflow 接入 `test` job
- [ ] `scripts/release.sh` 加 test gate

### Phase 3：Smoke layer（半天）
- [ ] 写 `docs/SMOKE_TEST.md` 完整 checklist（30 条）
- [ ] 写 `src/lib/smoke.ts` console 自检脚本
- [ ] 在 App.tsx mount 时注入 `window.__aether`（仅 dev）

**总投入：1.5 天 → 永久消除"改一处就怕踩坑"的心理负担**

---

## 八、与未来工作的耦合

| 未来工作 | 测试关联 |
|---------|---------|
| `RELEASE_AUDIT.md` P0-1 命令注入 | 先写 `shell_quote / validate_shell_fragment / apple_quote` 测试，TDD 改实现 |
| `RELEASE_AUDIT.md` P0-2 shell.open 白名单 | 先写 `safeShellOpen` / `isValidWallpaperUrl` 测试 |
| `RELEASE_AUDIT.md` P0-4 路径校验 | 先写 `safe_canonicalize` 测试 |
| `PERF_PLAN.md` L2-B 异步 list_directory | 改成 spawn_blocking 时，原 `format_size / detect_mime / unique_destination` 等纯函数保留，测试不变 |
| `IMPROVEMENT_PROPOSALS.md` 1.1 状态机 | 把 reducer 单独写成纯函数，超容易测 |
| `IMPROVEMENT_PROPOSALS.md` 8.1 settings migrator | `migrateV1ToV2` 是纯函数，直接覆盖 |

每次做新功能 / 修 bug，**先在 `__tests__` 里加一条 failing case → 改代码到 pass**。这是最便宜的"防回归"。

---

## 九、不会做什么

- **不会**做 React 组件渲染测试（@testing-library/react）— 维护成本极高，且 ExplorerView 3800 行难拆。等架构拆分后再考虑。
- **不会**做 E2E（Playwright / Tauri WebDriver）— 跨窗口拖拽 / 系统集成等场景 E2E 极脆弱。
- **不会**追求覆盖率数字 — 目标是覆盖"会踩坑且不易复测"的代码，不是覆盖一切。
- **不会**做拖拽自动化测试 — 留给 Layer 3 人工 smoke。

---

## 一句话总结

**Rust 纯函数 + TS 纯函数 + Console 自检 + Smoke checklist** = 1.5 天投入 → 每次改完跑 `npm test && cargo test --lib`（5 秒）+ console 一行命令（5 秒）+ 5 分钟人工 smoke = 6 分钟内能合并。

比起"复测一遍累"的心理成本，这点投入太值。
