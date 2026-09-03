// Fallback coordinates used only when a source is known at country level.
// These are capital-city representative points, never geographic country centroids.
// Add a capital point here before admitting a new country_only source.
window.COUNTRY_REFERENCE_POINT_KIND = 'capital';
window.COUNTRY_REFERENCE_POINTS = Object.freeze({
  DE: [52.5167, 13.4],       // Berlin
  FR: [48.8667, 2.3333],     // Paris
  JP: [35.6833, 139.75],     // Tokyo
  NO: [59.9167, 10.75],      // Oslo
  PL: [52.25, 21.0],         // Warsaw
  US: [38.9072, -77.0369],   // Washington, D.C.
});
