import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import type { SettingsCategory } from './settings-view-types';

export interface SettingsCategoryNavItem {
  id: SettingsCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface SettingsShellProps {
  activeCategory: SettingsCategory;
  categories: SettingsCategoryNavItem[];
  categoryDescription: string;
  configurationBadge: string;
  sidebarTitle: string;
  onCategoryChange: (category: SettingsCategory) => void;
  children: React.ReactNode;
}

export default function SettingsShell({
  activeCategory,
  categories,
  categoryDescription,
  configurationBadge,
  sidebarTitle,
  onCategoryChange,
  children,
}: SettingsShellProps) {
  const activeLabel = categories.find(category => category.id === activeCategory)?.label;

  return (
    <div className="h-full flex overflow-hidden bg-primary/[0.01]">
      <aside className="w-48 border-r border-primary/5 flex flex-col pt-16 pb-8 px-4 space-y-6 shrink-0 bg-primary/[0.02]">
        <div className="px-4 mb-2">
          <h2 className="text-[11px] font-black text-primary uppercase tracking-[0.3em] mb-8 opacity-60">{sidebarTitle}</h2>
          <nav className="space-y-3">
            {categories.map((category) => {
              const isActive = activeCategory === category.id;
              return (
                <button
                  key={category.id}
                  onClick={() => onCategoryChange(category.id)}
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
                  <category.icon className={`w-5 h-5 relative z-10 transition-colors ${isActive ? 'text-primary' : 'group-hover:text-primary/70'}`} />
                  <span className="text-[14px] relative z-10 tracking-tight">{category.label}</span>
                  {isActive && <ChevronRight className="w-4 h-4 ml-auto relative z-10 text-primary" />}
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
        <div className="max-w-4xl mx-auto">
          <header className="mb-20 space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-primary/10 rounded-full border border-primary/20">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[9px] font-black text-primary uppercase tracking-[0.2em]">{configurationBadge}</span>
            </div>
            <h1 className="text-[48px] font-black text-on-surface tracking-tighter leading-[0.9] flex items-center gap-4">
              {activeLabel}
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-2 h-2 rounded-full bg-primary mt-4" />
            </h1>
            <p className="text-on-surface/40 text-[18px] max-w-xl font-medium antialiased">
              {categoryDescription}
            </p>
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease: 'circOut' }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
