/* Android の Chrome で「PC版サイト」がオンになっていると、スマホでもパソコン幅（約980px）で
 * 表示されて文字がとても小さくなる。その場合だけ、画面幅に合わせて拡大し、スマホ用の表示に切り替える。 */
(function () {
  function fit() {
    var root = document.documentElement;
    var sw = Math.min(screen.width || 0, screen.height || 0) ? (window.matchMedia && matchMedia('(orientation: landscape)').matches ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height)) : 0;
    var touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    root.style.zoom = '';
    var vw = window.innerWidth;
    var forced = touch && sw > 0 && sw <= 820 && vw > sw * 1.25;
    root.classList.toggle('force-mobile', forced);
    if (forced) root.style.zoom = String(Math.round((vw / sw) * 100) / 100);
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
})();
