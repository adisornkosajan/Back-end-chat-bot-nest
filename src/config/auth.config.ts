export default () => ({
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: '7d', // เปลี่ยนจาก 15m เป็น 7 วัน
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_REFRESH_EXPIRES_IN: '30d',
});
