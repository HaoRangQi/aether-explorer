import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sun, Moon, Zap, Sliders, Check, Image as ImageIcon, Languages, Upload, Type, Eye, Monitor, Palette, Layout, Sparkles, Wand2, ChevronRight, ChevronDown, Grid2X2, Columns, List, Folder, File as FileIcon, Search, RotateCw, Save, Trash2 } from 'lucide-react';
import type { ThemeColorToken, ThemeSettings } from '../../types';
import { ACCENT_COLORS } from '../../constants';
import {
  applyCustomColorPalettePreset,
  buildCustomColorPalettePreset,
  DEFAULT_DARK_ACCENT,
  DEFAULT_FONT_FAMILY,
  DEFAULT_LIGHT_ACCENT,
} from '../../lib/settings';

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

const COLOR_DETAIL_CONTROLS: { key: ThemeColorToken; label: string }[] = [
  { key: 'colorIcon', label: '图标' },
  { key: 'colorSelectedFg', label: '选中前景' },
  { key: 'colorSelectedBg', label: '选中背景' },
  { key: 'colorHoverFg', label: '悬浮前景' },
  { key: 'colorHoverBg', label: '悬浮背景' },
  { key: 'colorPanelBg', label: '面板底色' },
  { key: 'colorTextPrimary', label: '主文字' },
  { key: 'colorTextSecondary', label: '次文字' },
  { key: 'colorBorder', label: '边框' },
  { key: 'colorDivider', label: '分隔线' },
  { key: 'colorShadow', label: '阴影' },
  { key: 'colorActiveIconBg', label: '激活图标' },
  { key: 'colorTagSelected', label: '标签选中' },
  { key: 'colorSearchBg', label: '搜索框' },
  { key: 'colorAppBg', label: '主背景色' },
];

