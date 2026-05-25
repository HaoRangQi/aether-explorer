import React from 'react';
import { motion } from 'motion/react';
import { usePrefersReducedMotion } from '../lib/use-prefers-reduced-motion';

interface LoaderProps {
  className?: string;
  size?: number;
  color?: string;
}

export default function Loader({ className = '', size = 48, color = 'var(--primary)' }: LoaderProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  // Material 3 Circular Progress style: thick stroke, specific dasharray animation.
  return (
    <div className={`relative flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <motion.svg
        viewBox="22 22 44 44"
        className="w-full h-full"
        animate={prefersReducedMotion ? undefined : { rotate: 360 }}
        transition={prefersReducedMotion ? undefined : { duration: 2, repeat: Infinity, ease: 'linear' }}
      >
        <motion.circle
          cx="44"
          cy="44"
          r="20.2"
          fill="none"
          strokeWidth="3.6"
          stroke={color}
          strokeLinecap="round"
          animate={prefersReducedMotion ? undefined : {
            strokeDasharray: ['1, 200', '89, 200', '89, 200'],
            strokeDashoffset: [0, -35, -124]
          }}
          transition={prefersReducedMotion ? undefined : {
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />
      </motion.svg>
    </div>
  );
}
