import { describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/valid-trip.json';
import type { Quest } from '../../src/protocol/schema';
import {
  haversineMeters,
  mapUrls,
  reliableDistance,
  requestPosition,
} from '../../src/domain/navigation';

const location = fixture.quests[0].location as Quest['location'];

describe('受控地图入口', () => {
  it('中文与 & 只作为编码关键词，高德无坐标也不泄露故事或起点', () => {
    const urls = mapUrls({
      ...location,
      query: '中国 北京 A&B <地方>',
      address: '东路 12号 & 南门',
      latitude: 0,
      longitude: 0,
      coordinateSourceId: 'source',
    });
    const google = new URL(urls.google);
    const apple = new URL(urls.apple);
    const amap = new URL(urls.amap);
    const keyword = '中国 北京 A&B <地方> 东路 12号 & 南门';
    expect(google.origin).toBe('https://www.google.com');
    expect(google.searchParams.get('query')).toBe(keyword);
    expect(google.searchParams.get('api')).toBe('1');
    expect(apple.searchParams.get('q')).toBe(keyword);
    expect(amap.searchParams.get('keyword')).toBe(keyword);
    expect([...amap.searchParams.keys()]).toEqual([
      'keyword',
      'src',
      'callnative',
    ]);
    expect(urls.amap).not.toContain('center=');
    expect(mapUrls(location).google).toContain(
      'https://www.google.com/maps/search/',
    );
  });

  it('零经纬度合法，距离为直线；无来源坐标不计算', () => {
    expect(
      haversineMeters(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ),
    ).toBe(0);
    expect(
      haversineMeters(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ),
    ).toBeCloseTo(111_195, 0);
    expect(
      reliableDistance(location, { latitude: 0, longitude: 0 }),
    ).toBeNull();
    expect(
      reliableDistance(
        { ...location, latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ),
    ).toBeNull();
    expect(
      reliableDistance(
        {
          ...location,
          latitude: 0,
          longitude: 0,
          coordinateSourceId: 'source',
        },
        { latitude: 0, longitude: 0 },
      ),
    ).toBe(0);
    expect(() =>
      haversineMeters(
        { latitude: 91, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ),
    ).toThrow('有效范围');
  });
});

describe('按需单次定位', () => {
  it('仅显式调用时请求定位，返回时间精度，不持续监听', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({
        coords: { latitude: 0, longitude: 0, accuracy: 12 },
        timestamp: 1_700_000_000_000,
      } as GeolocationPosition),
    );
    const watchPosition = vi.fn();
    const api = { getCurrentPosition, watchPosition, clearWatch: vi.fn() };
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(await requestPosition(api)).toEqual({
      latitude: 0,
      longitude: 0,
      accuracy: 12,
      timestamp: 1_700_000_000_000,
    });
    expect(getCurrentPosition.mock.calls[0][0]).toEqual(expect.any(Function));
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { timeout: 10_000, maximumAge: 30_000, enableHighAccuracy: false },
    );
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ] as const)('定位错误 %s 转中文且无自动重试', async (code, expected) => {
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, failure?: PositionErrorCallback | null) =>
        failure?.({ code } as GeolocationPositionError),
    );
    await expect(
      requestPosition({
        getCurrentPosition,
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: expected });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('无 API 或异常坐标均可恢复地报错', async () => {
    await expect(requestPosition(undefined)).rejects.toMatchObject({
      code: 'unsupported',
    });
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({
        coords: { latitude: NaN, longitude: 0, accuracy: 1 },
        timestamp: Date.now(),
      } as GeolocationPosition),
    );
    await expect(
      requestPosition({
        getCurrentPosition,
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});
