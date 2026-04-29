// Re-exports for the shared UI design system. Import from this barrel
// so call sites stay clean:
//   import { Card, IconChip, PillToggle, CategoryBadge, Avatar } from '@/shared/components/ui';
//
// (Note: Vite alias not configured — use relative paths today, e.g.
// `from '../../../shared/components/ui'`. Keeping this barrel anyway
// to make a future alias rename a one-liner.)

export { default as Card } from './Card';
export { default as IconChip } from './IconChip';
export { default as PillToggle } from './PillToggle';
export { default as CategoryBadge } from './CategoryBadge';
export { default as Avatar } from './Avatar';
