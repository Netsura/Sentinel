export function jwtAccessSecret() {
  const secret = process.env.JWT_ACCESS_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_ACCESS_SECRET is required in production');
  }
  return 'sentinel-development-access-secret';
}
