export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-mark${compact ? ' brand-mark-compact' : ''}`} aria-label="PROJECT FLIGHT">
      <svg viewBox="0 0 42 42" aria-hidden="true"><path d="M6 22 19 18l5-12 4 1-2 12 10 3-1 4-10-1-4 11-4-1 2-12-13 3v-4Z" /></svg>
      {!compact && <span><b>PROJECT</b><em>FLIGHT</em></span>}
    </div>
  );
}