export default function AppearanceSettings(props: any) {
  const { t, theme, onThemeChange, handleLiquidGlassToggle, isTogglingLiquidGlass, liquidGlassMessage, liquidGlassStatus, resolveCurrentAppearance, handleFileUpload, wallpaperUrlDraft, setWallpaperUrlDraft, handleWallpaperUrlChange, wallpaperUrlError, setWallpaperUrlError, showMediaGridControls, setShowMediaGridControls, availableFonts, setShowLanguageManager, applyLanguage, selectedLanguage, toggleFollowSystemLanguage, systemLanguage, showLanguageManager, visibleLanguages } = props;
  const [customPaletteName, setCustomPaletteName] = useState('');
  const customColorPalettes = theme.customColorPalettes || [];
  const customPalettePreviewColors = useMemo(() => (
    Array.from(new Set([
      theme.accentColor,
      ...COLOR_DETAIL_CONTROLS
        .map(({ key }) => theme[key])
        .filter((color): color is string => typeof color === 'string' && color.trim().startsWith('#')),
    ])).slice(0, 6)
  ), [theme]);
  const canSaveCustomPalette = customPaletteName.trim().length > 0;
  const handleSaveCustomPalette = () => {
    if (!canSaveCustomPalette) return;
    const preset = buildCustomColorPalettePreset({
      name: customPaletteName,
      theme,
    });
    const nextPalettes = [
      preset,
      ...customColorPalettes.filter(existing => existing.name !== preset.name),
    ].slice(0, 24);
    onThemeChange({ ...theme, customColorPalettes: nextPalettes });
    setCustomPaletteName('');
  };
  const handleResetDetailedColors = () => {
    const nextTheme = { ...theme };
    for (const { key } of COLOR_DETAIL_CONTROLS) {
      nextTheme[key] = undefined;
    }
    onThemeChange(nextTheme);
  };

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <section className="bg-primary/5 rounded-[32px] p-8 border border-primary/10 space-y-6">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 space-y-2">
            <h3 className="text-[20px] font-black text-on-surface flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              {t('settings.liquidGlassTheme', '液态玻璃主题')}
            </h3>
            <p className="text-[13px] text-on-surface/45 leading-relaxed max-w-2xl">
              {t('settings.liquidGlassThemeDesc', '开启后调用 macOS 原生 Liquid Glass；浅色、深色、自动仍会决定玻璃明暗。')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLiquidGlassToggle}
            disabled={isTogglingLiquidGlass}
            className={`relative w-14 h-8 rounded-full transition-colors duration-200 shrink-0 ${theme.enableLiquidGlass ? 'bg-primary' : 'bg-on-surface/20'} ${isTogglingLiquidGlass ? 'opacity-60 cursor-wait' : ''}`}
            aria-pressed={theme.enableLiquidGlass === true}
          >
            <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ${theme.enableLiquidGlass ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>
        {(theme.enableLiquidGlass || liquidGlassMessage) && (
          <div className={`rounded-2xl border px-5 py-4 text-[12px] font-bold leading-relaxed ${
            liquidGlassStatus && !liquidGlassStatus.applied && liquidGlassStatus.requested
              ? 'border-red-500/20 bg-red-500/10 text-red-700'
              : 'border-primary/15 bg-primary/5 text-on-surface/55'
          }`}>
            {liquidGlassMessage || t('settings.liquidGlassThemeActiveHint', '原生 Liquid Glass 已接管窗口材质；浅色、深色、自动会切换玻璃明暗。应用内壁纸与渐变背景会暂停渲染。')}
          </div>
        )}
      </section>

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
                  type="button"
                  onClick={() => {
                    const nextMode = mode.id as ThemeSettings['mode'];
                    const nextAppearance = resolveCurrentAppearance(nextMode);
                    onThemeChange({
                      ...theme,
                      mode: nextMode,
                      accentColor: nextAppearance === 'dark' ? DEFAULT_DARK_ACCENT : DEFAULT_LIGHT_ACCENT,
                    });
                  }}
                  className={`flex-1 py-4 rounded-xl flex items-center justify-center gap-2 text-[13px] font-bold transition-all relative
                    ${theme.enableLiquidGlass
                      ? isActive ? 'text-on-surface' : 'text-on-surface/45 hover:text-on-surface hover:bg-white/10'
                      : isActive ? 'text-on-primary' : 'text-on-surface/40 hover:text-on-surface/80 hover:bg-primary/10'}
                  `}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-mode-pill"
                      className={`absolute inset-0 rounded-xl z-0 shadow-lg ${
                        theme.enableLiquidGlass
                          ? 'bg-white/20 border border-white/20 shadow-black/10'
                          : 'bg-primary shadow-primary/20'
                      }`}
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

        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <label className="text-[11px] font-black text-on-surface/35 uppercase tracking-[0.18em]">
                {t('settings.customPalettes', '用户自定义')}
              </label>
              <p className="mt-2 text-[12px] font-medium text-on-surface/40">
                {t('settings.customPalettesDesc', '把当前强调色和颜色细化控制保存成可复用配置。')}
              </p>
            </div>
            <div className="flex min-w-[min(100%,28rem)] flex-1 items-center gap-2 rounded-2xl border border-primary/10 bg-primary/5 p-2">
              <input
                type="text"
                value={customPaletteName}
                onChange={(e) => setCustomPaletteName(e.target.value)}
                placeholder={t('settings.customPaletteNamePlaceholder', '自定义配置名称')}
                aria-label={t('settings.customPaletteNamePlaceholder', '自定义配置名称')}
                maxLength={48}
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[12px] font-bold text-on-surface outline-none placeholder:text-on-surface/30"
              />
              <div className="hidden shrink-0 sm:flex">
                {customPalettePreviewColors.map((color, index) => (
                  <span
                    key={`${color}-${index}`}
                    className="-ml-1.5 first:ml-0 h-6 w-6 rounded-full border-2 border-primary/5 shadow-sm"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={handleSaveCustomPalette}
                disabled={!canSaveCustomPalette}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[11px] font-black text-on-primary transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
              >
                <Save className="h-3.5 w-3.5" />
                {t('common.save', '保存')}
              </button>
            </div>
          </div>

          {customColorPalettes.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {customColorPalettes.map(preset => {
                const colors = Array.from(new Set([
                  preset.accentColor,
                  ...Object.values(preset.colors || {}),
                ])).slice(0, 5);
                return (
                  <div
                    key={preset.id}
                    className="group/custom flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-transparent bg-primary/5 p-2 transition-all hover:border-primary/20 hover:bg-primary/10"
                  >
                    <button
                      type="button"
                      onClick={() => onThemeChange(applyCustomColorPalettePreset(theme, preset))}
                      className="min-w-0 flex-1 rounded-xl p-1 text-left"
                    >
                      <div className="min-w-0 space-y-2">
                        <div className="flex">
                          {colors.map((color, index) => (
                            <span
                              key={`${preset.id}-${color}-${index}`}
                              className="-ml-1.5 first:ml-0 h-7 w-7 rounded-full border-2 border-on-surface/10 shadow-sm"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-black text-on-surface/70 group-hover/custom:text-primary">
                            {preset.name}
                          </span>
                          <span className="shrink-0 text-[10px] font-mono uppercase text-on-surface/30">
                            {preset.accentColor}
                          </span>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onThemeChange({
                        ...theme,
                        customColorPalettes: customColorPalettes.filter(item => item.id !== preset.id),
                      })}
                      className="rounded-xl p-2 text-on-surface/30 transition-colors hover:bg-red-500/10 hover:text-red-500"
                      aria-label={t('settings.deleteCustomPalette', '删除自定义配色')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 颜色细化控制 */}
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-8">
        <header className="text-left">
          <h3 className="text-[22px] font-black text-on-surface tracking-tight mb-2 flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            颜色细化控制
          </h3>
          <p className="text-[13px] text-on-surface/40 leading-relaxed max-w-2xl">
            点击色块修改颜色，右键重置为默认。
          </p>
        </header>

        <div className="grid grid-cols-4 sm:grid-cols-7 gap-6">
          {COLOR_DETAIL_CONTROLS.map(({ key, label }) => (
            <div key={key} className="flex flex-col items-center gap-2">
              <label className="relative group">
                <input
                  type="color"
                  value={(theme[key] as string) || theme.accentColor}
                  onChange={(e) => onThemeChange({ ...theme, [key]: e.target.value })}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className={`w-10 h-10 rounded-full border-2 transition-all group-hover:scale-110 group-hover:shadow-lg ${theme[key] ? 'border-on-surface/20 shadow-md' : 'border-dashed border-on-surface/20'}`}
                  style={{ backgroundColor: (theme[key] as string) || undefined }}
                />
                {!theme[key] && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-5 h-5 rounded-full bg-primary/30" />
                  </div>
                )}
              </label>
              <span className="text-[10px] font-bold text-on-surface/50 text-center leading-tight">{label}</span>
              {theme[key] && (
                <button
                  onClick={() => onThemeChange({ ...theme, [key]: undefined })}
                  className="text-[9px] text-on-surface/30 hover:text-primary transition-colors"
                >
                  重置
                </button>
              )}
            </div>
          ))}
        </div>

        {/* 全部重置按钮 */}
        <div className="pt-6 border-t border-primary/10">
          <button
            onClick={handleResetDetailedColors}
            className="px-6 py-3 rounded-2xl bg-primary/10 text-primary text-[13px] font-bold hover:bg-primary/20 transition-colors flex items-center gap-2"
          >
            <RotateCw className="w-4 h-4" />
            全部重置为默认配色
          </button>
        </div>

        {/* 实时预览 */}
        <div className="pt-6 border-t border-primary/10 space-y-4">
          <h4 className="text-[13px] font-black text-on-surface/40 uppercase tracking-widest flex items-center gap-2">
            <Eye className="w-3.5 h-3.5" /> 实时预览
          </h4>
          <div className="rounded-2xl border-2 border-custom overflow-hidden bg-panel-custom">
            {/* 模拟侧边栏 + 文件区 */}
            <div className="flex min-h-[220px]">
              {/* 侧边栏 */}
              <div className="w-40 shrink-0 border-r border-custom p-3 space-y-1">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-selected">
                  <div className="w-5 h-5 rounded-full bg-active-icon flex items-center justify-center">
                    <Folder className="w-3 h-3 text-on-primary" />
                  </div>
                  <span className="text-[11px] font-bold text-selected">下载</span>
                </div>
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-hover-custom transition-colors">
                  <div className="w-5 h-5 rounded-full bg-panel-custom flex items-center justify-center">
                    <FileIcon className="w-3 h-3 text-icon" />
                  </div>
                  <span className="text-[11px] text-primary-custom">文稿</span>
                </div>
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-hover-custom transition-colors">
                  <div className="w-5 h-5 rounded-full bg-panel-custom flex items-center justify-center">
                    <ImageIcon className="w-3 h-3 text-icon" />
                  </div>
                  <span className="text-[11px] text-primary-custom">图片</span>
                </div>
                <div className="my-2 h-px bg-divider" />
                <div className="px-2 text-[9px] font-bold text-secondary-custom uppercase tracking-wider">标签</div>
                <div className="flex items-center gap-2 px-2 py-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-tag-selected" />
                  <span className="text-[10px] text-secondary-custom">重要</span>
                </div>
              </div>
              {/* 文件区 */}
              <div className="flex-1 p-3 space-y-1.5">
                {/* 搜索框 */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-search-custom border border-custom mb-3">
                  <Search className="w-3 h-3 text-icon" />
                  <span className="text-[11px] text-secondary-custom">搜索文件...</span>
                </div>
                {/* 文件项 - 选中 */}
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-selected border border-custom shadow-custom">
                  <Folder className="w-4 h-4 text-icon" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-selected truncate">Design Assets</p>
                    <p className="text-[9px] text-secondary-custom">12 项 · 昨天</p>
                  </div>
                </div>
                {/* 文件项 - 普通 */}
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-panel-custom border border-transparent hover:bg-hover-custom hover:border-custom transition-all">
                  <FileIcon className="w-4 h-4 text-icon" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-primary-custom truncate">报告_2024.pdf</p>
                    <p className="text-[9px] text-secondary-custom">2.1 M · 周一</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-panel-custom border border-transparent hover:bg-hover-custom hover:border-custom transition-all">
                  <ImageIcon className="w-4 h-4 text-icon" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-primary-custom truncate">封面_final.png</p>
                    <p className="text-[9px] text-secondary-custom">4.5 M · 今天</p>
                  </div>
                </div>
                {/* 底部状态栏 */}
                <div className="flex items-center gap-3 mt-3 pt-2 border-t border-custom">
                  <span className="text-[9px] text-icon font-bold">3</span>
                  <span className="text-[9px] text-secondary-custom">个项目</span>
                  <div className="w-px h-2 bg-divider" />
                  <span className="text-[9px] text-icon font-bold">1</span>
                  <span className="text-[9px] text-secondary-custom">项已选中</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Wallpaper & Blur */}
      <section className="bg-primary/5 rounded-[32px] p-10 border border-primary/10 space-y-10">
        <h3 className="text-[17px] font-bold text-on-surface flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary" /> {t('settings.wallpaperHeader', '动态壁纸与视差')}
        </h3>

        {/* 色彩渐变背景开关 */}
        <div className="flex items-center justify-between py-3 border-b border-primary/10">
          <div className="space-y-1">
            <p className="text-[13px] font-bold text-on-surface">{t('settings.enableGradient', '色彩渐变背景')}</p>
            <p className="text-[11px] text-on-surface/40">{t('settings.enableGradientDesc', '关闭后使用纯色背景（浅色 #FCFCFD / 深色 #1E1E2E）')}</p>
          </div>
          <button
            onClick={() => onThemeChange({ ...theme, enableGradient: !theme.enableGradient })}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${theme.enableGradient ? 'bg-primary' : 'bg-on-surface/20'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${theme.enableGradient ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
          <div className="space-y-8">
            <div className="space-y-6">
              <label className="text-[11px] font-black text-on-surface/30 uppercase tracking-[0.2em]">{t('settings.customWallpaper', '链接导入')}</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={wallpaperUrlDraft}
                  onChange={(e) => handleWallpaperUrlChange(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className={`flex-1 bg-primary/5 border rounded-2xl px-5 py-4 text-[13px] outline-none focus:ring-4 focus:ring-primary/10 transition-all font-medium ${
                    wallpaperUrlError ? 'border-red-400/70 focus:border-red-400' : 'border-primary/20 focus:border-primary'
                  }`}
                />
                <button
                  onClick={() => {
                    setWallpaperUrlError('');
                    setWallpaperUrlDraft('');
                    onThemeChange({ ...theme, wallpaperUrl: undefined });
                  }}
                  className="px-5 bg-primary/10 rounded-2xl text-[13px] font-bold hover:bg-primary/20 transition-all"
                >
                  {t('common.reset')}
                </button>
              </div>
              {wallpaperUrlError && (
                <p className="text-[11px] text-red-400 font-bold">{wallpaperUrlError}</p>
              )}
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
                  <input type="range" min="100" max="400" value={theme.gridWidth || 180} onChange={(e) => {
                    const gridWidth = parseInt(e.target.value);
                    onThemeChange({ ...theme, gridWidth, mediaGridWidth: theme.mediaGridLinked === false ? theme.mediaGridWidth : gridWidth });
                  }} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[12px] font-bold text-on-surface/60">{t('settings.gridHeight', '项目高度')}</label>
                    <span className="text-[13px] font-black text-primary">{theme.gridHeight || 180}px</span>
                  </div>
                  <input type="range" min="100" max="400" value={theme.gridHeight || 180} onChange={(e) => {
                    const gridHeight = parseInt(e.target.value);
                    onThemeChange({ ...theme, gridHeight, mediaGridHeight: theme.mediaGridLinked === false ? theme.mediaGridHeight : gridHeight });
                  }} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                </div>

                <div className="space-y-4 sm:col-span-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[12px] font-bold text-on-surface/60">{t('settings.gridGap', '网格间距')}</label>
                    <span className="text-[13px] font-black text-primary">{theme.gridGap || 16}px</span>
                  </div>
                  <input type="range" min="4" max="64" step="4" value={theme.gridGap || 16} onChange={(e) => onThemeChange({ ...theme, gridGap: parseInt(e.target.value) })} className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary" />
                </div>

                <div className="space-y-4 sm:col-span-2 rounded-2xl border border-primary/10 bg-primary/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-black text-on-surface">{t('settings.mediaGridItems', '多媒体项目')}</p>
                      <p className="text-[11px] text-on-surface/50 mt-1">
                        {theme.mediaGridLinked === false ? t('settings.mediaGridCustomDesc', '使用独立宽高') : t('settings.mediaGridLinkedDesc', '默认跟随普通网格大小')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const shouldLink = theme.mediaGridLinked === false;
                          onThemeChange({
                            ...theme,
                            mediaGridLinked: shouldLink,
                            mediaGridWidth: shouldLink ? (theme.gridWidth || 180) : (theme.mediaGridWidth || theme.gridWidth || 180),
                            mediaGridHeight: shouldLink ? (theme.gridHeight || 180) : (theme.mediaGridHeight || theme.gridHeight || 180),
                          });
                        }}
                        className={`px-3 py-1.5 rounded-xl text-[11px] font-black border transition-colors ${theme.mediaGridLinked === false ? 'bg-transparent border-primary/15 text-on-surface/50' : 'bg-primary text-on-primary border-primary'}`}
                      >
                        {t('settings.mediaGridSync', '同步调整')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMediaGridControls(prev => !prev)}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-black text-primary bg-primary/10 hover:bg-primary/15 transition-colors inline-flex items-center gap-1.5"
                      >
                        {t('settings.more', '更多')} {showMediaGridControls ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {showMediaGridControls && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-5">
                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <label className="text-[12px] font-bold text-on-surface/60">{t('settings.mediaGridWidth', '多媒体项目宽度')}</label>
                              <span className="text-[13px] font-black text-primary">{theme.mediaGridLinked === false ? (theme.mediaGridWidth || theme.gridWidth || 180) : (theme.gridWidth || 180)}px</span>
                            </div>
                            <input
                              type="range"
                              min="100"
                              max="800"
                              value={theme.mediaGridLinked === false ? (theme.mediaGridWidth || theme.gridWidth || 180) : (theme.gridWidth || 180)}
                              onChange={(e) => onThemeChange({ ...theme, mediaGridLinked: false, mediaGridWidth: parseInt(e.target.value) })}
                              className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary"
                            />
                          </div>

                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <label className="text-[12px] font-bold text-on-surface/60">{t('settings.mediaGridHeight', '多媒体项目高度')}</label>
                              <span className="text-[13px] font-black text-primary">{theme.mediaGridLinked === false ? (theme.mediaGridHeight || theme.gridHeight || 180) : (theme.gridHeight || 180)}px</span>
                            </div>
                            <input
                              type="range"
                              min="100"
                              max="800"
                              value={theme.mediaGridLinked === false ? (theme.mediaGridHeight || theme.gridHeight || 180) : (theme.gridHeight || 180)}
                              onChange={(e) => onThemeChange({ ...theme, mediaGridLinked: false, mediaGridHeight: parseInt(e.target.value) })}
                              className="w-full appearance-none h-1.5 bg-primary/10 rounded-full accent-primary"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
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
              value={theme.fontFamily || DEFAULT_FONT_FAMILY}
              onChange={(e) => onThemeChange({ ...theme, fontFamily: e.target.value })}
              className="w-full bg-primary/5 border-2 border-primary/10 rounded-2xl px-5 py-4 text-[14px] text-on-surface font-bold appearance-none outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all"
            >
              {availableFonts.map(font => (
                <option
                  key={font}
                  value={font === 'System Default' ? DEFAULT_FONT_FAMILY : font}
                  style={{ fontFamily: font === 'System Default' ? DEFAULT_FONT_FAMILY : font }}
                >
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
}
