import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sun, Moon, Zap, Sliders, Check, Image as ImageIcon, Languages, Upload, Type, Eye, EyeOff, Monitor, Palette, HardDrive, Shield, Puzzle, Layout, Trash2, Plus, Settings2, Sparkles, Wand2, ChevronRight, Grid2X2, Columns, List, Terminal, Info, RefreshCw, DownloadCloud, BadgeCheck, ExternalLink, Code2, Pencil, FileUp, FileDown, Copy, Folder, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { ThemeSettings, ContextMenuAction, LanguageOption } from '../types';
import { ACCENT_COLORS } from '../constants';

interface SettingsViewProps {
  theme: ThemeSettings;
  onThemeChange: (theme: ThemeSettings) => void;
}

type SettingsCategory = 'appearance' | 'files' | 'permissions' | 'extensions' | 'features' | 'about';

const CURATED_PALETTES = [
  { name: 'Default', colors: ['#007aff', '#EBE0FF', '#FFD8E4', '#C2E7FF'] },
  { name: 'Aurora', colors: ['#5eead4', '#2dd4bf', '#0d9488', '#042f2e'] },
  { name: 'Sunset', colors: ['#fb923c', '#f97316', '#ea580c', '#7c2d12'] },
  { name: 'Lavender', colors: ['#a78bfa', '#8b5cf6', '#7c3aed', '#4c1d95'] },
  { name: 'Forest', colors: ['#4ade80', '#22c55e', '#16a34a', '#14532d'] },
  { name: 'Ocean', colors: ['#38bdf8', '#0ea5e9', '#0284c7', '#0c4a6e'] },
  { name: 'Midnight', colors: ['#6366f1', '#4f46e5', '#4338ca', '#312e81'] },
  { name: 'Ruby', colors: ['#fb7185', '#f43f5e', '#e11d48', '#881337'] },
];

const CHINESE_COLOR_PALETTES = [
  { name: '胭脂', colors: ['#C04851', '#E3A6A1', '#F2D7D5', '#7C1823'] },
  { name: '黛蓝', colors: ['#425066', '#2F4056', '#8AA4BE', '#D8E3E7'] },
  { name: '竹青', colors: ['#789262', '#A4CAB6', '#D8E8D1', '#2B5B45'] },
  { name: '缃叶', colors: ['#ECD452', '#F8E9A1', '#B9A449', '#5B4D16'] },
  { name: '霁青', colors: ['#63BBD0', '#B8E5E3', '#2E8A99', '#164C5A'] },
  { name: '紫棠', colors: ['#56004F', '#8B2671', '#C57BA3', '#F0D5E5'] },
  { name: '藕荷', colors: ['#A7535A', '#D6A0A6', '#F0D7DA', '#6E3338'] },
  { name: '秋香', colors: ['#D9B611', '#F1D86A', '#FFF4B8', '#7A5C00'] },
];

const BUILT_IN_LANGUAGES: LanguageOption[] = [
  { code: 'zh', label: '简体中文', nativeLabel: '简体中文', source: 'built-in', completeness: 100, enabled: true },
  { code: 'en', label: 'English', nativeLabel: 'English', source: 'built-in', completeness: 100, enabled: true },
];

const AVAILABLE_LANGUAGE_SLOTS: LanguageOption[] = [
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', source: 'available', completeness: 0, enabled: false },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어', source: 'available', completeness: 0, enabled: false },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', source: 'available', completeness: 0, enabled: false },
];

const CORE_CONTEXT_ACTIONS = ['打开', '重命名', '复制到', '移动到', '压缩', '解压', 'Quick Look', 'Finder 显示', '复制路径', '终端打开', '移至废纸篓'];

const ACTION_TYPE_META = {
  terminal: { label: '终端动作', description: '打开指定终端，并在选中目录或当前目录执行启动参数。', icon: Terminal },
  shell: { label: 'Shell 命令', description: '把命令模板带入终端执行，适合脚本、构建、批处理。', icon: Code2 },
  url: { label: 'URL 动作', description: '按模板生成链接并交给系统浏览器打开。', icon: ExternalLink },
  placeholder: { label: '插件占位', description: '保留菜单入口，等待后续插件或 AI 工作流接入。', icon: Sparkles },
} satisfies Record<NonNullable<ContextMenuAction['actionType']>, { label: string; description: string; icon: React.ComponentType<{ className?: string }> }>;

type UpdateStatus = {
  state: 'idle' | 'checking' | 'current' | 'available' | 'error';
  currentVersion: string;
  latestVersion: string;
  releaseUrl?: string;
  message: string;
};

const DEFAULT_UPDATE_STATUS: UpdateStatus = {
  state: 'idle',
  currentVersion: '',
  latestVersion: '',
  releaseUrl: '',
  message: '尚未检查更新。',
};

