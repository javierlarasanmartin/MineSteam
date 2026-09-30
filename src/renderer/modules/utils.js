export function sanitizeName(name) {
  if (!name) return 'instancia';
  return name.replace(/[\\/:*?"<>|()\s]/g, '_').trim();
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

export function timeAgo(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'hace ' + seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return 'hace ' + minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'hace ' + hours + 'h';
  const days = Math.floor(hours / 24);
  if (days < 30) return 'hace ' + days + 'd';
  const months = Math.floor(days / 30);
  if (months < 12) return 'hace ' + months + 'm';
  const years = Math.floor(months / 12);
  return 'hace ' + years + 'a';
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const escapeAttr = escapeHtml;
