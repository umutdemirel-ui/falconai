export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

export function formatRelative(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dakika önce`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} gün önce`;
  return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'İyi geceler';
  if (h < 12) return 'Günaydın';
  if (h < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toLocaleUpperCase('tr-TR') ?? '')
    .join('');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const riskLabels: Record<string, { label: string; className: string }> = {
  safe: { label: 'Güvenli', className: 'text-emerald-300/90 border-emerald-400/30 bg-emerald-500/10' },
  moderate: { label: 'Dikkat', className: 'text-amber-200/90 border-amber-400/30 bg-amber-500/10' },
  dangerous: { label: 'Riskli', className: 'text-falcon-200 border-falcon-500/40 bg-falcon-600/15' },
};

export function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (kod bloğu) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#>]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
