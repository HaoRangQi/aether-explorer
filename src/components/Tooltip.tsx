import React from 'react';

interface TooltipProps {
  label: string;
  children: React.ReactElement;
  side?: 'top' | 'bottom';
}

export default function Tooltip({ label, children, side = 'bottom' }: TooltipProps) {
  return (
    <div className="relative group/tip">
      {children}
      <div className={`
        pointer-events-none absolute z-[200] left-1/2 -translate-x-1/2 whitespace-nowrap
        px-2.5 py-1.5 rounded-lg text-[11px] font-bold
        bg-on-surface/90 text-surface backdrop-blur-sm shadow-lg
        opacity-0 group-hover/tip:opacity-100
        transition-opacity duration-75
        ${side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'}
      `}>
        {label}
        <div className={`
          absolute left-1/2 -translate-x-1/2 w-0 h-0
          border-x-4 border-x-transparent
          ${side === 'bottom'
            ? 'bottom-full border-b-4 border-b-on-surface/90'
            : 'top-full border-t-4 border-t-on-surface/90'}
        `} />
      </div>
    </div>
  );
}
