// Preserve the supplied PNG; frame its wordmark without the transparent margins.
export function TawfLogo() {
  return (
    <svg
      role="img"
      aria-label="TAWF"
      viewBox="260 775 1440 360"
      width="128"
      height="32"
      className="block h-8 w-32 shrink-0 overflow-hidden brightness-0"
    >
      <image href="/tawf-logo.png" width="2000" height="2000" />
    </svg>
  );
}
