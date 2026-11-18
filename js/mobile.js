// Phone / tablet detection (iPhone, iPad incl. iPadOS "Macintosh" UA, Android, any
// touch-only device). Mobile gets a lighter graphics preset and touch-friendly layout;
// desktop is untouched. ?mobile=1 / ?mobile=0 force it for testing.
export const IS_MOBILE = (() => {
  try {
    const q = new URLSearchParams(location.search).get('mobile');
    if (q === '1') return true;
    if (q === '0') return false;
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return true;
    if (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) return true; // iPadOS
    return !!(window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches);
  } catch (_) { return false; }
})();
if (IS_MOBILE) document.documentElement.classList.add('rf-mobile');

// Portrait hint: landscape suits the side-on fight best. Dismissable, remembered for the session.
if (IS_MOBILE) {
  const add = () => {
    if (document.getElementById('rfRotate') || sessionStorage.getItem('rfRotateGone')) return;
    const d = document.createElement('div');
    d.id = 'rfRotate';
    d.innerHTML = '<span>\u21BB Turn your phone sideways for the best view</span><button type="button" aria-label="Dismiss">\u2715</button>';
    d.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); d.classList.add('gone'); try { sessionStorage.setItem('rfRotateGone', '1'); } catch (_) {} });
    document.body.appendChild(d);
    setTimeout(() => d.classList.add('gone'), 9000); // a hint, not a nag
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
}
