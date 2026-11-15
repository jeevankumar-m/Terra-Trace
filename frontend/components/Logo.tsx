/** TerraTrace logo: the circular emblem (public/brand/emblem.png) + wordmark. `mark` = emblem only. */
export function Logo({ size = 40, dark = false, mark = false }: { size?: number; dark?: boolean; mark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/emblem.png" alt="TerraTrace" width={size} height={size} className="shrink-0 rounded-full" style={{ width: size, height: size }} />
      {!mark && (
        <span className="font-display font-semibold leading-none tracking-[-0.04em]" style={{ fontSize: size * 0.62 }}>
          <span className={dark ? "text-white" : "text-ink"}>Terra</span><span className="text-brand">Trace</span>
        </span>
      )}
    </span>
  );
}
