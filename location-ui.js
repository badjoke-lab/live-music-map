(() => {
  const refs = window.COUNTRY_REFERENCE_POINTS || {};

  window.LiveMusicMapLocationUI = Object.freeze({
    classify(source) {
      const location = source?.location || {};
      if (location.precision === 'country_only') return 'country';
      if (location.precision === 'unknown') return 'unknown';
      if (location.precision === 'venue_exact' || location.precision === 'event_exact' || location.role === 'event_home') return 'actual';
      if (['source_base', 'city_confirmed', 'operator_city_only'].includes(location.precision)) return 'base';
      return 'unknown';
    },

    label(kind) {
      return ({
        actual: '実際の会場・配信地点',
        base: '配信元拠点',
        country: '国レベル',
        unknown: '不明'
      })[kind] || '不明';
    },

    mapPoint(source) {
      const kind = this.classify(source);
      if (kind === 'country') {
        const point = refs[source?.country_code];
        return Array.isArray(point) && point.length === 2 ? { lat: point[0], lon: point[1], kind, reference: true } : null;
      }
      if (kind === 'unknown') return null;
      const lat = source?.location?.lat;
      const lon = source?.location?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, kind, reference: false };
    },

    counts(sources) {
      const counts = { actual: 0, base: 0, country: 0, unknown: 0 };
      for (const source of sources || []) counts[this.classify(source)] += 1;
      return counts;
    },

    notice(source) {
      const kind = this.classify(source);
      if (kind === 'country') return 'このピンは国レベルの参考位置です。実際の会場・配信地点や配信元拠点の座標を示すものではありません。';
      if (kind === 'base') return 'この位置は配信元拠点です。個別のライブ会場・配信地点を示すものではありません。';
      if (kind === 'unknown') return '地図上に表示できる位置情報は確認できていません。';
      return '';
    }
  });

  const header = document.querySelector('header');
  const title = header?.querySelector('b');
  if (header && title && !header.querySelector('.brand-block')) {
    const brand = document.createElement('div');
    brand.className = 'brand-block';
    header.insertBefore(brand, title);
    brand.appendChild(title);

    const tagline = document.createElement('span');
    tagline.className = 'site-tagline';
    tagline.textContent = '世界の音楽ライブ配信を、地図から探す。';
    brand.appendChild(tagline);
  }

  if (!document.querySelector('.site-footer')) {
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = '<div class="footer-credit">このサイトは、とむいさんの<a href="https://tomarigi.me/" target="_blank" rel="noopener noreferrer">「とまり木」</a>に着想を得て、音楽ライブ向けに作ったものです。 <a href="https://x.com/tomuisan/status/2089222447954575449" target="_blank" rel="noopener noreferrer">元になった投稿を見る</a></div><div class="footer-links"><a href="https://docs.google.com/forms/d/e/1FAIpQLSfKtMMnr7b--lF0LU9dJq4lkrTTSt2C4RWN6HNOOtmimSK_AQ/viewform" target="_blank" rel="noopener noreferrer">Contact</a><span class="footer-separator" aria-hidden="true">·</span><a href="https://badjoke-lab.com/" target="_blank" rel="noopener noreferrer">badjoke-lab.com</a></div>';
    document.body.appendChild(footer);
  }

  const tzSelect = document.getElementById('tz');
  if (tzSelect) {
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const labels = Object.freeze({
      'America/New_York': 'US Eastern — New York',
      'America/Los_Angeles': 'US Pacific — Los Angeles'
    });
    const applyTimezoneLabels = () => {
      for (const option of tzSelect.options) {
        const label = labels[option.value];
        if (!label) continue;
        option.textContent = option.value === localZone ? `Local · ${label}` : label;
      }
    };
    applyTimezoneLabels();
    new MutationObserver(applyTimezoneLabels).observe(tzSelect, { childList: true });
  }

  const sourceCounts = document.getElementById('locationCounts');
  const toolbar = document.querySelector('.toolbar');
  let summary = document.getElementById('locationSummaryBar');
  if (sourceCounts) sourceCounts.setAttribute('aria-hidden', 'true');
  if (toolbar && !summary) {
    summary = document.createElement('div');
    summary.id = 'locationSummaryBar';
    summary.setAttribute('aria-label', '配信元の状態と位置の内訳');
    toolbar.insertAdjacentElement('beforebegin', summary);
  }

  const legend = document.querySelector('.legend');
  if (legend) {
    legend.innerHTML = '<span class="legend-state">状態: 赤 LIVE / 橙 Upcoming / 灰 ソースのみ</span><span class="legend-separator">·</span><span class="legend-location"><span class="legend-map-pin legend-actual" aria-hidden="true"></span>実際の会場・配信地点</span><span class="legend-location"><span class="legend-map-pin legend-base" aria-hidden="true"></span>配信元拠点</span><span class="legend-location"><span class="legend-map-pin legend-country" aria-hidden="true"></span>国レベル</span><span class="legend-separator">·</span><span>不明は地図非表示</span><span class="legend-separator">·</span><span>クラスタ中央=配信元総数</span>';
  }

  function setupCombinedFilters() {
    if (!toolbar || toolbar.dataset.combinedFilters === 'true') return;
    toolbar.dataset.combinedFilters = 'true';

    const stateDefs = [
      ['all', 'すべて'],
      ['live', 'LIVE'],
      ['upcoming', 'Upcoming'],
      ['source', 'ソースのみ']
    ];
    const categoryDefs = [
      ['all', 'すべて'],
      ['festival', 'Festival'],
      ['radio', 'Radio'],
      ['independent_media', 'Independent'],
      ['studio_media', 'Studio / Media']
    ];
    let stateFilter = 'all';
    let categoryFilter = 'all';

    toolbar.replaceChildren();

    function makeGroup(axis, labelText, defs) {
      const group = document.createElement('div');
      group.className = `filter-axis filter-axis-${axis}`;
      const axisLabel = document.createElement('span');
      axisLabel.className = 'filter-axis-label';
      axisLabel.textContent = labelText;
      group.appendChild(axisLabel);
      for (const [value, label] of defs) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.axis = axis;
        button.dataset.value = value;
        button.dataset.label = label;
        button.textContent = label;
        if (value === 'all') button.classList.add('active');
        group.appendChild(button);
      }
      return group;
    }

    toolbar.appendChild(makeGroup('state', '状態', stateDefs));
    const divider = document.createElement('span');
    divider.className = 'filter-axis-divider';
    divider.textContent = '｜';
    toolbar.appendChild(divider);
    toolbar.appendChild(makeGroup('category', 'カテゴリ', categoryDefs));

    const qInput = document.getElementById('q');
    const locationUI = window.LiveMusicMapLocationUI;

    function matchesSearch(source) {
      const q = qInput?.value.trim().toLowerCase() || '';
      if (!q) return true;
      const blob = [source.name, source.country, source.region, source.city, source.type, ...(source.genres || []), ...(source.formats || [])].join(' ').toLowerCase();
      return blob.includes(q);
    }

    function matchesState(source, value = stateFilter) {
      return value === 'all' || stateFor(source) === value;
    }

    function matchesCategory(source, value = categoryFilter) {
      return value === 'all' || source.type === value;
    }

    function updateSummary() {
      if (!summary || typeof sources === 'undefined' || !Array.isArray(sources)) return;
      const status = { live: 0, upcoming: 0, source: 0 };
      for (const source of sources) status[stateFor(source)] += 1;
      const loc = locationUI.counts(sources);
      const n = value => Number(value || 0).toLocaleString('ja-JP');
      summary.innerHTML = `<div class="summary-stat summary-total"><span>配信元</span><strong>${n(sources.length)}</strong></div><div class="summary-stat"><span>LIVE</span><strong>${n(status.live)}</strong></div><div class="summary-stat"><span>Upcoming</span><strong>${n(status.upcoming)}</strong></div><div class="summary-stat"><span>ソースのみ</span><strong>${n(status.source)}</strong></div><span class="summary-divider" aria-hidden="true">｜</span><div class="summary-stat summary-location"><span>実位置</span><strong>${n(loc.actual)}</strong></div><div class="summary-stat summary-location"><span>拠点</span><strong>${n(loc.base)}</strong></div><div class="summary-stat summary-location"><span>国</span><strong>${n(loc.country)}</strong></div><div class="summary-stat summary-location"><span>不明</span><strong>${n(loc.unknown)}</strong></div>`;
    }

    function updateFilterCounts() {
      if (typeof sources === 'undefined' || !Array.isArray(sources)) return;
      const stateBase = sources.filter(source => matchesSearch(source) && matchesCategory(source));
      const categoryBase = sources.filter(source => matchesSearch(source) && matchesState(source));

      toolbar.querySelectorAll('[data-axis="state"]').forEach(button => {
        const value = button.dataset.value;
        const count = value === 'all' ? stateBase.length : stateBase.filter(source => stateFor(source) === value).length;
        button.textContent = `${button.dataset.label} ${count.toLocaleString('ja-JP')}`;
        button.classList.toggle('active', value === stateFilter);
      });

      toolbar.querySelectorAll('[data-axis="category"]').forEach(button => {
        const value = button.dataset.value;
        const count = value === 'all' ? categoryBase.length : categoryBase.filter(source => source.type === value).length;
        button.textContent = `${button.dataset.label} ${count.toLocaleString('ja-JP')}`;
        button.classList.toggle('active', value === categoryFilter);
      });
    }

    function sanitizeAcquisitionStatus() {
      const acq = document.getElementById('acq');
      if (!acq || typeof acquisition === 'undefined') return;
      acq.textContent = acquisition?.youtube?.configured ? 'YouTube自動取得: 有効' : 'YouTube自動取得: APIキー未設定';
    }

    function renderCombined() {
      markerLayer.clearLayers();
      const subset = sources.filter(source => matchesSearch(source) && matchesState(source) && matchesCategory(source)).sort(sourceOrder);
      document.getElementById('list').innerHTML = subset.map(source => {
        const st = stateFor(source);
        const upcoming = orderedStreams(source.id).find(stream => stream.status === 'upcoming');
        const next = st === 'upcoming' && upcoming ? ` · ${formatTime(upcoming.scheduled_start)}` : '';
        const stateLabel = st === 'source' ? 'ソース' : st.toUpperCase();
        return `<div class="source" data-id="${esc(source.id)}"><div class="name"><span class="status ${st}">${stateLabel}</span>${esc(source.name)}</div><div class="meta">${esc(source.city || '')}${source.city && source.country ? ', ' : ''}${esc(source.country || '')} · ${esc(source.type)}${esc(next)}</div><div class="badges">${(source.genres || []).slice(0, 5).map(badge).join('')}</div></div>`;
      }).join('');
      document.querySelectorAll('.source').forEach(element => {
        element.onclick = () => show(sources.find(source => source.id === element.dataset.id));
      });
      const points = [];
      for (const source of subset) {
        const point = locationUI.mapPoint(source);
        if (!point) continue;
        const st = stateFor(source);
        points.push(L.marker([point.lat, point.lon], { icon: sourceIcon(st, point.kind), sourceState: st, title: source.name }).on('click', () => show(source)));
      }
      markerLayer.addLayers(points);
      updateSummary();
      updateFilterCounts();
      sanitizeAcquisitionStatus();
      return subset;
    }

    function renderAndKeepSelection() {
      const ordered = renderCombined();
      if (ordered.length && (!selectedSource || !ordered.includes(selectedSource))) show(ordered[0]);
      return ordered;
    }

    currentFilter = 'all';
    render = renderCombined;

    toolbar.querySelectorAll('button').forEach(button => {
      button.onclick = () => {
        if (button.dataset.axis === 'state') stateFilter = button.dataset.value;
        if (button.dataset.axis === 'category') categoryFilter = button.dataset.value;
        renderAndKeepSelection();
      };
    });

    if (qInput) {
      qInput.addEventListener('input', event => {
        event.stopImmediatePropagation();
        renderAndKeepSelection();
      }, true);
    }

    if (typeof sources !== 'undefined' && Array.isArray(sources) && sources.length) renderAndKeepSelection();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupCombinedFilters, { once: true });
  else setupCombinedFilters();
})();
