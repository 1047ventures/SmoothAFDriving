let _timer = null;

export function showToast(msg, type = '') {
  const el = document.getElementById('app-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'app-toast visible' + (type ? ' ' + type : '');
  clearTimeout(_timer);
  _timer = setTimeout(() => el.classList.remove('visible'), 3200);
}
