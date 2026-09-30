const BROWSERS = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
];

const SYSTEMS = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

const match = (ua, list) => list.find(([pattern]) => pattern.test(ua))?.[1] ?? null;

/**
 * A signed-in device as people recognize it: "Chrome on macOS", from its user agent. `mobile`
 * picks the icon. Anything unrecognized shows the agent's own first word ("curl"), or "Unknown
 * device" when there's none.
 */
export function describeDevice(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 512) : '';
  const browser = match(ua, BROWSERS);
  const system = match(ua, SYSTEMS);
  const label = browser && system ? `${browser} on ${system}` : browser || system || ua.split(/[\s/]/)[0].slice(0, 40) || 'Unknown device';
  return { label, mobile: /iPhone|iPad|Android|Mobile/.test(ua) };
}
