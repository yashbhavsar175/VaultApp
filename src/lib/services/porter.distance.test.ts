import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import Config from 'react-native-config';
import { __porterTestUtils } from './porter';

declare const require: (moduleName: string) => { readFileSync(path: string, encoding: string): string };

const fs = require('fs');
const pickupAddress = 'Shop 12, CG Road, Navrangpura, Ahmedabad, Gujarat 380009';
const dropAddress = 'Tower B, SG Highway, Ahmedabad, Gujarat 380015';

function fetchMock(): jest.Mock {
  return globalThis.fetch as unknown as jest.Mock;
}

function nominatimResponse(data: Array<{ lat: string; lon: string; display_name?: string; address?: Record<string, string> }> = []): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function routeResponse(km: number): Response {
  return {
    ok: true,
    json: async () => ({ routes: [{ distance: km * 1000 }] }),
  } as Response;
}

function distanceMatrixResponse(km: number): Response {
  return {
    ok: true,
    json: async () => ({
      status: 'OK',
      rows: [{ elements: [{ status: 'OK', distance: { text: `${km} km`, value: km * 1000 } }] }],
    }),
  } as Response;
}

function distanceMatrixElementFailure(status = 'NOT_FOUND'): Response {
  return {
    ok: true,
    json: async () => ({
      status: 'OK',
      rows: [{ elements: [{ status }] }],
    }),
  } as Response;
}

function failedResponse(): Response {
  return {
    ok: false,
    status: 503,
    json: async () => ({}),
  } as Response;
}

function displayState(signature: string, message: string, lastShownAt = 1_000) {
  const profile = __porterTestUtils.buildPorterDisplayProfile(message);
  return {
    signature,
    message,
    firstShownAt: 500,
    lastShownAt,
    activeUntil: lastShownAt + 12_000,
    profile,
    kind: __porterTestUtils.getPorterOverlayKind(message, profile),
  };
}

