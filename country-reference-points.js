// Fallback coordinates used only when a source is known at country level.
// These are capital-city representative points, never geographic country centroids.
// Add a capital point here before admitting a new country_only source.
window.COUNTRY_REFERENCE_POINT_KIND = 'capital';
window.COUNTRY_REFERENCE_POINTS = Object.freeze({
  DE: [52.5167, 13.4],       // Berlin
  FR: [48.8667, 2.3333],     // Paris
  GB: [51.5072, -0.1276],    // London
  JP: [35.6833, 139.75],     // Tokyo
  NL: [52.3676, 4.9041],     // Amsterdam
  NO: [59.9167, 10.75],      // Oslo
  PH: [14.5995, 120.9842],   // Manila
  PL: [52.25, 21.0],         // Warsaw
  TR: [39.9334, 32.8597],    // Ankara
  US: [38.9072, -77.0369],   // Washington, D.C.
  ZA: [-25.7479, 28.2293],   // Pretoria (administrative capital)
});
