(() => {
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  ready(() => {
    const countsHost = document.querySelector('.sidebar .section');
    if (countsHost && !document.getElementById('locationCounts')) {
      const block = document.createElement('div');
      block.id = 'locationCounts';
      countsHost.appendChild(block);
    }
  });
})();
