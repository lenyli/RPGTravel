import type { Quest } from '../protocol/schema';

export type Coordinates = { latitude: number; longitude: number };
export type LocatedPosition = Coordinates & {
  accuracy: number;
  timestamp: number;
};
export type MapProvider = 'amap' | 'apple' | 'google';

export function sourceHref(value: string): string | undefined {
  // Imported source text stays unchanged; only derive a browser link for display.
  const raw = value.trim();
  const markdown = raw.match(/^\[[^\]\r\n]*\]\(([\s\S]*)\)$/);
  const target = (markdown?.[1] ?? raw).replace(/^<([^<>]*)>$/, '$1');
  if (/[\u0000-\u001f\u007f]/.test(target)) return;
  try {
    const url = new URL(target);
    if (['http:', 'https:'].includes(url.protocol) && url.hostname)
      return url.href;
  } catch {
    // Unrecognized addresses are still shown as their original text.
  }
}

export function mapUrls(
  location: Quest['location'],
): Record<MapProvider, string> {
  const search = `${location.query} ${location.address}`.trim();
  const google = new URL('https://www.google.com/maps/search/');
  google.searchParams.set('api', '1');
  google.searchParams.set('query', search);
  const apple = new URL('https://maps.apple.com/');
  apple.searchParams.set('q', search);
  const amap = new URL('https://uri.amap.com/search');
  amap.searchParams.set('keyword', search);
  amap.searchParams.set('src', 'rpg_trip');
  amap.searchParams.set('callnative', '1');
  return { google: google.href, apple: apple.href, amap: amap.href };
}

function validCoordinates(value: Coordinates) {
  return (
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

export function haversineMeters(from: Coordinates, to: Coordinates): number {
  if (!validCoordinates(from) || !validCoordinates(to))
    throw new Error('坐标不在有效范围内，无法计算距离。');
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = radians(to.latitude - from.latitude);
  const deltaLon = radians(to.longitude - from.longitude);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(deltaLon / 2) ** 2;
  return (
    6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, value))))
  );
}

export function reliableDistance(
  location: Quest['location'],
  position: Coordinates,
): number | null {
  if (
    location.latitude === null ||
    location.longitude === null ||
    location.coordinateSystem !== 'WGS84' ||
    !location.coordinateSourceId ||
    !validCoordinates(position)
  )
    return null;
  return haversineMeters(position, {
    latitude: location.latitude,
    longitude: location.longitude,
  });
}

export class LocationError extends Error {
  code: 'denied' | 'unavailable' | 'timeout' | 'unsupported';
  constructor(code: LocationError['code'], message: string) {
    super(message);
    this.name = 'LocationError';
    this.code = code;
  }
}

export function requestPosition(
  geolocation = typeof navigator === 'undefined'
    ? undefined
    : navigator.geolocation,
): Promise<LocatedPosition> {
  return new Promise((resolve, reject) => {
    if (!geolocation) {
      reject(
        new LocationError(
          'unsupported',
          '当前浏览器不支持定位。你仍可打开地图、手动开始和完成任务。',
        ),
      );
      return;
    }
    try {
      geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (
            !validCoordinates({ latitude, longitude }) ||
            !Number.isFinite(accuracy) ||
            accuracy < 0 ||
            !Number.isFinite(position.timestamp)
          ) {
            reject(
              new LocationError(
                'unavailable',
                '未取得有效位置。请稍后重试；定位不会影响任务推进。',
              ),
            );
            return;
          }
          resolve({
            latitude,
            longitude,
            accuracy,
            timestamp: position.timestamp,
          });
        },
        (error) => {
          if (error.code === 1)
            reject(
              new LocationError(
                'denied',
                '定位权限未允许。你仍可打开地图、手动开始和完成任务。',
              ),
            );
          else if (error.code === 3)
            reject(
              new LocationError(
                'timeout',
                '定位超时。可稍后重试，或直接手动开始任务。',
              ),
            );
          else
            reject(
              new LocationError(
                'unavailable',
                '暂时无法取得位置。你仍可查看地址并继续任务。',
              ),
            );
        },
        { timeout: 10_000, maximumAge: 30_000, enableHighAccuracy: false },
      );
    } catch {
      reject(
        new LocationError(
          'unavailable',
          '当前环境无法请求定位。请检查浏览器权限；手动任务仍可使用。',
        ),
      );
    }
  });
}
