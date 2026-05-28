'use client';

/**
 * Textarea — shadcn-style with auto-grow.
 *
 * Two modes:
 *   - Standard: fixed `rows`, scrolls when overflowed.
 *   - Auto-grow (`autoSize`): grows from `minRows` to `maxRows` as the
 *     user types, scrolls past the max. Used by the chat composer so
 *     long prompts spread vertically instead of scrolling inside a
 *     2-row window — that "your prompt is bigger than the box"
 *     feeling is what makes chat UIs feel cramped.
 */
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoSize?: boolean;
  minRows?: number;
  maxRows?: number;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoSize, minRows = 1, maxRows = 8, onChange, value, ...props }, ref) => {
    const internalRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => internalRef.current as HTMLTextAreaElement);

    // Recalculate height on every value change. Set height to 'auto'
    // first so scrollHeight reflects the natural content size, then
    // clamp between min and max row heights.
    useLayoutEffect(() => {
      if (!autoSize) return;
      const ta = internalRef.current;
      if (!ta) return;
      const cs = window.getComputedStyle(ta);
      const lineHeight = parseFloat(cs.lineHeight || '20');
      const paddingY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const minH = lineHeight * minRows + paddingY;
      const maxH = lineHeight * maxRows + paddingY;
      ta.style.height = 'auto';
      const next = Math.min(maxH, Math.max(minH, ta.scrollHeight));
      ta.style.height = `${next}px`;
      ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
    }, [value, autoSize, minRows, maxRows]);

    return (
      <textarea
        ref={internalRef}
        value={value}
        onChange={onChange}
        className={cn(
          'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 scrollbar-thin',
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
