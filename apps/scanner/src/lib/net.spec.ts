import { isIpLiteral, isPrivateAddress, sameHost, withTimeout } from './net';

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.1',
    '10.255.255.255',
    '127.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.0.1', '192.167.1.1', '2606:4700::1111'])(
    'treats %s as public',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it('rejects malformed addresses rather than allowing them through', () => {
    expect(isPrivateAddress('999.1.1.1')).toBe(true);
    expect(isPrivateAddress('1.2.3')).toBe(true);
    expect(isPrivateAddress('not-an-address')).toBe(true);
  });

  it('blocks the cloud metadata address', () => {
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
  });
});

describe('isIpLiteral', () => {
  it('detects IPv4 and IPv6 literals', () => {
    expect(isIpLiteral('8.8.8.8')).toBe(true);
    expect(isIpLiteral('2606:4700::1111')).toBe(true);
  });

  it('does not treat hostnames as literals', () => {
    expect(isIpLiteral('example.com')).toBe(false);
  });
});

describe('withTimeout', () => {
  it('rejects when the promise does not settle in time', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'timed out')).rejects.toThrow('timed out');
  });
});

describe('sameHost', () => {
  it('matches regardless of scheme and case', () => {
    expect(sameHost('https://Example.com/path', 'example.com')).toBe(true);
  });

  it('rejects other hosts and malformed URLs', () => {
    expect(sameHost('https://evil.com/', 'example.com')).toBe(false);
    expect(sameHost('/relative', 'example.com')).toBe(false);
  });
});