export default function SettingsView({ theme, onThemeChange }: SettingsViewProps) {
  const { t, i18n } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('appearance');
  const [availableFonts, setAvailableFonts] = useState<string[]>(['Inter', 'System Default', 'Arial', 'Segoe UI', 'Roboto', 'Times New Roman']);
  const [terminalApps, setTerminalApps] = useState<string[]>(['Terminal', 'iTerm']);
  const [newActionLabel, setNewActionLabel] = useState('');
  const [newActionType, setNewActionType] = useState<NonNullable<ContextMenuAction['actionType']>>('terminal');
  const [newTerminalApp, setNewTerminalApp] = useState(theme.terminalApp || 'Terminal');
  const [newTerminalArgs, setNewTerminalArgs] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newUrlTemplate, setNewUrlTemplate] = useState('');
  const [newWorkingDirectory, setNewWorkingDirectory] = useState<'selection' | 'current'>('selection');
  const [editingExtensionId, setEditingExtensionId] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(DEFAULT_UPDATE_STATUS);
  const [showLanguageManager, setShowLanguageManager] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<{ cleaning: boolean; message: string }>({ cleaning: false, message: '' });
  const updateTimerRef = useRef<number | null>(null);
  const updateRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    invoke<string[]>('list_fonts').then(fonts => {
      if (!cancelled) setAvailableFonts(['Inter', 'System Default', ...fonts]);
    }).catch(() => {
      if (!cancelled) setAvailableFonts(['Inter', 'System Default', 'Arial', 'Helvetica', 'Times New Roman', 'Courier']);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<string[]>('list_terminal_apps')
      .then(apps => {
        if (!cancelled) setTerminalApps(apps.length ? apps : ['Terminal', 'iTerm']);
      })
      .catch(() => {
        if (!cancelled) setTerminalApps(['Terminal', 'iTerm']);
      });
    return () => { cancelled = true; };
  }, []);

  const handleFileUpload = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }]
    });
    if (selected && typeof selected === "string") {
      onThemeChange({
        ...theme,
        wallpaperUrl: convertFileSrc(selected),
        wallpaperBlur: 0,
        blurIntensity: 0
      });
    }
  };

  const handleWallpaperUrlChange = (url: string) => {
    const trimmedUrl = url.trim();
    if (trimmedUrl && !theme.wallpaperUrl) {
      // 首次设置壁纸，自动将模糊效果调为 0
      onThemeChange({
        ...theme,
        wallpaperUrl: url,
        wallpaperBlur: 0,
        blurIntensity: 0
      });
    } else {
      onThemeChange({ ...theme, wallpaperUrl: url });
    }
  };

  const resetActionForm = () => {
    setEditingExtensionId(null);
    setNewActionLabel('');
    setNewActionType('terminal');
    setNewTerminalApp(theme.terminalApp || 'Terminal');
    setNewTerminalArgs('');
    setNewCommand('');
    setNewUrlTemplate('');
    setNewWorkingDirectory('selection');
  };

  const populateActionForm = (ext: ContextMenuAction) => {
    setEditingExtensionId(ext.id);
    setNewActionLabel(ext.label);
    setNewActionType(ext.actionType || 'placeholder');
    setNewTerminalApp(ext.terminalApp || theme.terminalApp || 'Terminal');
    setNewTerminalArgs(ext.terminalArgs || '');
    setNewCommand(ext.command || '');
    setNewUrlTemplate(ext.urlTemplate || '');
    setNewWorkingDirectory(ext.workingDirectory || 'selection');
  };

  const toggleExtension = (id: string) => {
    const extensions = theme.contextMenuExtensions || [];
    onThemeChange({
      ...theme,
      contextMenuExtensions: extensions.map(ext => 
        ext.id === id ? { ...ext, enabled: !ext.enabled } : ext
      )
    });
  };

  const updateExtension = () => {
    if (!editingExtensionId || !isNewActionValid()) return;
    const extensions = theme.contextMenuExtensions || [];
    const nextExtensions = extensions.map(ext => {
      if (ext.id !== editingExtensionId) return ext;
      const updated: ContextMenuAction = {
        ...ext,
        label: newActionLabel.trim(),
        actionType: newActionType,
        workingDirectory: newWorkingDirectory,
        confirmExecution: ext.confirmExecution ?? true,
      };
      delete updated.terminalApp;
      delete updated.terminalArgs;
      delete updated.command;
      delete updated.urlTemplate;
      if (newActionType === 'terminal') {
        updated.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
        updated.terminalArgs = newTerminalArgs.trim();
      }
      if (newActionType === 'shell') {
        updated.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
        updated.command = newCommand.trim();
      }
      if (newActionType === 'url') {
        updated.urlTemplate = newUrlTemplate.trim();
      }
      return updated;
    });
    onThemeChange({ ...theme, contextMenuExtensions: nextExtensions });
    resetActionForm();
  };

  const isNewActionValid = () => {
    if (!newActionLabel.trim()) return false;
    if (newActionType === 'shell') return Boolean(newCommand.trim());
    if (newActionType === 'url') return Boolean(newUrlTemplate.trim());
    return true;
  };

  const addExtension = () => {
    if (editingExtensionId) {
      updateExtension();
      return;
    }
    if (!isNewActionValid()) return;
    const extensions = theme.contextMenuExtensions || [];
    const label = newActionLabel.trim();
    const newExt: ContextMenuAction = {
      id: `custom-${Date.now()}`,
      label,
      enabled: true,
      actionType: newActionType,
      workingDirectory: newWorkingDirectory,
    };
    if (newActionType === 'terminal') {
      newExt.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
      newExt.terminalArgs = newTerminalArgs.trim();
    }
    if (newActionType === 'shell') {
      newExt.terminalApp = newTerminalApp || theme.terminalApp || 'Terminal';
      newExt.command = newCommand.trim();
    }
    if (newActionType === 'url') {
      newExt.urlTemplate = newUrlTemplate.trim();
    }
    onThemeChange({
      ...theme,
      contextMenuExtensions: [...extensions, newExt]
    });
    resetActionForm();
  };

  const deleteExtension = (id: string) => {
    const extensions = theme.contextMenuExtensions || [];
    onThemeChange({
      ...theme,
      contextMenuExtensions: extensions.filter(ext => ext.id !== id)
    });
  };

  const handleExportExtensions = async () => {
    const path = await save({ defaultPath: 'aether-context-menu.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return;
    const payload = JSON.stringify(theme.contextMenuExtensions || [], null, 2);
    try {
      await writeTextFile(path, payload);
    } catch (err) {
      console.error('导出失败', err);
    }
  };

  const handleImportExtensions = async () => {
    const selected = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!selected || typeof selected !== 'string') return;
    try {
      const content = await readTextFile(selected);
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) throw new Error('文件格式不正确');
      const normalized = parsed
        .filter(item => item && typeof item === 'object')
        .map((item: ContextMenuAction, index: number) => ({
          ...item,
          id: item.id || `imported-${Date.now()}-${index}`,
          enabled: item.enabled !== false,
          actionType: item.actionType || 'placeholder',
          workingDirectory: item.workingDirectory || 'selection',
          confirmExecution: item.confirmExecution ?? true,
        }));
      onThemeChange({ ...theme, contextMenuExtensions: normalized });
    } catch (err) {
      console.error('导入失败', err);
    }
  };

  const handleDeleteExtension = async (id: string, label: string) => {
    const ok = await window.confirm(`确定删除「${label}」吗？`);
    if (!ok) return;
    deleteExtension(id);
  };

  const pendingDmgRef = useRef('');

  const handleCheckUpdates = async () => {
    setUpdateStatus({ state: 'checking', currentVersion: '', latestVersion: '', releaseUrl: '', message: '正在检查更新...' });
    try {
      const currentVersion = (await getVersion().catch(() => '')) || import.meta.env.VITE_APP_VERSION || '0.1.0';
      const response = await fetch('https://api.github.com/repos/HaoRangQi/aether-explorer/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (!response.ok) throw new Error(`GitHub API 返回 ${response.status}`);
      const release = await response.json();
      const latestVersion = String(release.tag_name || release.name || '').replace(/^v/, '');
      const normalizedCurrent = currentVersion.replace(/^v/, '');
      // 找到 universal 或 aarch64 的 DMG
      const dmgAsset = (release.assets || []).find((a: any) =>
        a.name && a.name.endsWith('.dmg') && (a.name.includes('universal') || a.name.includes('aarch64'))
      );
      if (latestVersion === normalizedCurrent) {
        setUpdateStatus({ state: 'current', currentVersion: normalizedCurrent, latestVersion, releaseUrl: '', message: `已是最新版本：${normalizedCurrent}` });
        return;
      }
      pendingDmgRef.current = dmgAsset?.browser_download_url || '';
      setUpdateStatus({
        state: 'available',
        currentVersion: normalizedCurrent,
        latestVersion,
        releaseUrl: release.html_url || '',
        message: `发现新版本：${latestVersion}`,
      });
    } catch (err) {
      setUpdateStatus({ state: 'error', currentVersion: '', latestVersion: '', releaseUrl: '', message: `检查失败：${String(err)}` });
    }
  };

  const handleDownloadUpdate = async () => {
    const dmgUrl = pendingDmgRef.current;
    if (!dmgUrl) {
      setUpdateStatus(prev => ({ ...prev, message: '未找到下载地址' }));
      return;
    }
    setUpdateStatus(prev => ({ ...prev, message: '正在打开下载页面...' }));
    shellOpen(dmgUrl);
    setUpdateStatus(prev => ({ ...prev, message: '已打开 DMG 下载链接，下载后覆盖安装即可。' }));
  };

  const handleCleanup = async () => {
    setCleanupStatus({ cleaning: true, message: '正在清理缓存...' });

    try {
      // 清理 localStorage 中的临时数据
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('aether-dragging-') || key.includes('-cache-') || key.includes('-temp-'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // 清理 sessionStorage
      sessionStorage.clear();

      // 调用后端清理缓存目录（如果有的话）
      try {
        await invoke('clear_app_cache');
      } catch {
        // 后端可能没有实现此命令，忽略错误
      }

      setCleanupStatus({
        cleaning: false,
        message: `清理完成！已清理 ${keysToRemove.length} 个缓存项。`
      });

      // 3秒后清除消息
      setTimeout(() => {
        setCleanupStatus({ cleaning: false, message: '' });
      }, 3000);
    } catch (err) {
      setCleanupStatus({
        cleaning: false,
        message: `清理失败：${String(err)}`
      });
    }
  };

  const categories = [
    { id: 'appearance', label: t('settings.appearanceHeader', '主题与外观'), icon: Palette },
    { id: 'files', label: t('settings.filesHeader', '文件与存储'), icon: HardDrive },
    { id: 'permissions', label: t('settings.privacyHeader', '权限与隐私'), icon: Shield },
    { id: 'extensions', label: t('settings.extensionsHeader', '右键菜单扩展'), icon: Puzzle },
    { id: 'features', label: '功能设置', icon: Monitor },
    { id: 'about', label: '关于', icon: Info },
  ];

  const selectedLanguage = theme.language || i18n.language || 'zh';
  const languageOptions = theme.languageOptions || BUILT_IN_LANGUAGES;
  const visibleLanguages = [...languageOptions, ...AVAILABLE_LANGUAGE_SLOTS.filter(slot => !languageOptions.some(lang => lang.code === slot.code))];
  const systemLanguage = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';

  const applyLanguage = (code: string) => {
    i18n.changeLanguage(code);
    onThemeChange({ ...theme, language: code, followSystemLanguage: false, languageOptions });
  };

  const toggleFollowSystemLanguage = () => {
    const nextFollow = !theme.followSystemLanguage;
    const nextLanguage = nextFollow ? systemLanguage : selectedLanguage;
    i18n.changeLanguage(nextLanguage);
    onThemeChange({ ...theme, followSystemLanguage: nextFollow, language: nextLanguage, languageOptions });
  };

  const renderAppearanceCategory = () => (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      {/* Mode & materials */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="bg-primary/5 rounded-3xl p-8 border border-primary/10 space-y-6">
          <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
            <Sun className="w-4 h-4 text-primary" /> {t('settings.appearanceMode', '色彩基调')}
          </h3>
          <div className="bg-primary/5 p-1.5 rounded-2xl flex gap-1.5">
            {[
              { id: 'light', label: t('settings.light'), icon: Sun },
              { id: 'dark', label: t('settings.dark'), icon: Moon },
              { id: 'auto', label: t('settings.auto'), icon: Zap },
            ].map((mode) => {
              const isActive = theme.mode === mode.id;
              return (
                <button
                  key={mode.id}
                  onClick={() => onThemeChange({ ...theme, mode: mode.id as any })}
                  className={`flex-1 py-4 rounded-xl flex items-center justify-center gap-2 text-[13px] font-bold transition-all relative
                    ${isActive ? 'text-on-primary' : 'text-on-surface/40 hover:text-on-surface/80 hover:bg-primary/10'}
                  `}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-mode-pill"
                      className="absolute inset-0 bg-primary rounded-xl z-0 shadow-lg shadow-primary/20"
                    />
                  )}
                  <mode.icon className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">{mode.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="bg-primary/5 rounded-3xl p-8 border border-primary/10 space-y-8">
          <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
            <Sliders className="w-4 h-4 text-primary" /> {t('settings.materialEffects', '毛玻璃质感')}
          </h3>
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <label className="text-[13px] font-bold text-on-surface/60 uppercase tracking-wider">{t('settings.blurIntensity')}</label>
              <span className="text-[13px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-md">{theme.blurIntensity}px</span>
            </div>
            <input 
              type="range" min="0" max="64" value={theme.blurIntensity}
              onChange={(e) => onThemeChange({ ...theme, blurIntensity: parseInt(e.target.value) })}
              className="w-full h-1.5 bg-primary/10 rounded-full appearance-none cursor-pointer accent-primary"
            />
          </div>
        </section>
      </div>

      <section className="bg-primary/5 rounded-[32px] p-8 border border-primary/10 overflow-hidden space-y-8">
        <header className="text-left">
          <h3 className="text-[22px] font-black text-on-surface tracking-tight mb-2">{t('settings.accentColor', '品牌强调色')}</h3>
          <p className="text-[13px] text-on-surface/40 leading-relaxed max-w-2xl">
            系统核心视觉标识。选择一个最具代表性的色彩，它将作为 UI 全局的主基调。
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5">
          <div className="rounded-3xl bg-primary/5 border border-primary/10 p-5 space-y-4">
            <label className="text-[11px] font-black text-primary uppercase tracking-[0.18em]">{t('settings.swatches', '常用色样')}</label>
            <div className="flex flex-wrap gap-3 items-center">
              {ACCENT_COLORS.map((color) => {
                const isActive = theme.accentColor === color;
                return (
                  <button
                    key={color}
                    onClick={() => onThemeChange({ ...theme, accentColor: color })}
                    style={{ backgroundColor: color }}
                    className={`relative w-10 h-10 rounded-xl shadow-md transition-all duration-300 hover:scale-105 active:scale-95 flex items-center justify-center
                      ${isActive ? 'ring-3 ring-primary/40 scale-105 z-10 shadow-lg' : 'opacity-85 hover:opacity-100'}
                    `}
                    title={color}
                  >
                    {isActive && <Check className="w-5 h-5 text-white drop-shadow-lg z-20" />}
                    <div className="absolute inset-0 rounded-xl border border-white/20 pointer-events-none" />
                  </button>
                );
              })}
              <div className="flex gap-2 items-center bg-primary/5 p-1.5 rounded-2xl border border-primary/20 hover:border-primary/40 transition-all">
                <div className="relative w-9 h-9 rounded-xl overflow-hidden shadow-inner border border-white/10 shrink-0">
                  <input
                    type="color"
                    value={theme.accentColor}
                    onChange={(e) => onThemeChange({ ...theme, accentColor: e.target.value })}
                    className="absolute -inset-4 w-[200%] h-[200%] cursor-pointer border-none bg-transparent"
                  />
                </div>
                <input
                  type="text"
                  value={theme.accentColor}
                  onChange={(e) => onThemeChange({ ...theme, accentColor: e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}` })}
                  className="w-20 bg-transparent border-none text-[12px] font-black font-mono outline-none uppercase text-on-surface/80 focus:text-primary transition-colors"
                  placeholder="#HEX"
                />
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-primary/5 border border-primary/10 p-5 flex items-center gap-4 min-w-0">
            <div className="w-16 h-16 rounded-2xl shrink-0 shadow-xl border border-white/10 flex items-center justify-center" style={{ backgroundColor: theme.accentColor }}>
              <div className="w-8 h-8 rounded-full bg-white/30 blur-xl" />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-[11px] font-black text-primary uppercase tracking-[0.18em]">当前强调色</p>
              <p className="text-[20px] font-black text-on-surface font-mono uppercase leading-none truncate">{theme.accentColor}</p>
              <p className="text-[12px] text-on-surface/45 leading-relaxed">选定的强调色将直接影响全局变量。</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-[11px] font-black text-on-surface/35 uppercase tracking-[0.18em]">{t('settings.palettes', '精品调色盘推荐')}</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CURATED_PALETTES.map(p => (
              <button
                key={p.name}
                onClick={() => onThemeChange({ ...theme, accentColor: p.colors[0] })}
                className="flex items-center justify-between gap-3 p-3 bg-primary/5 rounded-2xl hover:bg-primary/10 transition-all border border-transparent hover:border-primary/20 group/pal min-w-0"
              >
                <div className="flex shrink-0">
                  {p.colors.map((c, i) => (
                    <div key={i} className="w-6 h-6 rounded-full -ml-1.5 first:ml-0 border-2 border-on-surface/10 shadow-sm" style={{ backgroundColor: c, zIndex: 10 - i }} />
                  ))}
                </div>
                <span className="text-[12px] font-bold text-on-surface/60 group-hover/pal:text-primary transition-colors truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-[11px] font-black text-on-surface/35 uppercase tracking-[0.18em]">中国传统色 调色盘推荐</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CHINESE_COLOR_PALETTES.map(p => (
              <button
                key={p.name}
                onClick={() => onThemeChange({ ...theme, accentColor: p.colors[0] })}
                className="p-3 rounded-2xl bg-primary/5 border border-transparent hover:border-primary/20 hover:bg-primary/10 transition-all text-left group/cn min-w-0"
              >
                <div className="grid grid-cols-4 gap-1 mb-3">
                  {p.colors.map(color => (
                    <div key={color} className="h-7 rounded-lg border border-white/10 shadow-sm" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-black text-on-surface/70 group-hover/cn:text-primary transition-colors truncate">{p.name}</span>
                  <span className="text-[10px] font-mono text-on-surface/30 uppercase truncate">{p.colors[0]}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Wallpaper & Blur */}
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-10">
        <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary" /> {t('settings.wallpaperHeader', '动态壁纸与视差')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
          <div className="space-y-8">
            <div className="space-y-6">
              <label className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">{t('settings.customWallpaper', '链接导入')}</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={theme.wallpaperUrl || ''}
                  onChange={(e) => handleWallpaperUrlChange(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="flex-1 bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all font-medium"
                />
                <button
                  onClick={() => onThemeChange({ ...theme, wallpaperUrl: undefined })}
                  className="px-5 bg-primary/10 rounded-2xl text-[13px] font-bold hover:bg-primary/20 transition-all"
                >
                  {t('common.reset')}
                </button>
              </div>
            </div>
            <div className="relative">
              <button
                onClick={handleFileUpload}
                className="w-full flex items-center justify-center gap-3 px-8 py-5 bg-primary rounded-[24px] shadow-xl shadow-primary/30 hover:scale-[1.02] active:scale-95 transition-all text-on-primary font-black text-[15px] uppercase tracking-widest"
              >
                <Upload className="w-5 h-5" />
                {t('settings.uploadWallpaper', '上传本地壁纸')}
              </button>
            </div>
          </div>
          
          <div className="space-y-8">
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">{t('settings.wallpaperBlur')}</label>
                <span className="text-[14px] font-black text-primary bg-primary/10 px-2.5 py-1 rounded-lg">{theme.wallpaperBlur || 0}px</span>
              </div>
              <input 
                type="range" min="0" max="100" step="1"
                value={theme.wallpaperBlur || 0}
                onChange={(e) => onThemeChange({ ...theme, wallpaperBlur: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-primary/10 rounded-full appearance-none cursor-pointer accent-primary"
              />
            </div>
            
            <div className="p-6 bg-primary/5 rounded-[24px] border border-primary/10">
               <h4 className="text-[13px] font-bold text-on-surface mb-2 flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-primary" /> 智能优化
               </h4>
               <p className="text-[11px] text-on-surface/50 leading-relaxed">启用后，系统会根据壁纸的主色调自动调整 UI 文字的反对比度，并为背景注入微妙的模糊效果，提升层级感。</p>
            </div>
          </div>
        </div>
      </section>

      {/* Layout Parameters */}
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-12">
         <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
           <Layout className="w-4 h-4 text-primary" /> {t('settings.layoutControls', '布局精算调整')}
         </h3>
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            <div className="space-y-10">
              <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                    <Grid2X2 className="w-5 h-5" />
                 </div>
                 <h4 className="text-[15px] font-black text-on-surface uppercase tracking-widest">{t('views.grid')}</h4>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[12px] font-bold text-on-surface/60">{t('settings.gridWidth', '项目宽度')}</label>
                    <span className="text-[13px] font-black text-primary">{theme.gridWidth || 180}px</span>
                  </div>
                  <input type="range" min="100" max="400" value={theme.gridWidth || 180} onChange={(e) => onThemeChange({ ...theme, gridWidth: parseInt(e.target.value) })} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[12px] font-bold text-on-surface/60">{t('settings.gridHeight', '项目高度')}</label>
                    <span className="text-[13px] font-black text-primary">{theme.gridHeight || 180}px</span>
                  </div>
                  <input type="range" min="100" max="400" value={theme.gridHeight || 180} onChange={(e) => onThemeChange({ ...theme, gridHeight: parseInt(e.target.value) })} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                </div>

                <div className="space-y-4 sm:col-span-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[12px] font-bold text-on-surface/60">{t('settings.gridGap', '网格间距')}</label>
                    <span className="text-[13px] font-black text-primary">{theme.gridGap || 16}px</span>
                  </div>
                  <input type="range" min="4" max="64" step="4" value={theme.gridGap || 16} onChange={(e) => onThemeChange({ ...theme, gridGap: parseInt(e.target.value) })} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                </div>
              </div>
            </div>

            <div className="space-y-10">
               <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-2xl bg-secondary/10 flex items-center justify-center text-secondary">
                    <Columns className="w-5 h-5" />
                 </div>
                 <h4 className="text-[15px] font-black text-on-surface uppercase tracking-widest">{t('views.column')}</h4>
               </div>
               
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                 <div className="space-y-4">
                   <div className="flex justify-between items-center">
                     <label className="text-[12px] font-bold text-on-surface/60">{t('settings.columnWidth', '列宽度')}</label>
                     <span className="text-[13px] font-black text-primary">{theme.columnWidth || 280}px</span>
                   </div>
                   <input type="range" min="200" max="600" value={theme.columnWidth || 280} onChange={(e) => onThemeChange({ ...theme, columnWidth: parseInt(e.target.value) })} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                 </div>

                 <div className="space-y-4">
                   <div className="flex justify-between items-center">
                     <label className="text-[12px] font-bold text-on-surface/60">{t('settings.columnHeight', '项目高度')}</label>
                     <span className="text-[13px] font-black text-primary">{theme.columnHeight || 60}px</span>
                   </div>
                   <input type="range" min="40" max="120" value={theme.columnHeight || 60} onChange={(e) => onThemeChange({ ...theme, columnHeight: parseInt(e.target.value) })} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                 </div>
               </div>

               <div className="space-y-6 pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                       <List className="w-4 h-4" />
                    </div>
                    <label className="text-[12px] font-black text-on-surface uppercase tracking-widest">{t('settings.listDensity', '列表模式密度')}</label>
                  </div>
                  <div className="bg-primary/5 p-1.5 rounded-2xl flex gap-1.5">
                    {[
                      { id: 'relaxed', label: t('settings.relaxed', '宽松'), scale: '100%' },
                      { id: 'normal', label: t('settings.normal', '标准'), scale: '90%' },
                      { id: 'compact', label: t('settings.compact', '紧凑'), scale: '80%' },
                      { id: 'ultra', label: t('settings.ultra', '极致'), scale: '70%' },
                    ].map((d) => {
                      const isActive = (theme.listDensity || 'normal') === d.id;
                      return (
                        <button
                          key={d.id}
                          onClick={() => onThemeChange({ ...theme, listDensity: d.id as any })}
                          className={`flex-1 py-3 rounded-xl flex flex-col items-center justify-center gap-1 transition-all relative
                            ${isActive ? 'text-on-primary' : 'text-on-surface/40 hover:text-on-surface/80 hover:bg-primary/10'}
                          `}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="active-density-pill"
                              className="absolute inset-0 bg-primary rounded-xl z-0 shadow-lg shadow-primary/20"
                            />
                          )}
                          <span className="relative z-10 text-[12px] font-black">{d.label}</span>
                          <span className={`relative z-10 text-[9px] font-bold ${isActive ? 'text-on-primary/60' : 'text-on-surface/30'}`}>{d.scale}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-on-surface/40 px-2 leading-relaxed">
                    调整列表视图中的项目间距与缩放比例。高密度设置会自动缩小图标及文字尺寸，以提升信息呈现效率。
                  </p>
               </div>
            </div>
         </div>
      </section>

      {/* Font & Language */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="bg-primary/5 rounded-3xl p-8 border border-primary/10 space-y-6">
          <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
            <Type className="w-4 h-4 text-primary" /> {t('settings.fontFamily')}
          </h3>
          <div className="relative">
            <select
              value={theme.fontFamily || 'Inter'}
              onChange={(e) => onThemeChange({ ...theme, fontFamily: e.target.value })}
              className="w-full bg-primary/5 border-2 border-primary/10 rounded-2xl px-5 py-4 text-[14px] text-on-surface font-bold appearance-none outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all"
            >
              {availableFonts.map(font => (
                <option key={font} value={font === 'System Default' ? 'system-ui, sans-serif' : font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
               <ChevronRight className="w-4 h-4 rotate-90" />
            </div>
          </div>
        </section>

        <section className="bg-primary/5 rounded-3xl p-8 border border-primary/10 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
                <Languages className="w-4 h-4 text-primary" /> {t('settings.language')}
              </h3>
              <p className="text-[11px] text-on-surface/40 leading-relaxed">保留常用语言快速切换，更多语言通过管理面板扩展。</p>
            </div>
            <button
              onClick={() => setShowLanguageManager(true)}
              className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-[11px] font-black hover:bg-primary/20 transition-colors whitespace-nowrap"
            >
              管理语言
            </button>
          </div>
          <div className="flex gap-2 bg-primary/5 p-2 rounded-2xl items-center border border-primary/10">
            <button onClick={() => applyLanguage('zh')} className={`flex-1 py-4 rounded-xl text-[13px] font-black transition-all relative ${selectedLanguage === 'zh' && !theme.followSystemLanguage ? 'text-on-primary' : 'text-on-surface/40 hover:text-on-surface'}`}>
               {selectedLanguage === 'zh' && !theme.followSystemLanguage && <motion.div layoutId="nav-lang" className="absolute inset-0 bg-primary rounded-xl z-0 shadow-lg shadow-primary/20" />}
               <span className="relative z-10 uppercase tracking-widest">中文 (CN)</span>
            </button>
            <button onClick={() => applyLanguage('en')} className={`flex-1 py-4 rounded-xl text-[13px] font-black transition-all relative ${selectedLanguage === 'en' && !theme.followSystemLanguage ? 'text-on-primary' : 'text-on-surface/40 hover:text-on-surface'}`}>
               {selectedLanguage === 'en' && !theme.followSystemLanguage && <motion.div layoutId="nav-lang" className="absolute inset-0 bg-primary rounded-xl z-0 shadow-lg shadow-primary/20" />}
               <span className="relative z-10 uppercase tracking-widest">English</span>
            </button>
          </div>
          <button
            onClick={toggleFollowSystemLanguage}
            className="w-full flex items-center justify-between gap-4 px-4 py-3 rounded-2xl bg-primary/5 border border-primary/10 hover:border-primary/20 transition-all"
          >
            <div className="text-left">
              <p className="text-[13px] font-bold text-on-surface">跟随系统语言</p>
              <p className="text-[11px] text-on-surface/35 mt-0.5">当前系统建议：{systemLanguage === 'zh' ? '简体中文' : 'English'}</p>
            </div>
            <div className={`w-12 h-7 rounded-full p-1 transition-colors flex items-center ${theme.followSystemLanguage ? 'bg-primary' : 'bg-on-surface/[0.12]'}`}>
              <motion.div animate={{ x: theme.followSystemLanguage ? 20 : 0 }} className="w-5 h-5 rounded-full bg-white shadow-lg" />
            </div>
          </button>
        </section>
      </div>

      <AnimatePresence>
        {showLanguageManager && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center p-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLanguageManager(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 20 }}
              className="relative w-full max-w-2xl rounded-[32px] bg-surface-container-high/95 border border-primary/20 shadow-2xl overflow-hidden"
            >
              <header className="px-8 py-6 border-b border-primary/10 flex items-center justify-between">
                <div>
                  <h3 className="text-[20px] font-black text-on-surface">语言管理</h3>
                  <p className="text-[12px] text-on-surface/40 mt-1">内置语言可立即切换，第三方语言包后续从这里导入和校验。</p>
                </div>
                <button onClick={() => setShowLanguageManager(false)} className="px-4 py-2 rounded-full bg-primary/10 text-primary text-[11px] font-black hover:bg-primary/20 transition-colors">完成</button>
              </header>

              <div className="p-8 space-y-4 max-h-[62vh] overflow-y-auto custom-scrollbar">
                {visibleLanguages.map(lang => {
                  const isCurrent = !theme.followSystemLanguage && selectedLanguage === lang.code;
                  const isAvailable = lang.source !== 'available';
                  return (
                    <button
                      key={lang.code}
                      onClick={() => isAvailable && applyLanguage(lang.code)}
                      disabled={!isAvailable}
                      className={`w-full rounded-2xl border px-5 py-4 flex items-center gap-4 text-left transition-all ${isCurrent ? 'bg-primary/10 border-primary/30' : 'bg-primary/5 border-primary/10 hover:border-primary/20'} ${!isAvailable ? 'opacity-55 cursor-not-allowed' : ''}`}
                    >
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-[12px] font-black ${isCurrent ? 'bg-primary text-on-primary' : 'bg-primary/10 text-primary'}`}>
                        {lang.code.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[14px] font-black text-on-surface truncate">{lang.nativeLabel}</p>
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-on-surface/10 text-on-surface/45">
                            {lang.source === 'built-in' ? '内置' : lang.source === 'imported' ? '已导入' : '可扩展'}
                          </span>
                        </div>
                        <p className="text-[11px] text-on-surface/35 mt-1">{lang.label} · 翻译完整度 {lang.completeness}%</p>
                      </div>
                      {isCurrent && <Check className="w-5 h-5 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>

              <footer className="px-8 py-6 border-t border-primary/10 flex items-center justify-between gap-4">
                <div className="text-[11px] text-on-surface/35 leading-relaxed">
                  语言包接口已预留：`registerLanguagePack(code, translation)`。
                </div>
                <button className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black opacity-70 cursor-not-allowed" title={t('tooltips.nextLangPackImport')}>
                  导入语言包
                </button>
              </footer>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Live Preview Card — at bottom */}
      <section className="bg-primary/5 rounded-[40px] p-8 m3-card flex flex-col items-center justify-center relative overflow-hidden group border border-primary/20">
         <h3 className="text-[17px] font-black text-primary uppercase tracking-widest flex items-center gap-2 mb-8">
            <Sparkles className="w-4 h-4" /> 实时预览
         </h3>
         <div className="w-full max-w-[340px] bg-primary/20 border-2 border-primary/30 rounded-[32px] p-8 shadow-2xl backdrop-blur-3xl transition-all duration-700 hover:scale-[1.02] relative z-10">
            <div className="flex items-center gap-2 mb-8">
              <div className="w-3 h-3 rounded-full bg-primary/60" />
              <div className="w-3 h-3 rounded-full bg-primary/40" />
              <div className="w-3 h-3 rounded-full bg-primary/20" />
            </div>
            <div className="flex gap-4 mb-8">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg" style={{ backgroundColor: theme.accentColor }}>
                <ImageIcon className="w-7 h-7 text-on-surface mix-blend-difference" />
              </div>
              <div className="flex-1 space-y-4 py-2">
                <div className="h-4 bg-primary/40 rounded-full w-5/6" />
                <div className="h-3 bg-primary/20 rounded-full w-1/2" />
              </div>
            </div>
            <div className="space-y-4">
               <div className="h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center px-4">
                  <div className="w-1/2 h-1.5 bg-primary/30 rounded-full" />
               </div>
               <div className="h-12 rounded-2xl bg-primary text-on-primary flex items-center justify-center text-[13px] font-black shadow-lg shadow-primary/30 uppercase tracking-widest">
                  Preview Content
               </div>
            </div>
         </div>
      </section>
    </div>
  );

  const [multiWindow, setMultiWindow] = useState(false);

  const renderFeaturesCategory = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <h3 className="text-[18px] font-black text-on-surface flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Monitor className="w-5 h-5 text-primary" />
          </div>
          窗口与标签页
        </h3>

        <div className="space-y-2">
          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">允许多窗口</h4>
              <p className="text-[12px] text-on-surface/50">开启后可按 Cmd+N 新建独立窗口。默认使用多标签页，已满足大多数场景。</p>
            </div>
            <button
              onClick={() => setMultiWindow(!multiWindow)}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${multiWindow ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: multiWindow ? 24 : 0 }} className="w-5 h-5 rounded-full shadow-lg bg-white" />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">使用系统右键菜单</h4>
              <p className="text-[12px] text-on-surface/50">关闭应用内自定义右键菜单，交给 WebView / macOS 默认菜单；文件操作仍可通过工具栏、快捷键和预览面板完成。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, useSystemContextMenu: !theme.useSystemContextMenu })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.useSystemContextMenu ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.useSystemContextMenu ? 24 : 0 }} className="w-5 h-5 rounded-full shadow-lg bg-white" />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">空格键预览</h4>
              <p className="text-[12px] text-on-surface/50">按空格键调用 macOS Quick Look 快速预览选中文件。</p>
            </div>
            <span className="text-[11px] font-black text-primary bg-primary/10 px-3 py-1 rounded-full">已启用</span>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface">开发者控制台</h4>
              <p className="text-[12px] text-on-surface/50">开启后在底部状态栏右下角显示「控制台」按钮，点击即可打开 WebView 开发者工具。正式版本中也能使用。</p>
            </div>
            <button
              onClick={() => onThemeChange({ ...theme, enableDevTools: !theme.enableDevTools })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.enableDevTools ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.enableDevTools ? 24 : 0 }} className="w-5 h-5 rounded-full shadow-lg bg-white" />
            </button>
          </div>
        </div>
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <h3 className="text-[18px] font-black text-on-surface">快捷键参考</h3>
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          {[
            ['Cmd+A', '全选'],
            ['Cmd+C', '复制路径'],
            ['Cmd+N', '新建窗口'],
            ['Cmd+W', '关闭标签'],
            ['Delete', '移至废纸篓'],
            ['Enter', '打开文件'],
            ['Space', 'Quick Look'],
            ['Cmd+I', '文件简介'],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center gap-3 px-4 py-3 bg-primary/5 rounded-xl">
              <kbd className="px-2 py-1 bg-primary/10 border border-primary/20 rounded-md text-[11px] font-mono font-bold text-primary whitespace-nowrap">{key}</kbd>
              <span className="text-on-surface/60">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <h3 className="text-[18px] font-black text-on-surface flex items-center gap-3">
          <Terminal className="w-5 h-5 text-primary" /> 终端偏好
        </h3>
        <label className="space-y-2 block">
          <span className="text-[12px] font-black text-on-surface/50 uppercase tracking-wider">默认终端</span>
          <div className="flex gap-2">
            <select
              value={theme.terminalApp || 'Terminal'}
              onChange={(e) => onThemeChange({ ...theme, terminalApp: e.target.value })}
              className="flex-1 bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[14px] text-on-surface font-bold outline-none focus:border-primary"
            >
              {terminalApps.map(app => <option key={app} value={app}>{app}</option>)}
            </select>
            <button
              onClick={() => {
                invoke<string[]>('list_terminal_apps').then(apps => setTerminalApps(apps.length ? apps : ['Terminal', 'iTerm']));
              }}
              className="px-4 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[12px] font-bold text-primary transition-colors"
              title={t('tooltips.refreshTerminalList')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={async () => {
                try {
                  const result = await open({ multiple: false, directory: false, filters: [{ name: '应用', extensions: ['app'] }] });
                  if (result && typeof result === 'string') {
                    const appName = result.split('/').pop()?.replace('.app', '') || result;
                    if (!terminalApps.includes(appName)) {
                      const newApps = [...terminalApps, appName];
                      setTerminalApps(newApps);
                      onThemeChange({ ...theme, terminalApp: appName });
                    } else {
                      onThemeChange({ ...theme, terminalApp: appName });
                    }
                  }
                } catch {}
              }}
              className="px-4 bg-primary/10 hover:bg-primary/20 rounded-2xl text-[12px] font-bold text-primary transition-colors"
              title={t('tooltips.selectTerminalApp')}
            >
              <Upload className="w-4 h-4" />
            </button>
          </div>
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-black text-on-surface/50 uppercase tracking-wider">启动后执行脚本</span>
            <button
              onClick={() => {
                const scripts = [...(theme.terminalScripts || []), ''];
                onThemeChange({ ...theme, terminalScripts: scripts });
              }}
              className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded-xl text-[11px] font-bold text-primary transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> 添加行
            </button>
          </div>
          {(theme.terminalScripts || []).length === 0 ? (
            <p className="text-[12px] text-on-surface/30 py-3">未配置脚本。点击"添加行"开始。</p>
          ) : (
            (theme.terminalScripts || []).map((script, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input
                  value={script}
                  onChange={(e) => {
                    const scripts = [...(theme.terminalScripts || [])];
                    scripts[idx] = e.target.value;
                    onThemeChange({ ...theme, terminalScripts: scripts });
                  }}
                  placeholder={`第 ${idx + 1} 行：例如 npm run dev`}
                  className="flex-1 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 text-[13px] text-on-surface font-mono outline-none focus:border-primary"
                />
                <button
                  onClick={async () => {
                    try {
                      const result = await open({ multiple: false, directory: false, filters: [{ name: '脚本', extensions: ['sh', 'bash', 'zsh', 'command', 'py', 'js', 'ts'] }] });
                      if (result && typeof result === 'string') {
                        const scripts = [...(theme.terminalScripts || [])];
                        scripts[idx] = result;
                        onThemeChange({ ...theme, terminalScripts: scripts });
                      }
                    } catch {}
                  }}
                  className="p-2.5 bg-primary/10 hover:bg-primary/20 rounded-xl text-primary transition-colors shrink-0"
                  title={t('tooltips.selectScriptFile')}
                >
                  <Folder className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    const scripts = (theme.terminalScripts || []).filter((_, i) => i !== idx);
                    onThemeChange({ ...theme, terminalScripts: scripts.length ? scripts : undefined });
                  }}
                  className="p-2.5 hover:bg-red-500/10 rounded-xl text-on-surface/40 hover:text-red-500 transition-colors shrink-0"
                  title={t('tooltips.deleteThisLine')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
          {((theme.terminalScripts || []).length > 0) && (
            <p className="text-[11px] text-on-surface/30">每行按顺序依次执行。可输入命令或选择脚本文件（绝对路径）。</p>
          )}
        </div>

        <label className="space-y-2 block">
          <span className="text-[12px] font-black text-on-surface/50 uppercase tracking-wider">自定义命令（高级，可选）</span>
          <input
            value={theme.customTerminalCommand || ''}
            onChange={(e) => onThemeChange({ ...theme, customTerminalCommand: e.target.value })}
            placeholder={t('placeholders.beforeEnterDir')}
            className="w-full bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] text-on-surface font-mono outline-none focus:border-primary"
          />
        </label>
      </section>
    </div>
  );

  const renderAboutCategory = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <div className="flex items-start justify-between gap-8">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-primary text-on-primary flex items-center justify-center shadow-xl shadow-primary/20">
              <span className="text-[20px] font-black">AE</span>
            </div>
            <div>
              <h3 className="text-[24px] font-black text-on-surface tracking-tight">Aether Explorer</h3>
              <p className="text-[13px] text-on-surface/45 mt-1">macOS 文件管理器 · Tauri v2 / React / Rust</p>
            </div>
          </div>
          <span className="px-4 py-2 rounded-full bg-primary/10 text-primary text-[11px] font-black uppercase tracking-widest">v0.1.0 Alpha</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            ['构建渠道', 'Developer Preview'],
            ['更新策略', 'GitHub Release'],
            ['运行环境', 'macOS Desktop'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-wider">{label}</p>
              <p className="text-[15px] font-black text-on-surface mt-2">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <DownloadCloud className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-[18px] font-black text-on-surface">在线更新</h3>
              <p className="text-[12px] text-on-surface/45 mt-1">检查 GitHub Release 上的新版本。发现更新后需手动确认下载。</p>
            </div>
          </div>
          <button
            onClick={handleCheckUpdates}
            disabled={updateStatus.state === 'checking'}
            className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black flex items-center gap-2 shadow-xl shadow-primary/20 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${updateStatus.state === 'checking' ? 'animate-spin' : ''}`} />
            {updateStatus.state === 'checking' ? '检查中' : '检查更新'}
          </button>
        </div>
        <div className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4 flex items-center gap-3">
          <BadgeCheck className="w-5 h-5 text-primary" />
          <span className="text-[13px] font-bold text-on-surface/70">
            {updateStatus.message}
          </span>
        </div>
        {updateStatus.state === 'available' && (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">当前版本</p>
              <p className="text-[13px] font-black text-on-surface mt-1 truncate">{updateStatus.currentVersion || '未知'}</p>
            </div>
            <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
              <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">最新版本</p>
              <p className="text-[13px] font-black text-on-surface mt-1 truncate">{updateStatus.latestVersion || '未知'}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleDownloadUpdate}
              className="flex-1 py-3 rounded-2xl bg-green-500 text-white text-[13px] font-black flex items-center justify-center gap-2 shadow-lg shadow-green-500/20 hover:bg-green-400 transition-colors"
            >
              <DownloadCloud className="w-4 h-4" /> 下载
            </button>
            <button
              onClick={() => updateStatus.releaseUrl && shellOpen(updateStatus.releaseUrl)}
              className="flex-1 py-3 rounded-2xl bg-primary text-on-primary text-[13px] font-black flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:bg-primary/80 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> 发版主页
            </button>
          </div>
          </>
        )}
      </section>

      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-6">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Trash2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-[18px] font-black text-on-surface">清理缓存</h3>
              <p className="text-[12px] text-on-surface/45 mt-1">清理应用产生的临时文件、缓存数据和拖拽传输记录，释放存储空间。</p>
            </div>
          </div>
          <button
            onClick={handleCleanup}
            disabled={cleanupStatus.cleaning}
            className="px-5 py-3 rounded-2xl bg-primary text-on-primary text-[12px] font-black flex items-center gap-2 shadow-xl shadow-primary/20 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Trash2 className={`w-4 h-4 ${cleanupStatus.cleaning ? 'animate-pulse' : ''}`} />
            {cleanupStatus.cleaning ? '清理中' : '立即清理'}
          </button>
        </div>
        {cleanupStatus.message && (
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4 flex items-center gap-3">
            <BadgeCheck className="w-5 h-5 text-primary" />
            <span className="text-[13px] font-bold text-on-surface/70">
              {cleanupStatus.message}
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
            <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">缓存类型</p>
            <p className="text-[13px] font-black text-on-surface mt-1">拖拽传输 · 临时数据</p>
          </div>
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
            <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">存储位置</p>
            <p className="text-[13px] font-black text-on-surface mt-1">LocalStorage · SessionStorage</p>
          </div>
          <div className="rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
            <p className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">清理策略</p>
            <p className="text-[13px] font-black text-on-surface mt-1">保留设置 · 清理缓存</p>
          </div>
        </div>
      </section>
    </div>
  );

  const renderFilesCategory = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <h3 className="text-[18px] font-black text-on-surface flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-primary" />
          </div>
          {t('settings.filesHeader')}
        </h3>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                {theme.showHiddenFiles ? <Eye className="w-4 h-4 text-primary" /> : <EyeOff className="w-4 h-4 text-on-surface/40" />}
                {t('settings.showHiddenFiles', '显示隐藏项')}
              </h4>
              <p className="text-[12px] text-on-surface/50">在文件浏览器中显示以点(.)开头的文件或系统受限项目。</p>
            </div>
            <button 
              onClick={() => onThemeChange({ ...theme, showHiddenFiles: !theme.showHiddenFiles })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.showHiddenFiles ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.showHiddenFiles ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${theme.showHiddenFiles ? 'bg-on-primary' : 'bg-on-surface/30'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-6 bg-primary/5 rounded-2xl border border-transparent hover:border-primary/20 transition-all group">
            <div className="space-y-1">
              <h4 className="text-[15px] font-bold text-on-surface flex items-center gap-2">
                <Layout className="w-4 h-4 text-primary" />
                {t('settings.showPreviewPanel', '侧边预览面板')}
              </h4>
              <p className="text-[12px] text-on-surface/50">点击文件时自动展开右侧多媒体预览与属性分析面板。</p>
            </div>
            <button 
              onClick={() => onThemeChange({ ...theme, showPreviewPanel: !theme.showPreviewPanel })}
              className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${theme.showPreviewPanel ? 'bg-primary' : 'bg-on-surface/[0.1]'}`}
            >
              <motion.div animate={{ x: theme.showPreviewPanel ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${theme.showPreviewPanel ? 'bg-on-primary' : 'bg-on-surface/30'}`} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );

  const [permChecks, setPermChecks] = useState<{path: string; label: string; ok: boolean | null}[]>([]);

  useEffect(() => {
    let cancelled = false;
    invoke<string>('get_home_dir').then(home => {
      const dirs = [
        { path: `${home}/Documents`, label: '文稿' },
        { path: `${home}/Desktop`, label: '桌面' },
        { path: `${home}/Downloads`, label: '下载' },
        { path: `${home}/.Trash`, label: '废纸篓' },
        { path: '/Applications', label: '应用程序' },
      ];
      Promise.all(dirs.map(async d => {
        try {
          await invoke('list_directory', { dirPath: d.path, showHidden: false });
          return { ...d, ok: true };
        } catch {
          return { ...d, ok: false };
        }
      })).then(results => {
        if (!cancelled) setPermChecks(results);
      });
    }).catch(() => {
      if (!cancelled) setPermChecks([]);
    });
    return () => { cancelled = true; };
  }, []);

  const renderPermissionsCategory = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <div className="flex items-center justify-between p-8 bg-primary/5 rounded-[40px] border-2 border-primary/10">
          <div className="space-y-2">
            <h3 className="text-[18px] font-black text-on-surface flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shadow-xl shadow-primary/10">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              完全磁盘访问权限
            </h3>
            <p className="text-[14px] text-on-surface/50 max-w-md">允许 Aether 读取受保护的系统目录。需要系统级授权。</p>
          </div>
          <button
            onClick={() => invoke('open_system_settings').catch(() => {})}
            className="px-6 py-3 bg-primary text-on-primary font-black rounded-2xl text-[13px] whitespace-nowrap shrink-0 shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all uppercase tracking-widest"
          >
            打开系统设置
          </button>
        </div>

        {/* Permission check results */}
        <div className="space-y-3">
          <h4 className="text-[13px] font-bold text-on-surface/40 uppercase tracking-wider px-2">目录访问状态</h4>
          {permChecks.length === 0 ? (
            <p className="text-[13px] text-on-surface/30 px-2">正在检查权限...</p>
          ) : (
            permChecks.map(p => (
              <div key={p.path} className="flex items-center justify-between px-6 py-4 bg-primary/5 rounded-2xl border border-transparent">
                <div className="space-y-1">
                  <span className="text-[14px] font-bold text-on-surface">{p.label}</span>
                  <p className="text-[11px] text-on-surface/30 font-mono">{p.path}</p>
                </div>
                {p.ok ? (
                  <span className="text-[11px] font-black text-green-400 bg-green-400/10 px-4 py-1 rounded-full">可访问</span>
                ) : p.ok === false ? (
                  <span className="text-[11px] font-black text-red-400 bg-red-400/10 px-4 py-1 rounded-full">无权限</span>
                ) : (
                  <span className="text-[11px] font-black text-on-surface/20 bg-on-surface/5 px-4 py-1 rounded-full">检查中</span>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );

  const renderExtensionsCategory = () => {
    const extensions = theme.contextMenuExtensions || [];
    const currentActionMeta = ACTION_TYPE_META[newActionType];
    const CurrentActionIcon = currentActionMeta.icon;

    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-10">
          <header className="flex items-start justify-between gap-6">
            <div className="space-y-2">
              <h3 className="text-[20px] font-black text-on-surface flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Puzzle className="w-6 h-6 text-primary" />
                </div>
                {t('settings.contextMenuExt', '右键菜单扩展')}
              </h3>
              <p className="text-[13px] text-on-surface/55 font-bold max-w-2xl leading-relaxed">基础文件操作固定展示；这里仅配置额外动作，例如用指定终端打开目录、带参数执行脚本、跳转到外部 URL 或保留插件入口。</p>
            </div>
            <div className="bg-primary/10 px-4 py-2 rounded-2xl flex items-center gap-2 shrink-0">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-[11px] font-black text-primary uppercase tracking-widest">{extensions.filter(ext => ext.enabled).length} Enabled</span>
            </div>
          </header>

          <div className="flex flex-wrap gap-3">
            <button onClick={handleImportExtensions} className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-2 hover:bg-primary/20 transition-colors">
              <FileUp className="w-4 h-4" /> 导入 JSON
            </button>
            <button onClick={handleExportExtensions} className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-2 hover:bg-primary/20 transition-colors">
              <FileDown className="w-4 h-4" /> 导出 JSON
            </button>
            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(extensions, null, 2)).catch(() => {})} className="px-4 py-2 rounded-2xl bg-primary/10 text-primary text-[11px] font-black flex items-center gap-2 hover:bg-primary/20 transition-colors">
              <Copy className="w-4 h-4" /> 复制配置
            </button>
            <button onClick={resetActionForm} className="px-4 py-2 rounded-2xl bg-primary/5 text-on-surface text-[11px] font-black flex items-center gap-2 hover:bg-primary/10 transition-colors">
              取消编辑
            </button>
          </div>

          <div className="rounded-[28px] bg-surface/40 border border-primary/10 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <Settings2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-[15px] font-black text-on-surface">基础菜单固定项</h4>
                <p className="text-[12px] text-on-surface/45 mt-1">这些是文件管理器必备能力，不作为扩展开关管理。</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {CORE_CONTEXT_ACTIONS.map(action => (
                <span key={action} className="px-3 py-2 rounded-xl bg-primary/5 border border-primary/10 text-[12px] font-black text-on-surface/65">{action}</span>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-[15px] font-black text-on-surface">自定义扩展动作</h4>
              <span className="text-[11px] font-black text-on-surface/35 uppercase tracking-widest">Template variables: {'{path}'} {'{dir}'} {'{name}'} {'{currentPath}'}</span>
            </div>
            {extensions.length === 0 ? (
              <div className="rounded-[24px] bg-primary/5 border border-dashed border-primary/20 px-8 py-10 text-center">
                <p className="text-[13px] font-bold text-on-surface/45">暂无自定义扩展动作。</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {extensions.map((ext) => {
                  const actionType = ext.actionType || 'placeholder';
                  const meta = ACTION_TYPE_META[actionType];
                  const Icon = meta.icon;
                  const detail = actionType === 'terminal'
                    ? `${ext.terminalApp || theme.terminalApp || 'Terminal'} · ${ext.workingDirectory === 'current' ? '当前目录' : '选中项目'} · ${ext.terminalArgs || '仅打开目录'}`
                    : actionType === 'shell'
                      ? `${ext.terminalApp || theme.terminalApp || 'Terminal'} · ${ext.command || '未配置命令'}`
                      : actionType === 'url'
                        ? ext.urlTemplate || '未配置 URL 模板'
                        : meta.description;
                  return (
                    <div
                      key={ext.id}
                      className={`flex items-center justify-between gap-6 px-6 py-5 rounded-[24px] border transition-all duration-300 group ${ext.enabled ? 'bg-primary/10 border-primary/20' : 'bg-primary/5 border-transparent opacity-65'}`}
                    >
                      <div className="flex items-center gap-5 min-w-0">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-sm shrink-0 ${ext.enabled ? 'bg-primary text-on-primary' : 'bg-primary/20 text-on-surface'}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[15px] font-black text-on-surface truncate">{ext.label}</span>
                            <span className="text-[9px] font-black bg-on-surface/10 text-on-surface/60 px-2 py-0.5 rounded-full uppercase tracking-widest shrink-0">{meta.label}</span>
                          </div>
                          <p className="text-[11px] text-on-surface/50 font-bold truncate">{detail}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <button
                          onClick={() => populateActionForm(ext)}
                          className="p-3 text-on-surface/25 hover:text-primary hover:bg-primary/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                          aria-label={`编辑 ${ext.label}`}
                        >
                          <Pencil className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleDeleteExtension(ext.id, ext.label)}
                          className="p-3 text-on-surface/25 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                          aria-label={`删除 ${ext.label}`}
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => toggleExtension(ext.id)}
                          className={`w-14 h-8 rounded-full p-1.5 transition-colors duration-300 flex items-center ${ext.enabled ? 'bg-primary' : 'bg-on-surface/[0.2]'}`}
                          aria-label={`${ext.enabled ? '停用' : '启用'} ${ext.label}`}
                        >
                          <motion.div animate={{ x: ext.enabled ? 24 : 0 }} className={`w-5 h-5 rounded-full shadow-lg ${ext.enabled ? 'bg-on-primary' : 'bg-on-surface/40'}`} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="p-8 bg-primary/5 rounded-[32px] border-2 border-dashed border-primary/20 space-y-7">
            <div className="flex items-start gap-5">
              <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center text-primary shrink-0">
                <Plus className="w-7 h-7" />
              </div>
              <div>
                <h4 className="text-[16px] font-black text-on-surface">添加自定义功能</h4>
                <p className="text-[12px] text-on-surface/45 mt-1 leading-relaxed">选择动作类型后配置参数。终端动作会把选中的文件夹作为工作目录；选中文件时会自动使用其所在目录。</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <label className="space-y-2">
                <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">菜单名称</span>
                <input
                  type="text"
                  value={newActionLabel}
                  onChange={(e) => setNewActionLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addExtension()}
                  placeholder={t('placeholders.terminalScriptExample1')}
                  className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">动作类型</span>
                <select
                  value={newActionType}
                  onChange={(e) => setNewActionType(e.target.value as NonNullable<ContextMenuAction['actionType']>)}
                  className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                >
                  {Object.entries(ACTION_TYPE_META).map(([type, meta]) => <option key={type} value={type}>{meta.label}</option>)}
                </select>
              </label>
            </div>

            <div className="rounded-[24px] bg-surface/40 border border-primary/10 p-5 space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <CurrentActionIcon className="w-5 h-5" />
                </div>
                <div>
                  <h5 className="text-[13px] font-black text-on-surface">{currentActionMeta.label}</h5>
                  <p className="text-[12px] text-on-surface/45 mt-1 leading-relaxed">{currentActionMeta.description}</p>
                </div>
              </div>

              {(newActionType === 'terminal' || newActionType === 'shell') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <label className="space-y-2">
                    <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">终端应用</span>
                    <select
                      value={newTerminalApp}
                      onChange={(e) => setNewTerminalApp(e.target.value)}
                      className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                    >
                      {terminalApps.map(app => <option key={app} value={app}>{app}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">工作目录</span>
                    <select
                      value={newWorkingDirectory}
                      onChange={(e) => setNewWorkingDirectory(e.target.value as 'selection' | 'current')}
                      className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-bold text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                    >
                      <option value="selection">选中项目目录</option>
                      <option value="current">当前文件列表目录</option>
                    </select>
                  </label>
                </div>
              )}

              {newActionType === 'terminal' && (
                <label className="space-y-2 block">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">启动参数 / 启动后执行</span>
                  <input
                    value={newTerminalArgs}
                    onChange={(e) => setNewTerminalArgs(e.target.value)}
                    placeholder={t('placeholders.terminalScriptExample2')}
                    className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                </label>
              )}

              {newActionType === 'shell' && (
                <label className="space-y-2 block">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">命令模板</span>
                  <input
                    value={newCommand}
                    onChange={(e) => setNewCommand(e.target.value)}
                    placeholder={t('placeholders.terminalScriptExample3')}
                    className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                </label>
              )}

              {newActionType === 'url' && (
                <label className="space-y-2 block">
                  <span className="text-[11px] font-black text-on-surface/45 uppercase tracking-wider">URL 模板</span>
                  <input
                    value={newUrlTemplate}
                    onChange={(e) => setNewUrlTemplate(e.target.value)}
                    placeholder={t('placeholders.searchUrlExample')}
                    className="w-full bg-white/5 border border-primary/20 rounded-2xl px-5 py-4 text-[13px] font-mono text-on-surface outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                </label>
              )}

              <div className="rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4">
                <p className="text-[11px] font-bold text-on-surface/45 leading-relaxed">可用变量：<span className="font-mono text-primary">{'{path}'}</span> 选中路径，<span className="font-mono text-primary">{'{dir}'}</span> 选中目录，<span className="font-mono text-primary">{'{name}'}</span> 文件名，<span className="font-mono text-primary">{'{currentPath}'}</span> 当前列表目录。</p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={addExtension}
                disabled={!isNewActionValid()}
                className="px-8 py-4 bg-primary text-on-primary font-black rounded-2xl shadow-xl shadow-primary/20 disabled:opacity-50 disabled:shadow-none transition-all uppercase tracking-widest text-[12px]"
              >
                {editingExtensionId ? '保存修改' : '添加动作'}
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className="h-full flex overflow-hidden bg-primary/[0.01]">
      {/* Category Sidebar */}
      <aside className="w-48 border-r border-primary/5 flex flex-col pt-16 pb-8 px-4 space-y-6 shrink-0 bg-primary/[0.02]">
        <div className="px-4 mb-2">
            <h2 className="text-[11px] font-black text-primary uppercase tracking-[0.3em] mb-8 opacity-60">System Preferences</h2>
            <nav className="space-y-3">
              {categories.map((cat) => {
                const isActive = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id as SettingsCategory)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-[18px] transition-all duration-300 relative group whitespace-nowrap
                      ${isActive ? 'text-on-surface font-black shadow-lg shadow-primary/5' : 'text-on-surface/40 font-bold hover:bg-primary/5 hover:text-primary'}
                    `}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="active-cat-bg"
                        className="absolute inset-0 bg-primary/10 border border-primary/20 rounded-[22px] z-0"
                      />
                    )}
                    <cat.icon className={`w-5 h-5 relative z-10 transition-colors ${isActive ? 'text-primary' : 'group-hover:text-primary/70'}`} />
                    <span className="text-[14px] relative z-10 tracking-tight">{cat.label}</span>
                    {isActive && <ChevronRight className="w-4 h-4 ml-auto relative z-10 text-primary" />}
                  </button>
                );
              })}
            </nav>
        </div>
        
        <div className="mt-auto px-6 py-8 bg-primary/5 rounded-[32px] border border-primary/10 space-y-4">
           <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center font-black text-[10px]">OS</div>
              <div className="space-y-0.5">
                <p className="text-[11px] font-black text-on-surface tracking-tight">Aether Explorer</p>
                <p className="text-[9px] font-bold text-on-surface/30">Build v2.4.0-Alpha</p>
              </div>
           </div>
           <p className="text-[10px] text-on-surface/40 leading-relaxed font-medium">设置保存在本地应用数据目录中（JSON 格式），重启后自动恢复。</p>
        </div>
      </aside>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
        <div className="max-w-4xl mx-auto">
          <header className="mb-20 space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-primary/10 rounded-full border border-primary/20">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-[9px] font-black text-primary uppercase tracking-[0.2em]">{categories.find(c => c.id === activeCategory)?.id} Configuration</span>
            </div>
            <h1 className="text-[48px] font-black text-on-surface tracking-tighter leading-[0.9] flex items-center gap-4">
              {categories.find(c => c.id === activeCategory)?.label}
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-2 h-2 rounded-full bg-primary mt-4" />
            </h1>
            <p className="text-on-surface/40 text-[18px] max-w-xl font-medium antialiased">
              {{appearance:'自定义工作区色彩主题、毛玻璃质感、壁纸背景、字体与布局参数。',
                files:'配置文件浏览行为：隐藏文件显示、预览面板开关、列表密度等。',
                permissions:'检查并管理系统级文件访问权限，确保 Aether 能读取受保护目录。',
                extensions:'管理右键菜单中的自定义动作，基础文件操作始终固定展示。',
                features:'配置窗口行为、快捷键参考与交互方式。',
                about:'查看版本信息、发布渠道与在线更新状态。',
              }[activeCategory] || '从视觉主题到系统内核权限，在此处个性化您的文件管家。'}
            </p>
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease: "circOut" }}
            >
              {activeCategory === 'appearance' && renderAppearanceCategory()}
              {activeCategory === 'files' && renderFilesCategory()}
              {activeCategory === 'permissions' && renderPermissionsCategory()}
              {activeCategory === 'extensions' && renderExtensionsCategory()}
              {activeCategory === 'features' && renderFeaturesCategory()}
              {activeCategory === 'about' && renderAboutCategory()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
