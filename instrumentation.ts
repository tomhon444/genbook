export async function register() {
  if (process.env.NODE_ENV === 'production' &&
    (process.env.AUTH_PROVIDER === 'local' || process.env.LOCAL_IDENTITY_URL || process.env.LOCAL_IDENTITY_SECRET)) {
    throw new Error('Local identity configuration is forbidden in production');
  }
}
