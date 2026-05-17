/**
 * 路径辅助函数
 *
 * 从 App.tsx 抽出，使可独立测试。
 */

import type { TabData } from '../types';

export const FAVORITES_VIRTUAL_PATH = 'aether://favorites';
export const RECENT_VIRTUAL_PATH = 'aether://recent';
export const TAGS_VIRTUAL_PREFIX = 'aether://tags/';

/**
 * 返回路径最后一段作为"叶子名"。
 *
 * - `/Users/jane/Pictures` → `Pictures`
 * - `/` → `/`
 * - 空字符串 / undefined → `首页`（App 内"首页"概念 — App 第一次进来定位的内容；
 *   注意：不要混淆为系统主目录 `~/`，那个在侧栏叫"用户主页"）
 * - 带尾随斜杠的也正确处理：`/Users/jane/` → `jane`
 */
export function getPathLeaf(path: string | undefined | null): string {
  if (!path) return '首页';
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return path || '首页';
  return parts[parts.length - 1];
}

/**
 * 判断是否为 aether:// 虚拟路径。
 */
export function isVirtualPath(path: string | undefined | null): boolean {
  return !!path && path.startsWith('aether://');
}

/**
 * 根据 URL search params 或默认首页路径返回初始 tabs 列表。
 *
 * - 含 `?path=...&label=...` → 用该路径打开单 tab
 * - 无参数 → 用 defaultHomePath 打开"首页" tab
 */
export function getInitialTabs(
  defaultHomePath: string,
  searchParams: URLSearchParams,
): TabData[] {
  const initialPath = searchParams.get('path');
  const label = searchParams.get('label');

  if (initialPath) {
    return [{
      id: `tab-${Date.now()}`,
      labelTranslationKey: 'tabs.home',
      label: label || getPathLeaf(initialPath),
      initialPath,
      currentPath: initialPath,
    }];
  }

  // 首页 tab label 跟随用户的默认首页：虚拟路径用专属 i18n key（"我的收藏" / "最近使用"），
  // 真实路径用末段名。让用户一眼看出标签页代表的是什么内容。
  const homeLabelKey =
    defaultHomePath === FAVORITES_VIRTUAL_PATH ? 'tabs.favorites' :
    defaultHomePath === RECENT_VIRTUAL_PATH ? 'tabs.recent' :
    'tabs.home';

  return [
    {
      id: 'desktop',
      labelTranslationKey: homeLabelKey,
      label: isVirtualPath(defaultHomePath) ? undefined : getPathLeaf(defaultHomePath),
      initialPath: defaultHomePath,
      currentPath: defaultHomePath,
    },
  ];
}

/**
 * 从一组路径中找到最长共同父目录。
 *
 * 用于多选移动 / 复制时显示"来自 .../X" 提示。
 */
export function commonParent(paths: string[]): string {
  if (paths.length === 0) return '';
  if (paths.length === 1) {
    const idx = paths[0].lastIndexOf('/');
    return idx > 0 ? paths[0].slice(0, idx) : '/';
  }
  const split = paths.map(p => p.split('/'));
  let i = 0;
  outer: while (true) {
    const head = split[0][i];
    if (head === undefined) break;
    for (let k = 1; k < split.length; k++) {
      if (split[k][i] !== head) break outer;
    }
    i++;
  }
  return split[0].slice(0, i).join('/') || '/';
}
