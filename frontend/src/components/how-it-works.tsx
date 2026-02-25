'use client';

import { Upload, Filter, Brain, Braces } from 'lucide-react';

const steps = [
  {
    icon: Upload,
    title: 'Upload',
    description: 'Export HAR from DevTools',
  },
  {
    icon: Filter,
    title: 'Filter',
    description: '8-layer pipeline removes ~85% noise',
  },
  {
    icon: Brain,
    title: 'Match',
    description: 'AI identifies the right request',
  },
  {
    icon: Braces,
    title: 'Curl',
    description: 'Get a ready-to-use command',
  },
];

export function HowItWorks() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {steps.map((step, i) => (
        <div
          key={step.title}
          className="relative flex flex-col items-center text-center gap-2 p-4 animate-fade-in-up"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          {i < steps.length - 1 && (
            <div className="hidden md:block absolute top-8 left-[calc(50%+24px)] w-[calc(100%-48px)] border-t border-dashed border-zinc-300 dark:border-zinc-700" />
          )}
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            <step.icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{step.title}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{step.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
