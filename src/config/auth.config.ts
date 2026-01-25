export default () => ({
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_REFRESH_EXPIRES_IN: '7d',
});
