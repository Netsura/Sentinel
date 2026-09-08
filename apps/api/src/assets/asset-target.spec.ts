import { AssetType } from '@prisma/client';
import { normalizeAssetTarget } from './asset-target';

describe('normalizeAssetTarget', () => {
  it('normalizes a public hostname', () => {
    expect(normalizeAssetTarget(AssetType.DOMAIN, 'Example.com.')).toBe('example.com');
  });

  it.each(['http://example.com', 'localhost', '127.0.0.1', '192.168.1.4'])('rejects unsafe target %s', (target) => {
    expect(() => normalizeAssetTarget(AssetType.IP, target)).toThrow();
  });

  it('rejects URL input for hostname assets', () => {
    expect(() => normalizeAssetTarget(AssetType.DOMAIN, 'https://example.com')).toThrow();
  });
});