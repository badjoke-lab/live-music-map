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
})();
