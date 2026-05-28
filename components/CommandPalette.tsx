'use client';

/**
 * ⌘K / Ctrl-K command palette — fuzzy-jump between agents.
 *
 * Lifted straight out of the Linear / Vercel playbook: a modal
 * that fades in over a backdrop blur, type to filter, arrow keys
 * to navigate, Enter to select. Premium products all have this;
 * the marketplace shouldn't be the odd one out.
 *
 * Hook from MarketplaceLayout: parent owns the open state and the
 * `onSelect(slug)` handler that drives URL-hash + sidebar.
 */
import { Command } from 'cmdk';
import { Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import type { PublicAgentConfig } from '@/lib/agents/types';
import { cn } from '@/lib/utils';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: PublicAgentConfig[];
  onSelect: (slug: string) => void;
}

const CATEGORY_LABEL: Record<PublicAgentConfig['category'], string> = {
  sales: 'Sales',
  finance: 'Finance',
  operations: 'Operations',
  hr: 'HR',
  marketing: 'Marketing',
  'customer-success': 'Customer Success',
};

export function CommandPalette({
  open,
  onOpenChange,
  agents,
  onSelect,
}: CommandPaletteProps) {
  // Register the ⌘K / Ctrl-K global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === 'Escape' && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  // Group agents by category for visual scanning.
  const grouped = agents.reduce<Record<string, PublicAgentConfig[]>>((acc, agent) => {
    (acc[agent.category] ??= []).push(agent);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 px-4 pt-[15vh] backdrop-blur-md animate-in fade-in-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <Command
        label="Agent search"
        className={cn(
          'w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-soft-lg',
          'animate-in fade-in-0 zoom-in-95',
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <Command.Input
            autoFocus
            placeholder="Search agents…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground sm:inline">
            ESC
          </kbd>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
          <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
            No agents match that query.
          </Command.Empty>

          {Object.entries(grouped).map(([category, list]) => (
            <Command.Group
              key={category}
              heading={CATEGORY_LABEL[category as PublicAgentConfig['category']]}
              className="text-xs font-medium uppercase tracking-wider text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {list.map((agent) => (
                <Command.Item
                  key={agent.slug}
                  value={`${agent.name} ${agent.slug} ${agent.description}`}
                  onSelect={() => {
                    onSelect(agent.slug);
                    onOpenChange(false);
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <span className="text-base">{agent.icon}</span>
                  <span className="flex-1 truncate font-medium">{agent.name}</span>
                  <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                    /{agent.slug}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            <kbd className="mr-1 rounded border border-border bg-background px-1 font-mono">↑↓</kbd>
            navigate
            <kbd className="ml-3 mr-1 rounded border border-border bg-background px-1 font-mono">↵</kbd>
            select
          </span>
          <span>
            <kbd className="rounded border border-border bg-background px-1 font-mono">⌘K</kbd> to toggle
          </span>
        </div>
      </Command>
    </div>
  );
}