describe('Porter distance parsing and fallback privacy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => 'android',
    });
    __porterTestUtils.resetActivePorterOverlayForTest();
    NativeModules.PorterModule.showToastOverlay = jest.fn();
    NativeModules.PorterModule.showOrUpdatePorterDistanceOverlay = jest.fn(() => Promise.resolve(true));
    NativeModules.PorterModule.hidePorterDistanceOverlay = jest.fn(() => Promise.resolve(true));
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    (Config as Record<string, string>).GOOGLE_MAPS_API_KEY = '';
  });

  it('parses Porter-visible pickup distance in km and meters', () => {
    expect(__porterTestUtils.extractPorterPickupDistance('Pickup 3.3 km away')).toBe('3.3 km');
    expect(__porterTestUtils.extractPorterPickupDistance('Pickup: 2.4 km')).toBe('2.4 km');
    expect(__porterTestUtils.extractPorterPickupDistance('Pickup 500 m away')).toBe('0.5 km');
    expect(__porterTestUtils.extractPorterPickupDistance('3.3 km away')).toBe('3.3 km');
  });

  it('parses Porter-visible drop/trip distance from offer area text', () => {
    const text = [
      '₹86',
      'Pickup 1.7 km away',
      'PICKUP',
      'Jivraj Park (1.7 km)',
      'DROP',
      'Khadia (5.2 km)',
      'Accept in 8s',
    ].join(' || ');

    expect(__porterTestUtils.extractPorterTripDistance(text, 'Pickup 1.7 km away')).toBe('5.2 km');
    expect(__porterTestUtils.extractPorterTripDistance('Drop 500 m', null)).toBe('0.5 km');
    expect(__porterTestUtils.extractPorterTripDistance('Pickup -> Drop 6.0 km', null)).toBe('6 km');
  });

  it('hides parsed Porter UI distances from user-facing pending overlay', () => {
    const message = __porterTestUtils.buildPendingDistanceMessage('Pickup 1.6 km away', 'Nikol 14.8 km');

    expect(message).toBe('SpendSense calculating...');
    expect(message).not.toContain('Porter:');
    expect(message).not.toContain('1.6 km');
    expect(message).not.toContain('14.8 km');
    expect(message).not.toContain('You -> Pickup 1.6 km');
    expect(message).not.toContain('Pickup -> Drop 14.8 km');
  });

  it('shows only independent SpendSense calculated distances', () => {
    const message = __porterTestUtils.buildCalculatedDistanceMessage(
      {
        toPickup: '2.4 km',
        tripDistance: '15.2 km',
        pickupSource: 'calculated',
        tripSource: 'calculated',
      },
      'Pickup 1.6 km away',
      'Nikol 14.8 km'
    );

    expect(message).toBe('SpendSense\nPickup: 2.4 km\nTrip: 15.2 km');
    expect(message).not.toContain('Porter:');
    expect(message).not.toContain('1.6 km');
    expect(message).not.toContain('14.8 km');
  });

  it('detects live Porter offers without retaining raw address text', () => {
    const text = '₹110 || Pickup 1.7 km away || PICKUP || Jivraj Park || DROP || Khadia (5.2 km) || Accept in 8s';

    expect(__porterTestUtils.detectPorterScreenType(text)).toBe('offer');
    expect(__porterTestUtils.hasLiveOfferIndicators(text)).toBe(true);
  });

  it('does not treat visible Porter UI pickup/drop distances as SpendSense calculated distances', async () => {
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('router.project-osrm.org')) return Promise.resolve(routeResponse(2.4));
      if (decoded.includes('SG Highway') || decoded.includes('380015')) {
        return Promise.resolve(nominatimResponse([{ lat: '23.0250', lon: '72.5800', display_name: 'SG Highway, Ahmedabad, Gujarat' }]));
      }
      return Promise.resolve(nominatimResponse([{ lat: '23.0225', lon: '72.5714', display_name: 'CG Road, Navrangpura, Ahmedabad, Gujarat' }]));
    });

    const result = await __porterTestUtils.getDistancesKm(
      23.0200,
      72.5700,
      pickupAddress,
      dropAddress,
      'Pickup 1.7 km away',
      Date.now() + 4_500,
      'Khadia (5.2 km)'
    );

    expect(result.pickupSource).toBe('calculated');
    expect(result.tripSource).toBe('calculated');
    expect(result.distanceProvider).toBe('osrm_route');
  });

  it('prefers Google address-string routes over Nominatim coordinate routing', async () => {
    (Config as Record<string, string>).GOOGLE_MAPS_API_KEY = 'test-google-key';
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('maps.googleapis.com') && decoded.includes('origins=Doctor House')) {
        return Promise.resolve(distanceMatrixResponse(5.1));
      }
      if (decoded.includes('maps.googleapis.com') && decoded.includes('origins=23.026,72.575')) {
        return Promise.resolve(distanceMatrixResponse(1.2));
      }
      return Promise.reject(new Error(`Unexpected fallback call: ${decoded}`));
    });

    const result = await __porterTestUtils.getDistancesKm(
      23.026,
      72.575,
      'Doctor House, Ellisbridge',
      'Keshav Park Society Road, Bodakdev',
      'Pickup 3.3 km away',
      undefined,
      'Drop 8.6 km'
    );

    const urls = fetchMock().mock.calls.map(call => decodeURIComponent(String(call[0])));
    expect(result.distanceProvider).toBe('google_distance_matrix');
    expect(result.isApproximate).toBe(false);
    expect(result.toPickup).toBe('1.2 km');
    expect(result.tripDistance).toBe('5.1 km');
    expect(result.routeDiagnostics?.events).toContain('google_address_route_used');
    expect(urls.every(url => !url.includes('nominatim') && !url.includes('router.project-osrm.org'))).toBe(true);
  });

  it('generates Google-friendly Doctor House and Ellisbridge address candidates', () => {
    const candidates = __porterTestUtils.buildGoogleAddressCandidates(
      'A 15, Ground Floor, Doctor House, near Parimal Garden, Ellisbridge',
      'Pickup 3.3 km away || DROP || Bodakdev'
    );
    const queries = candidates.map(candidate => candidate.query);

    expect(queries[0]).toBe('A 15, Ground Floor, Doctor House, near Parimal Garden, Ellisbridge, Ahmedabad, Gujarat, India');
    expect(candidates[0].className).toBe('exact_address');
    expect(queries).toContain('Doctor House, near Parimal Garden, Ellisbridge, Ahmedabad, Gujarat, India');
    expect(queries).toContain('Ellisbridge, Ahmedabad, Gujarat, India');
    expect(JSON.stringify(candidates)).not.toContain('3.3 km');
  });

  it('ranks exact Google address candidates above locality-only candidates', () => {
    const candidates = __porterTestUtils.buildGoogleAddressCandidates(
      '114, Ashram Rd, Ellisbridge',
      'Pickup Ellisbridge || Ahmedabad'
    );

    expect(candidates[0].className).toBe('exact_address');
    expect(candidates[0].query).toContain('114');
    expect(candidates.some(candidate => candidate.className === 'locality_only')).toBe(true);
    expect(candidates[0].score).toBeGreaterThan(
      candidates.find(candidate => candidate.className === 'locality_only')?.score || 0
    );
  });

  it('classifies Doctor House as a landmark-road Google candidate', () => {
    const candidates = __porterTestUtils.buildGoogleAddressCandidates(
      'Doctor House, Ellisbridge',
      'Pickup 3.3 km away'
    );

    expect(candidates[0].query).toBe('Doctor House, Ellisbridge, Ahmedabad, Gujarat, India');
    expect(candidates[0].className).toBe('landmark_road');
  });

  it('generates Google-friendly Keshav Park and Bodakdev address candidates', () => {
    const candidates = __porterTestUtils.buildGoogleAddressCandidates(
      'Keshav Park Society Road, Bodakdev',
      'Drop 8.6 km'
    );
    const queries = candidates.map(candidate => candidate.query);

    expect(queries[0]).toBe('Keshav Park Society Road, Bodakdev, Ahmedabad, Gujarat, India');
    expect(candidates[0].className).toBe('road_area');
    expect(queries).toContain('Bodakdev, Ahmedabad, Gujarat, India');
    expect(JSON.stringify(candidates)).not.toContain('8.6 km');
  });

  it('treats locality-only Google candidates as low confidence', () => {
    const pickup = __porterTestUtils.buildGoogleAddressCandidates('Ellisbridge', 'Ahmedabad')[0];
    const drop = __porterTestUtils.buildGoogleAddressCandidates('Bodakdev', 'Ahmedabad')[0];

    expect(pickup.className).toBe('locality_only');
    expect(drop.className).toBe('locality_only');
    expect(__porterTestUtils.googleRouteConfidence(pickup.className, drop.className)).toBe('low');
  });

  it('starts Google pickup and trip address route calls in parallel', async () => {
    (Config as Record<string, string>).GOOGLE_MAPS_API_KEY = 'test-google-key';
    const resolvers: Array<(value: Response) => void> = [];
    const startedUrls: string[] = [];
    fetchMock().mockImplementation((url: string) => {
      startedUrls.push(decodeURIComponent(url));
      return new Promise<Response>(resolve => {
        resolvers.push(resolve);
      });
    });

    const pending = __porterTestUtils.getDistancesKm(
      23.026,
      72.575,
      'Doctor House, Ellisbridge',
      'Keshav Park Society Road, Bodakdev'
    );
    await Promise.resolve();

    expect(startedUrls.filter(url => url.includes('maps.googleapis.com'))).toHaveLength(2);
    resolvers[0](distanceMatrixResponse(5.1));
    resolvers[1](distanceMatrixResponse(1.2));
    const result = await pending;

    expect(result.routeDiagnostics?.events).toContain('google_address_route_used');
    expect(result.tripDistance).toBe('5.1 km');
  });

  it('falls back to Google coordinate routing only after address-string route failure', async () => {
    (Config as Record<string, string>).GOOGLE_MAPS_API_KEY = 'test-google-key';
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('maps.googleapis.com') && decoded.includes('Doctor House')) {
        return Promise.resolve(distanceMatrixElementFailure());
      }
      if (decoded.includes('maps.googleapis.com') && decoded.includes('Keshav Park')) {
        return Promise.resolve(distanceMatrixElementFailure());
      }
      if (decoded.includes('nominatim') && decoded.includes('Doctor House')) {
        return Promise.resolve(nominatimResponse([{ lat: '23.0274', lon: '72.5711', display_name: 'Doctor House, Ellisbridge, Ahmedabad, Gujarat' }]));
      }
      if (decoded.includes('nominatim') && decoded.includes('Keshav Park')) {
        return Promise.resolve(nominatimResponse([{ lat: '23.0410', lon: '72.5080', display_name: 'Keshav Park Society Road, Bodakdev, Ahmedabad, Gujarat' }]));
      }
      if (decoded.includes('maps.googleapis.com') && decoded.includes('origins=23.0274,72.5711')) {
        return Promise.resolve(distanceMatrixResponse(5.1));
      }
      if (decoded.includes('maps.googleapis.com') && decoded.includes('origins=23.026,72.575')) {
        return Promise.resolve(distanceMatrixResponse(1.2));
      }
      return Promise.reject(new Error(`Unexpected route call: ${decoded}`));
    });

    const result = await __porterTestUtils.getDistancesKm(
      23.026,
      72.575,
      'Doctor House, Ellisbridge',
      'Keshav Park Society Road, Bodakdev'
    );

    expect(result.distanceProvider).toBe('google_distance_matrix');
    expect(result.routeDiagnostics?.events).toContain('address_string_route_failed');
    expect(result.routeDiagnostics?.events).toContain('google_coordinate_route_used');
    expect(result.isApproximate).toBe(false);
  });

  it('suppresses weak-location pickup while still showing Google address trip distance', async () => {
    (Config as Record<string, string>).GOOGLE_MAPS_API_KEY = 'test-google-key';
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      expect(decoded).toContain('maps.googleapis.com');
      expect(decoded).toContain('origins=Doctor House');
      return Promise.resolve(distanceMatrixResponse(5.1));
    });

    const result = await __porterTestUtils.getDistancesKm(
      23.026,
      72.575,
      'Doctor House, Ellisbridge',
      'Keshav Park Society Road, Bodakdev',
      null,
      undefined,
      null,
      undefined,
      { ts: Date.now(), accuracy: 450 }
    );
    const message = __porterTestUtils.buildCalculatedDistanceMessage(result);

    expect(result.toPickup).toBe('N/A');
    expect(result.tripDistance).toBe('5.1 km');
    expect(result.failureReason).toBe('current_location_low_accuracy');
    expect(result.routeDiagnostics?.events).toContain('current_location_weak');
    expect(result.routeDiagnostics?.events).toContain('google_address_route_used');
    expect(message).toBe('SpendSense\nPickup: location weak\nTrip: 5.1 km');
  });

  it('keeps Google address-route diagnostics privacy-safe', async () => {
    (Config as Record<string, string>).GOOGLE_MAPS_API_KEY = 'test-google-key';
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      return Promise.resolve(decoded.includes('origins=Doctor House')
        ? distanceMatrixResponse(5.1)
        : distanceMatrixResponse(1.2));
    });

    const result = await __porterTestUtils.getDistancesKm(
      23.026,
      72.575,
      'Doctor House, Ellisbridge, Rahul 9876543210',
      'Keshav Park Society Road, Bodakdev',
      'Pickup 3.3 km away',
      undefined,
      'Drop 8.6 km'
    );
    const stored = await AsyncStorage.getItem('debug_porter_api_response');
    const serialized = JSON.stringify(result.routeDiagnostics);

    expect(stored).toContain('pickupCandidateHash');
    expect(stored).toContain('pickupCandidateLength');
    expect(stored).toContain('pickupCandidateClass');
    expect(stored).not.toContain('Doctor House');
    expect(stored).not.toContain('Keshav Park');
    expect(stored).not.toContain('Rahul');
    expect(stored).not.toContain('9876543210');
    expect(serialized).toContain('differenceBucketVsPorterUi');
    expect(serialized).toContain('pickupCandidateHash');
    expect(serialized).toContain('pickupCandidateLength');
    expect(serialized).not.toContain('Doctor House');
    expect(serialized).not.toContain('Keshav Park');
    expect(serialized).not.toContain('Rahul');
  });

  it('marks Google locality-only address routes as approximate in the overlay', async () => {
    (Config as Record<string, string>).GOOGLE_MAPS_API_KEY = 'test-google-key';
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      return Promise.resolve(decoded.includes('origins=23.026,72.575')
        ? distanceMatrixResponse(3.3)
        : distanceMatrixResponse(9.2));
    });

    const result = await __porterTestUtils.getDistancesKm(
      23.026,
      72.575,
      'Ellisbridge',
      'Bodakdev',
      'Pickup 1.2 km away',
      undefined,
      'Trip 5.1 km'
    );
    const message = __porterTestUtils.buildCalculatedDistanceMessage(result, 'Pickup 1.2 km away', 'Trip 5.1 km');

    expect(result.distanceProvider).toBe('google_distance_matrix');
    expect(result.isApproximate).toBe(true);
    expect(result.routeDiagnostics?.confidence).toBe('low');
    expect(message).toBe('SpendSense approx\nPickup: 3.3 km\nTrip: 9.2 km');
    expect(message).not.toContain('Porter:');
    expect(message).not.toContain('1.2 km');
    expect(message).not.toContain('5.1 km');
  });

  it('shows address unclear instead of routing broad city-only candidates', async () => {
    (Config as Record<string, string>).GOOGLE_MAPS_API_KEY = 'test-google-key';

    const result = await __porterTestUtils.getDistancesKm(
      23.026,
      72.575,
      'Ahmedabad',
      'Gujarat',
      'Pickup 1.2 km away',
      undefined,
      'Trip 5.1 km'
    );
    const message = __porterTestUtils.buildCalculatedDistanceMessage(result, 'Pickup 1.2 km away', 'Trip 5.1 km');

    expect(fetchMock()).not.toHaveBeenCalled();
    expect(result.failureReason).toBe('address_unclear');
    expect(result.routeDiagnostics?.confidence).toBe('too_weak');
    expect(message).toBe('SpendSense unavailable\naddress unclear');
    expect(message).not.toContain('Porter:');
    expect(message).not.toContain('1.2 km');
    expect(message).not.toContain('5.1 km');
  });

  it('suppresses bogus tiny trip distances for distinct Porter locations', () => {
    const result = __porterTestUtils.normalizeTripDistance(
      '11 m',
      'Jivraj Park, Ahmedabad, Gujarat',
      'Khadia, Ahmedabad, Gujarat'
    );

    expect(result.tripDistance).toBe('N/A');
    expect(result.failureReason).toBe('suspicious_trip_distance_suppressed');
    expect(JSON.stringify(result)).not.toContain('Jivraj');
    expect(JSON.stringify(result)).not.toContain('Khadia');
  });

  it('suppresses same-coordinate zero trip distances for different localities', () => {
    const result = __porterTestUtils.normalizeTripDistance(
      '~0.0 km',
      'Khanpur, Ahmedabad, Gujarat, India',
      'Sola, Ahmedabad, Gujarat, India'
    );

    expect(result.tripDistance).toBe('N/A');
    expect(result.failureReason).toBe('suspicious_trip_distance_suppressed');
  });

  it('does not show Porter UI trip distance when calculated trip is suppressed', () => {
    const message = __porterTestUtils.buildCalculatedDistanceMessage(
      {
        toPickup: '2.4 km',
        tripDistance: 'N/A',
        pickupSource: 'calculated',
        tripSource: 'unavailable',
        failureReason: 'suspicious_trip_distance_suppressed',
      },
      'Pickup 1.6 km away',
      'Khadia (5.2 km)'
    );

    expect(message).toBe('SpendSense\nPickup: 2.4 km\nTrip unavailable');
    expect(message).not.toContain('Porter:');
    expect(message).not.toContain('1.6 km');
    expect(message).not.toContain('5.2 km');
    expect(message).not.toContain('Pickup -> Drop 5.2 km');
  });

  it('drops geocode results that arrive after a live offer expires', () => {
    __porterTestUtils.setActivePorterResultForTest(7, 'order-live-a', {
      signature: 'order-live-a',
      screenType: 'offer',
      hasLiveOffer: false,
      seenAt: 1_000,
    });

    expect(__porterTestUtils.isCurrentPorterResult(
      { runId: 7, signature: 'order-live-a', startedAt: 1_000, screenType: 'offer' },
      { signature: 'order-live-a', screenType: 'offer', hasLiveOffer: false, seenAt: 1_000 },
      6_000
    )).toBe(false);
  });

  it('allows same-signature geocode results while the live offer is still visible', () => {
    __porterTestUtils.setActivePorterResultForTest(8, 'order-live-b', {
      signature: 'order-live-b',
      screenType: 'offer',
      hasLiveOffer: true,
      seenAt: 2_000,
    });

    expect(__porterTestUtils.isCurrentPorterResult(
      { runId: 8, signature: 'order-live-b', startedAt: 1_000, screenType: 'offer' },
      { signature: 'order-live-b', screenType: 'offer', hasLiveOffer: true, seenAt: 2_000 },
      3_000
    )).toBe(true);
  });

  it('drops stale results with an old order signature', () => {
    __porterTestUtils.setActivePorterResultForTest(9, 'order-new', {
      signature: 'order-new',
      screenType: 'offer',
      hasLiveOffer: true,
      seenAt: 2_000,
    });

    expect(__porterTestUtils.isCurrentPorterResult(
      { runId: 9, signature: 'order-old', startedAt: 1_000, screenType: 'offer' },
      { signature: 'order-new', screenType: 'offer', hasLiveOffer: true, seenAt: 2_000 },
      3_000
    )).toBe(false);
  });

  it('hides active overlay when offer indicators disappear', () => {
    const message = 'SpendSense\nPickup: 1.7 km\nTrip: 5.2 km';

    expect(__porterTestUtils.shouldHideOverlayForScreenText(
      'Go offline || Wallet balance || Noticeboard',
      displayState('order-a', message, 1_000)
    )).toBe(true);
  });

  it('does not show Porter UI pickup when geocoding fails', async () => {
    fetchMock().mockResolvedValue(nominatimResponse());

    const result = await __porterTestUtils.getDistancesKm(
      23.02,
      72.57,
      pickupAddress,
      dropAddress,
      'Pickup 3.3 km away'
    );

    expect(result.toPickup).toBe('N/A');
    expect(result.tripDistance).toBe('N/A');
    expect(result.failureReason).toBe('geocode_failed');
    expect(result.pickupSource).toBe('unavailable');

    const message = __porterTestUtils.buildCalculatedDistanceMessage(result, 'Pickup 3.3 km away');
    expect(message).toBe('SpendSense unavailable: geocode failed');
    expect(message).not.toContain('Porter:');
    expect(message).not.toContain('3.3 km');
    expect(message).not.toContain('You -> Pickup: 3.3 km');
  });

  it('extracts Khanpur and Sola locality candidates from Porter popup text', () => {
    const text = [
      '₹98',
      'Pickup 3.2 km away',
      'PICKUP',
      'Khanpur (3.2 km)',
      'near Bhadra ... Ahmedabad',
      'DROP',
      'Sola (10.0 km)',
      'near science city ...',
      'Accept in 8s',
    ].join(' || ');
    const addresses = __porterTestUtils.extractAddresses(text);
    const pickupCandidates = __porterTestUtils.buildGeocodeCandidates(addresses?.pickup || '', text);
    const dropCandidates = __porterTestUtils.buildGeocodeCandidates(addresses?.drop || '', text);

    expect(addresses?.pickup).toContain('Khanpur');
    expect(addresses?.drop).toContain('Sola');
    expect(pickupCandidates[0].query).toBe('Khanpur, Ahmedabad, Gujarat, India');
    expect(dropCandidates[0].query).toBe('Sola, Ahmedabad, Gujarat, India');
    expect(JSON.stringify(pickupCandidates)).not.toContain('3.2 km');
    expect(JSON.stringify(dropCandidates)).not.toContain('10.0 km');
  });

  it('creates locality candidates from truncated addresses and appends Ahmedabad context', () => {
    const candidates = __porterTestUtils.buildGeocodeCandidates(
      'Near old market, Khanpur ...',
      'Pickup 3.2 km away || DROP || Sola (10.0 km)'
    );

    expect(candidates[0].query).toBe('Khanpur, Ahmedabad, Gujarat, India');
    expect(candidates.some(candidate => candidate.reasons.includes('truncated_address_candidate_used'))).toBe(true);
    expect(candidates.every(candidate => !candidate.query.includes('...'))).toBe(true);
  });

  it('prioritizes exact Ashram Road Ellisbridge candidate over broad locality', () => {
    const candidates = __porterTestUtils.buildGeocodeCandidates(
      '114, Ashram Rd, Ellisbridge',
      'Pickup Ellisbridge || 114 Ashram Rd area || Ahmedabad'
    );

    expect(candidates[0].type).toBe('exact_address');
    expect(candidates[0].query).toContain('114');
    expect(candidates[0].query).toContain('Ashram Rd');
    expect(candidates[0].query).toContain('Ellisbridge');
    expect(candidates[0].query).toContain('Ahmedabad, Gujarat, India');
    expect(candidates[0].reasons).toContain('road_match');
    expect(candidates[0].reasons).toContain('locality_match');
    expect(candidates.findIndex(candidate => candidate.query.startsWith('Ellisbridge,'))).toBeGreaterThan(0);
  });

  it('prioritizes Swami Vivekanand Marg Thaltej candidate over broad locality', () => {
    const candidates = __porterTestUtils.buildGeocodeCandidates(
      'Swami Vivekanand Marg, Thaltej',
      'Drop Thaltej || Ahmedabad'
    );

    expect(candidates[0].type).toBe('exact_address');
    expect(candidates[0].query).toContain('Swami Vivekanand Marg');
    expect(candidates[0].query).toContain('Thaltej');
    expect(candidates[0].reasons).toContain('road_match');
    expect(candidates.findIndex(candidate => candidate.query.startsWith('Thaltej,'))).toBeGreaterThan(0);
  });

  it('appends city context to road and pincode candidates', () => {
    const candidates = __porterTestUtils.buildGeocodeCandidates('114 Ashram Rd, Ellisbridge 380006');

    expect(candidates[0].query).toContain('Ahmedabad, Gujarat, India');
    expect(candidates.some(candidate => candidate.query.includes('380006'))).toBe(true);
  });

  it('appends Ahmedabad/Gujarat/India context for short known localities', () => {
    const candidates = __porterTestUtils.buildGeocodeCandidates('Nikol (14.8 km)');

    expect(candidates[0].query).toBe('Nikol, Ahmedabad, Gujarat, India');
    expect(candidates[0].type).toBe('full_cleaned');
    expect(JSON.stringify(candidates)).not.toContain('14.8 km');
  });

  it('rejects out-of-region Nominatim result for Ahmedabad candidate', async () => {
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('router.project-osrm.org')) return Promise.resolve(routeResponse(2.4));
      if (decoded.includes('Near old market')) {
        return Promise.resolve(nominatimResponse([{ lat: '19.0760', lon: '72.8777', display_name: 'Mumbai, Maharashtra' }]));
      }
      if (decoded.includes('Sola')) {
        return Promise.resolve(nominatimResponse([{ lat: '23.0250', lon: '72.5800', display_name: 'Sola, Ahmedabad, Gujarat' }]));
      }
      return Promise.resolve(nominatimResponse([{ lat: '23.0225', lon: '72.5714', display_name: 'Khanpur, Ahmedabad, Gujarat' }]));
    });

    const result = await __porterTestUtils.getDistancesKm(
      23.0200,
      72.5700,
      'Near old market, Khanpur ...',
      'Sola (10.0 km)'
    );

    expect(result.pickupSource).toBe('calculated');
    expect(result.tripSource).toBe('calculated');
  });

  it('returns out-of-region failure when all Ahmedabad candidates resolve outside Gujarat', async () => {
    fetchMock().mockResolvedValue(nominatimResponse([{ lat: '19.0760', lon: '72.8777' }]));

    const result = await __porterTestUtils.getDistancesKm(
      23.0200,
      72.5700,
      'Khanpur (3.2 km)',
      'Sola (10.0 km)'
    );

    expect(result.failureReason).toBe('geocode_result_out_of_region');
    expect(result.toPickup).toBe('N/A');
    expect(result.tripDistance).toBe('N/A');
  });

  it('selects the best scored geocode candidate instead of the first parallel response', async () => {
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('114 Ashram Rd')) {
        return Promise.resolve(nominatimResponse([{
          lat: '23.0274',
          lon: '72.5711',
          display_name: '114 Ashram Road, Ellisbridge, Ahmedabad, Gujarat 380006',
          address: { road: 'Ashram Road', suburb: 'Ellisbridge', city: 'Ahmedabad', state: 'Gujarat', postcode: '380006' },
        }]));
      }
      return Promise.resolve(nominatimResponse([{
        lat: '23.0250',
        lon: '72.5690',
        display_name: 'Ellisbridge, Ahmedabad, Gujarat',
        address: { suburb: 'Ellisbridge', city: 'Ahmedabad', state: 'Gujarat' },
      }]));
    });

    const result = await __porterTestUtils.geocodeFromCandidates([
      {
        query: 'Ellisbridge, Ahmedabad, Gujarat, India',
        type: 'locality',
        regionHint: 'ahmedabad',
        reasons: ['locality_candidate_used'],
        score: 28,
      },
      {
        query: '114 Ashram Rd, Ellisbridge, Ahmedabad, Gujarat, India',
        type: 'exact_address',
        regionHint: 'ahmedabad',
        reasons: ['exact_address_candidate_selected', 'road_match', 'locality_match'],
        score: 120,
      },
    ]);

    expect(result.candidateType).toBe('exact_address');
    expect(result.selectedReason).toContain('candidate_score_selected');
    expect(result.selectedReason).toContain('exact_address_candidate_selected');
  });

  it('rejects broad locality when an exact address candidate is available', async () => {
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('router.project-osrm.org')) return Promise.resolve(routeResponse(2.1));
      if (decoded.includes('Swami Vivekanand Marg')) {
        return Promise.resolve(nominatimResponse([{
          lat: '23.0460',
          lon: '72.5120',
          display_name: 'Swami Vivekanand Marg, Thaltej, Ahmedabad, Gujarat',
          address: { road: 'Swami Vivekanand Marg', suburb: 'Thaltej', city: 'Ahmedabad', state: 'Gujarat' },
        }]));
      }
      if (decoded.includes('Thaltej')) {
        return Promise.resolve(nominatimResponse([{
          lat: '23.0500',
          lon: '72.5100',
          display_name: 'Thaltej, Ahmedabad, Gujarat',
          address: { suburb: 'Thaltej', city: 'Ahmedabad', state: 'Gujarat' },
        }]));
      }
      if (decoded.includes('114 Ashram Rd')) {
        return Promise.resolve(nominatimResponse([{
          lat: '23.0274',
          lon: '72.5711',
          display_name: '114 Ashram Road, Ellisbridge, Ahmedabad, Gujarat',
          address: { road: 'Ashram Road', suburb: 'Ellisbridge', city: 'Ahmedabad', state: 'Gujarat' },
        }]));
      }
      return Promise.resolve(nominatimResponse([{
        lat: '23.0250',
        lon: '72.5690',
        display_name: 'Ellisbridge, Ahmedabad, Gujarat',
        address: { suburb: 'Ellisbridge', city: 'Ahmedabad', state: 'Gujarat' },
      }]));
    });

    const result = await __porterTestUtils.getDistancesKm(
      23.0260,
      72.5750,
      '114 Ashram Rd, Ellisbridge',
      'Swami Vivekanand Marg, Thaltej'
    );
    const stored = await AsyncStorage.getItem('debug_porter_nominatim');

    expect(result.distanceProvider).toBe('osrm_route');
    expect(stored).toContain('"pickupCandidateType":"exact_address"');
    expect(stored).toContain('"dropCandidateType":"exact_address"');
    expect(stored).toContain('broad_locality_candidate_rejected');
    expect(stored).not.toContain('114 Ashram Rd, Ellisbridge');
    expect(stored).not.toContain('Swami Vivekanand Marg, Thaltej');
  });

  it('reuses successful geocode candidates from cache', async () => {
    fetchMock()
      .mockResolvedValueOnce(nominatimResponse([{ lat: '23.0225', lon: '72.5714' }]))
      .mockResolvedValueOnce(nominatimResponse([{ lat: '23.0250', lon: '72.5800' }]))
      .mockResolvedValueOnce(routeResponse(1.2))
      .mockResolvedValueOnce(routeResponse(2.4));

    await __porterTestUtils.getDistancesKm(23.0200, 72.5700, 'Khanpur (3.2 km)', 'Sola (10.0 km)');
    const second = await __porterTestUtils.getDistancesKm(23.0200, 72.5700, 'Khanpur (3.2 km)', 'Sola (10.0 km)');

    expect(fetchMock()).toHaveBeenCalledTimes(4);
    expect(second.pickupSource).toBe('calculated');
    expect(second.tripSource).toBe('calculated');
  });

  it('suppresses stale unavailable overlay instead of showing late failure', () => {
    const decision = __porterTestUtils.decideUnavailableOverlay(
      'order-stale',
      {
        toPickup: 'N/A',
        tripDistance: 'N/A',
        failureReason: 'geocode_failed',
        pickupSource: 'unavailable',
        tripSource: 'unavailable',
      },
      1_000,
      'offer',
      4_500
    );

    expect(decision.shouldShow).toBe(false);
    expect(decision.reason).toBe('unavailable_overlay_suppressed_stale');
  });

  it('shows unavailable at most once per order', () => {
    const failure = {
      toPickup: 'N/A',
      tripDistance: 'N/A',
      failureReason: 'geocode_failed' as const,
      pickupSource: 'unavailable' as const,
      tripSource: 'unavailable' as const,
    };

    expect(__porterTestUtils.decideUnavailableOverlay('order-once', failure, 1_000, 'offer', 2_000))
      .toEqual({ shouldShow: true, reason: 'unavailable_overlay_shown_once' });
    __porterTestUtils.markUnavailableOverlayShownForTest('order-once');
    expect(__porterTestUtils.decideUnavailableOverlay('order-once', failure, 1_000, 'offer', 2_500))
      .toEqual({ shouldShow: false, reason: 'display_throttled_duplicate' });
  });

  it('suppresses impossible calculated pickup distances', async () => {
    fetchMock()
      .mockResolvedValueOnce(nominatimResponse([{ lat: '23.0225', lon: '72.5714' }]))
      .mockResolvedValueOnce(nominatimResponse([{ lat: '23.0250', lon: '72.5800' }]));

    const result = await __porterTestUtils.getDistancesKm(
      -33.8688,
      151.2093,
      pickupAddress,
      dropAddress
    );

    expect(result.toPickup).toBe('N/A');
    expect(result.failureReason).toBe('device_location_mismatch');
    expect(result.detail).toBe('device_location_mismatch');
    expect(JSON.stringify(result)).not.toContain('13061');
  });

  it('suppresses pickup calculation when current location is stale', async () => {
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('router.project-osrm.org')) return Promise.resolve(routeResponse(7.0));
      if (decoded.includes('Swami Vivekanand Marg')) {
        return Promise.resolve(nominatimResponse([{ lat: '23.0460', lon: '72.5120', display_name: 'Swami Vivekanand Marg, Thaltej, Ahmedabad, Gujarat' }]));
      }
      return Promise.resolve(nominatimResponse([{ lat: '23.0274', lon: '72.5711', display_name: '114 Ashram Road, Ellisbridge, Ahmedabad, Gujarat' }]));
    });

    const result = await __porterTestUtils.getDistancesKm(
      23.0260,
      72.5750,
      '114 Ashram Rd, Ellisbridge',
      'Swami Vivekanand Marg, Thaltej',
      null,
      undefined,
      null,
      undefined,
      { ts: Date.now() - 90_000, accuracy: 40 }
    );

    expect(result.toPickup).toBe('N/A');
    expect(result.tripDistance).toBe('7 km');
    expect(result.failureReason).toBe('current_location_stale');
    expect(result.detail).toBe('current_location_stale');
    expect(result.pickupSource).toBe('unavailable');
  });

  it('suppresses pickup calculation when current location accuracy is weak', async () => {
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('router.project-osrm.org')) return Promise.resolve(routeResponse(7.0));
      if (decoded.includes('Swami Vivekanand Marg')) {
        return Promise.resolve(nominatimResponse([{ lat: '23.0460', lon: '72.5120', display_name: 'Swami Vivekanand Marg, Thaltej, Ahmedabad, Gujarat' }]));
      }
      return Promise.resolve(nominatimResponse([{ lat: '23.0274', lon: '72.5711', display_name: '114 Ashram Road, Ellisbridge, Ahmedabad, Gujarat' }]));
    });

    const result = await __porterTestUtils.getDistancesKm(
      23.0260,
      72.5750,
      '114 Ashram Rd, Ellisbridge',
      'Swami Vivekanand Marg, Thaltej',
      null,
      undefined,
      null,
      undefined,
      { ts: Date.now(), accuracy: 450 }
    );

    expect(result.toPickup).toBe('N/A');
    expect(result.tripDistance).toBe('7 km');
    expect(result.failureReason).toBe('current_location_low_accuracy');
    expect(result.detail).toBe('current_location_low_accuracy');
    expect(result.pickupSource).toBe('unavailable');
  });

  it('labels routed results as SpendSense and approximate fallback as SpendSense approx', async () => {
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('router.project-osrm.org')) return Promise.resolve(routeResponse(2.1));
      if (decoded.includes('Swami Vivekanand Marg')) {
        return Promise.resolve(nominatimResponse([{ lat: '23.0460', lon: '72.5120', display_name: 'Swami Vivekanand Marg, Thaltej, Ahmedabad, Gujarat' }]));
      }
      return Promise.resolve(nominatimResponse([{ lat: '23.0274', lon: '72.5711', display_name: '114 Ashram Road, Ellisbridge, Ahmedabad, Gujarat' }]));
    });

    const routed = await __porterTestUtils.getDistancesKm(
      23.0260,
      72.5750,
      '114 Ashram Rd, Ellisbridge',
      'Swami Vivekanand Marg, Thaltej'
    );
    const routedMessage = __porterTestUtils.buildCalculatedDistanceMessage(routed, 'Pickup 3.2 km away');

    expect(routed.isApproximate).toBe(false);
    expect(routedMessage.startsWith('SpendSense\n')).toBe(true);
    expect(routedMessage).not.toContain('Porter:');
    expect(routedMessage).not.toContain('3.2 km');

    __porterTestUtils.resetActivePorterOverlayForTest();
    fetchMock().mockImplementation((url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('router.project-osrm.org')) return Promise.resolve(failedResponse());
      if (decoded.includes('Swami Vivekanand Marg')) {
        return Promise.resolve(nominatimResponse([{ lat: '23.0460', lon: '72.5120', display_name: 'Swami Vivekanand Marg, Thaltej, Ahmedabad, Gujarat' }]));
      }
      return Promise.resolve(nominatimResponse([{ lat: '23.0274', lon: '72.5711', display_name: '114 Ashram Road, Ellisbridge, Ahmedabad, Gujarat' }]));
    });

    const approximate = await __porterTestUtils.getDistancesKm(
      23.0260,
      72.5750,
      '114 Ashram Rd, Ellisbridge',
      'Swami Vivekanand Marg, Thaltej'
    );
    const approximateMessage = __porterTestUtils.buildCalculatedDistanceMessage(approximate, 'Pickup 3.2 km away');

    expect(approximate.distanceProvider).toBe('haversine_approx');
    expect(approximate.isApproximate).toBe(true);
    expect(approximateMessage.startsWith('SpendSense approx\n')).toBe(true);
    expect(approximateMessage).not.toContain('Porter:');
    expect(approximateMessage).not.toContain('3.2 km');
  });

  it('does not prefer Porter UI pickup distance over impossible calculated distance', async () => {
    fetchMock()
      .mockResolvedValueOnce(nominatimResponse([{ lat: '23.0225', lon: '72.5714' }]))
      .mockResolvedValueOnce(nominatimResponse([{ lat: '23.0250', lon: '72.5800' }]));

    const result = await __porterTestUtils.getDistancesKm(
      -33.8688,
      151.2093,
      pickupAddress,
      dropAddress,
      'Pickup 3.3 km away'
    );

    expect(result.toPickup).toBe('N/A');
    expect(result.failureReason).toBe('device_location_mismatch');
    expect(result.pickupSource).toBe('unavailable');

    const message = __porterTestUtils.buildCalculatedDistanceMessage(result, 'Pickup 3.3 km away');
    expect(message).toBe('SpendSense unavailable: device location mismatch');
    expect(message).not.toContain('Porter:');
    expect(message).not.toContain('3.3 km');
  });

  it('cleans repeated accepted-trip address text without action/customer details', () => {
    const raw = [
      'PICKUP',
      'PICKUP',
      'Shop 12, CG Road, Navrangpura, Ahmedabad, Gujarat 380009',
      'Shop 12, CG Road, Navrangpura, Ahmedabad, Gujarat 380009',
      'Call Customer Rahul 9876543210',
      'DROP',
      'DROP',
      'Tower B, SG Highway, Ahmedabad, Gujarat 380015',
      'Cash to Collect ₹140',
      'Trip Fare ₹220',
      'Hire by 10:45 PM',
      'Cancel Trip',
    ].join(' || ');

    const addresses = __porterTestUtils.extractAddresses(raw);

    expect(addresses?.pickup).toBe('Shop 12, CG Road, Navrangpura, Ahmedabad, Gujarat 380009');
    expect(addresses?.drop).toBe('Tower B, SG Highway, Ahmedabad, Gujarat 380015');
    expect(JSON.stringify(addresses)).not.toContain('Rahul');
    expect(JSON.stringify(addresses)).not.toContain('9876543210');
    expect(JSON.stringify(addresses)).not.toContain('Cash to Collect');
    expect(JSON.stringify(addresses)).not.toContain('Cancel Trip');
  });

  it('stores only compact Nominatim diagnostics', async () => {
    fetchMock().mockResolvedValue(nominatimResponse());

    await __porterTestUtils.getDistancesKm(
      0,
      0,
      pickupAddress,
      dropAddress,
      'Pickup 500 m away'
    );

    const stored = await AsyncStorage.getItem('debug_porter_nominatim');
    expect(stored).toContain('pickupFound');
    expect(stored).toContain('calculated');
    expect(stored).not.toContain(pickupAddress);
    expect(stored).not.toContain(dropAddress);
  });

  it('throttles repeated identical display text to avoid toast quota spam', () => {
    const message = 'SpendSense\nPickup: 2.8 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'order-a',
      message,
      5_000,
      displayState('order-a', message, 1_000)
    );

    expect(decision.shouldShow).toBe(false);
    expect(decision.reason).toBe('display_throttled_duplicate');
    expect(decision.detail).toBe('toast_quota_avoided');
  });

  it('allows the first display for a new order', () => {
    const message = 'SpendSense\nPickup: 1.7 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay('order-first', message, 1_000, null);

    expect(decision.shouldShow).toBe(true);
    expect(decision.reason).toBe('display_updated_meaningful_change');
  });

  it('allows the first real distance after a pending calculating display', () => {
    const pending = 'SpendSense calculating...';
    const result = 'SpendSense\nPickup: 1.7 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'order-a',
      result,
      2_000,
      displayState('order-a', pending, 1_000)
    );

    expect(decision.shouldShow).toBe(true);
    expect(decision.reason).toBe('display_updated_meaningful_change');
  });

  it('treats an immediate Porter pickup display as pending calculation output', () => {
    const message = 'SpendSense calculating...';
    const profile = __porterTestUtils.buildPorterDisplayProfile(message);

    expect(profile.pickupKm).toBe(null);
    expect(__porterTestUtils.getPorterOverlayKind(message, profile)).toBe('pending');
  });

  it('throttles non-meaningful pickup changes from countdown/accessibility churn', () => {
    const previous = 'SpendSense\nPickup: 2.8 km\nTrip unavailable';
    const next = 'SpendSense\nPickup: 2.9 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'order-a',
      next,
      5_000,
      displayState('order-a', previous, 1_000)
    );

    expect(decision.shouldShow).toBe(false);
    expect(decision.reason).toBe('display_throttled_duplicate');
  });

  it('allows the same display again after the active display TTL expires', () => {
    const message = 'SpendSense\nPickup: 1.7 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'order-a',
      message,
      20_000,
      displayState('order-a', message, 1_000)
    );

    expect(decision.shouldShow).toBe(true);
    expect(decision.reason).toBe('display_updated_meaningful_change');
  });

  it('allows meaningful pickup distance changes through the display gate', () => {
    const previous = 'SpendSense\nPickup: 2.8 km\nTrip unavailable';
    const next = 'SpendSense\nPickup: 3.3 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'order-a',
      next,
      5_000,
      displayState('order-a', previous, 1_000)
    );

    expect(decision.shouldShow).toBe(true);
    expect(decision.reason).toBe('display_updated_meaningful_change');
  });

  it('allows a new order signature to bypass display throttling', () => {
    const message = 'SpendSense\nPickup: 2.8 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'order-b',
      message,
      2_000,
      displayState('order-a', message, 1_000)
    );

    expect(decision.shouldShow).toBe(true);
    expect(decision.reason).toBe('order_signature_changed');
  });

  it('allows a new pickup/drop/fare signature even with the same distance text', () => {
    const message = 'SpendSense\nPickup: 1.7 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'pickup=area-a|drop=area-b|fare=90',
      message,
      2_000,
      displayState('pickup=area-a|drop=area-c|fare=86', message, 1_000)
    );

    expect(decision.shouldShow).toBe(true);
    expect(decision.reason).toBe('order_signature_changed');
  });

  it('allows a meaningful pickup update from 1.7 km to 2.0 km', () => {
    const previous = 'SpendSense\nPickup: 1.7 km\nTrip unavailable';
    const next = 'SpendSense\nPickup: 2.0 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'order-a',
      next,
      2_000,
      displayState('order-a', previous, 1_000)
    );

    expect(decision.shouldShow).toBe(true);
    expect(decision.reason).toBe('display_updated_meaningful_change');
  });

  it('allows trip distance availability after a repeated geocode failure', () => {
    const previous = 'SpendSense\nPickup: 2.8 km\nTrip unavailable';
    const next = 'SpendSense\nPickup: 2.8 km\nTrip: 4.1 km';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'order-a',
      next,
      2_000,
      displayState('order-a', previous, 1_000)
    );

    expect(decision.shouldShow).toBe(true);
    expect(decision.reason).toBe('display_updated_meaningful_change');
  });

  it('first order display calls persistent native overlay update', async () => {
    const message = 'SpendSense calculating...';
    const result = __porterTestUtils.showActivePorterOverlay('order-native-a', message, 1_000);

    expect(result?.decision.shouldShow).toBe(true);
    await result?.displayPromise;

    expect(NativeModules.PorterModule.showOrUpdatePorterDistanceOverlay)
      .toHaveBeenCalledWith(message, 12_000);
    expect(NativeModules.PorterModule.showToastOverlay).not.toHaveBeenCalled();
  });

  it('same repeated order does not spam the persistent overlay', async () => {
    const message = 'SpendSense\nPickup: 1.7 km\nTrip unavailable';

    const first = __porterTestUtils.showActivePorterOverlay('order-native-b', message, 1_000);
    await first?.displayPromise;
    const repeat = __porterTestUtils.showActivePorterOverlay('order-native-b', message, 2_000);
    await repeat?.displayPromise;

    expect(NativeModules.PorterModule.showOrUpdatePorterDistanceOverlay).toHaveBeenCalledTimes(1);
    expect(repeat?.decision.shouldShow).toBe(false);
  });

  it('new signature updates the persistent overlay even with same display text', async () => {
    const message = 'SpendSense\nPickup: 1.7 km\nTrip unavailable';

    const first = __porterTestUtils.showActivePorterOverlay('pickup=a|drop=b|fare=86', message, 1_000);
    await first?.displayPromise;
    const second = __porterTestUtils.showActivePorterOverlay('pickup=c|drop=d|fare=86', message, 2_000);
    await second?.displayPromise;

    expect(NativeModules.PorterModule.showOrUpdatePorterDistanceOverlay).toHaveBeenCalledTimes(2);
    expect(second?.decision.reason).toBe('order_signature_changed');
  });

  it('meaningful pickup distance change updates the persistent overlay', async () => {
    const first = __porterTestUtils.showActivePorterOverlay(
      'order-native-c',
      'SpendSense\nPickup: 1.7 km\nTrip unavailable',
      1_000
    );
    await first?.displayPromise;

    const second = __porterTestUtils.showActivePorterOverlay(
      'order-native-c',
      'SpendSense\nPickup: 2.0 km\nTrip unavailable',
      2_000
    );
    await second?.displayPromise;

    expect(NativeModules.PorterModule.showOrUpdatePorterDistanceOverlay).toHaveBeenCalledTimes(2);
    expect(second?.decision.shouldShow).toBe(true);
  });

  it('falls back to toast when native overlay permission is missing', async () => {
    NativeModules.PorterModule.showOrUpdatePorterDistanceOverlay = jest.fn(() =>
      Promise.reject({ code: 'PERMISSION_DENIED' })
    );
    const message = 'SpendSense\nPickup: 1.7 km\nTrip unavailable';

    const result = __porterTestUtils.showActivePorterOverlay('order-native-d', message, 1_000);
    await result?.displayPromise;

    expect(NativeModules.PorterModule.showToastOverlay).toHaveBeenCalledWith(message);
    const stored = JSON.parse(await AsyncStorage.getItem('debug_porter_display_state') || '{}');
    expect(stored.transport).toBe('toast_fallback');
    expect(stored.detail).toBe('overlay_permission_missing');
  });

  it('does not store raw order signature text in overlay display debug state', async () => {
    const message = 'SpendSense\nPickup: 2.8 km\nTrip unavailable';
    const result = __porterTestUtils.showActivePorterOverlay(
      'Shop 12, CG Road, Navrangpura, Ahmedabad -> Tower B, SG Highway',
      message,
      1_000
    );
    await result?.displayPromise;

    const stored = await AsyncStorage.getItem('debug_porter_display_state');
    expect(stored).toContain('native_overlay');
    expect(stored).not.toContain('CG Road');
    expect(stored).not.toContain('SG Highway');
    expect(stored).not.toContain('Shop 12');
  });

  it('keeps visible overlay text free of raw address/customer/phone details', () => {
    const message = __porterTestUtils.buildCalculatedDistanceMessage(
      {
        toPickup: '2.8 km',
        tripDistance: '4.1 km',
        pickupSource: 'calculated',
        tripSource: 'calculated',
      },
      'Pickup 1.6 km away near Shop 12, CG Road, Rahul 9876543210',
      'Drop 4.1 km near Tower B, SG Highway'
    );

    expect(message).toBe('SpendSense\nPickup: 2.8 km\nTrip: 4.1 km');
    expect(message).not.toContain('CG Road');
    expect(message).not.toContain('SG Highway');
    expect(message).not.toContain('Rahul');
    expect(message).not.toContain('9876543210');
  });

  it('positions native overlay below the top fare area without blocking touches', () => {
    const source = fs.readFileSync(
      'android/app/src/main/java/com/spendsense/PorterModule.kt',
      'utf8'
    );

    expect(source).toContain('WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE');
    expect(source).toContain('WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE');
    expect(source).toContain('gravity = Gravity.TOP or Gravity.END');
    expect(source).toContain('y = dp(360f)');
    expect(source).toContain('maxWidth = dp(190f)');
    expect(source).toContain('overlay_repositioned_below_fare');
  });

  it('allows same-pickup calculating-to-geocode-failed follow-up so source labels update', () => {
    const previous = 'SpendSense calculating...';
    const next = 'SpendSense\nPickup: 1.7 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'order-a',
      next,
      2_000,
      displayState('order-a', previous, 1_000)
    );

    expect(decision.shouldShow).toBe(true);
    expect(decision.reason).toBe('display_updated_meaningful_change');
  });

  it('still allows a real trip distance after an immediate pickup-only display', () => {
    const previous = 'SpendSense calculating...';
    const next = 'SpendSense\nPickup: 1.7 km\nTrip: 5.2 km';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'order-a',
      next,
      2_000,
      displayState('order-a', previous, 1_000)
    );

    expect(decision.shouldShow).toBe(true);
    expect(decision.reason).toBe('display_updated_meaningful_change');
  });

  it('uses privacy-safe display debug reasons without raw address text', () => {
    const message = 'SpendSense\nPickup: 2.8 km\nTrip unavailable';
    const decision = __porterTestUtils.decidePorterOverlayDisplay(
      'Shop 12, CG Road, Navrangpura, Ahmedabad -> Tower B, SG Highway',
      message,
      5_000,
      displayState(
        'Shop 12, CG Road, Navrangpura, Ahmedabad -> Tower B, SG Highway',
        message,
        1_000
      )
    );

    const serialized = JSON.stringify(decision);
    expect(serialized).toContain('display_throttled_duplicate');
    expect(serialized).toContain('toast_quota_avoided');
    expect(serialized).not.toContain('CG Road');
    expect(serialized).not.toContain('SG Highway');
  });

  it('briefly skips duplicate trip processing while a pending calculation is fresh', () => {
    expect(
      __porterTestUtils.shouldSkipDuplicateTripProcessing(
        'order-a',
        'Pickup 1.7 km away',
        2_000,
        displayState('order-a', 'SpendSense calculating...', 1_000)
      )
    ).toBe(true);
  });

  it('does not let a stale pending calculating overlay skip trip processing forever', () => {
    expect(
      __porterTestUtils.shouldSkipDuplicateTripProcessing(
        'order-a',
        'Pickup 1.7 km away',
        5_000,
        displayState('order-a', 'SpendSense calculating...', 1_000)
      )
    ).toBe(false);
  });

  it('skips duplicate trip processing only after the real distance display is active', () => {
    expect(
      __porterTestUtils.shouldSkipDuplicateTripProcessing(
        'order-a',
        'Pickup 1.7 km away',
        2_000,
        displayState('order-a', 'SpendSense\nPickup: 1.7 km\nTrip unavailable', 1_000)
      )
    ).toBe(true);
  });

  it('allows duplicate trip processing again after the active display expires', () => {
    expect(
      __porterTestUtils.shouldSkipDuplicateTripProcessing(
        'order-a',
        'Pickup 1.7 km away',
        20_000,
        displayState('order-a', 'SpendSense\nPickup: 1.7 km\nTrip unavailable', 1_000)
      )
    ).toBe(false);
  });
});
