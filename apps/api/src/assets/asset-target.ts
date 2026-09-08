import { BadRequestException } from '@nestjs/common';
import { AssetType } from '@prisma/client';

export function normalizeAssetTarget(type: AssetType, rawValue: string) {
  const value = rawValue.trim().toLowerCase().replace(/\.$/, '');
  if (value.includes('/') || value.includes('://') || value.includes('@')) throw new BadRequestException('Assets must be hostnames or IP addresses, not URLs');
  if (type === AssetType.IP && !isPublicIpv4(value)) throw new BadRequestException('Private and local IP addresses are not allowed');
  if (type !== AssetType.IP && (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value) || value === 'localhost')) throw new BadRequestException('Invalid public hostname');
  return value;
}

export function isPublicIpv4(value: string) {
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first !== 10 && first !== 127 && !(first === 169 && second === 254) && !(first === 172 && second >= 16 && second <= 31) && !(first === 192 && second === 168) && first !== 0;
}
