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
  if (sourceCounts && toolbar) {
    sourceCounts.setAttribute('aria-hidden', 'true');
    const summary = document.createElement('div');
    summary.id = 'locationSummaryBar';
    summary.setAttribute('aria-label', '配信元の位置内訳');
    toolbar.insertAdjacentElement('afterend', summary);

    const syncSummary = () => {
      const cells = [...(sourceCounts.querySelector('.map-location-counts')?.children || [])];
      summary.replaceChildren();
      const items = document.createElement('div');
      items.className = 'location-summary-items';
      for (let i = 0; i + 1 < cells.length; i += 2) {
        const item = document.createElement('div');
        item.className = 'location-summary-item';
        const label = document.createElement('span');
        label.className = 'location-summary-label';
        label.textContent = cells[i].textContent;
        const value = document.createElement('strong');
        value.className = 'location-summary-value';
        value.textContent = cells[i + 1].textContent;
        item.append(label, value);
        items.appendChild(item);
      }
      summary.appendChild(items);
    };
    syncSummary();
    new MutationObserver(syncSummary).observe(sourceCounts, { childList: true, subtree: true, characterData: true });
  }

  const legend = document.querySelector('.legend');
  if (legend) {
    legend.innerHTML = '<span class="legend-state">状態: 赤 LIVE / 橙 Upcoming / 灰 Sourceのみ</span><span class="legend-separator">·</span><span class="legend-location"><span class="legend-map-pin legend-actual" aria-hidden="true"></span>実際の会場・配信地点</span><span class="legend-location"><span class="legend-map-pin legend-base" aria-hidden="true"></span>配信元拠点</span><span class="legend-location"><span class="legend-map-pin legend-country" aria-hidden="true"></span>国レベル</span><span class="legend-separator">·</span><span>不明は地図非表示</span><span class="legend-separator">·</span><span>クラスタ中央=配信元総数</span>';
  }
})();
