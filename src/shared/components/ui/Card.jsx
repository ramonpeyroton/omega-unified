// Card — white rounded container used across the redesigned dashboards.
// Use `padding` to adjust internal spacing, or pass `padding="none"` and
// handle padding inside if you need a custom header/body split.

export default function Card({
  children,
  className = '',
  padding = 'md',
  hover = false,
  as: Tag = 'div',
  ...rest
}) {
  const paddings = {
    none: '',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  };
  const base =
    'bg-white rounded-2xl shadow-card border border-black/[0.04] transition-shadow';
  const hoverCls = hover ? 'hover:shadow-card-hover' : '';
  return (
    <Tag
      className={`${base} ${paddings[padding] ?? paddings.md} ${hoverCls} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
