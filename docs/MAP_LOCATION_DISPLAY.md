# Map location display

Status: active UI contract

Public Source locations are displayed in four Japanese-facing classes:

1. `実際の会場・配信地点`
2. `配信元拠点`
3. `国レベル`
4. `不明`

The first three are map-visible classes. `不明` remains in the Source list and location totals but has no map marker.

## Classification

### 実際の会場・配信地点

Use when the recorded Source location represents an actual event home, event location, venue, or fixed source location that is itself the place from which the music-live activity is presented.

Current qualifying location values include `venue_exact`, `event_exact`, and `role=event_home`.

### 配信元拠点

Use when a verified source/operator base is known but must not be interpreted as the location of every Event or Stream.

Current qualifying values include `source_base`, `city_confirmed`, and `operator_city_only` when they are not classified as an actual event/venue location.

### 国レベル

Use when `location.precision=country_only`.

Canonical Source facts remain unchanged: `location.lat` and `location.lon` stay `null` when no factual coordinates are verified. The UI may place the marker at a separate country reference point solely for map discoverability.

A country-level marker must be visually distinct and its detail panel must state that the point is a country-level reference and is not an actual venue, stream location, or source base coordinate.

### 不明

Use when `location.precision=unknown` or no usable geographic class can be established.

No synthetic map coordinate is created. The Source remains in the list and is counted in totals.

## Counts

The Source-list header must always show:

- `配信元` total
- `実際の会場・配信地点`
- `配信元拠点`
- `国レベル`
- `不明`

The four location-class counts must sum to the total Source count.

## State versus location precision

LIVE / Upcoming / Source-only state and location precision are independent dimensions.

- red / orange / gray continues to communicate stream state;
- marker shape/style communicates the location class.

Country-level reference markers must therefore retain the appropriate LIVE / Upcoming / Source-only state color while remaining visibly different from precise/base-location markers.
