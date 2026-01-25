import { registerAs } from '@nestjs/config';

export default registerAs('oauth', () => ({
  meta: {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    redirectUri: process.env.META_REDIRECT_URI,
    oauthUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    graphApiVersion: 'v21.0',
    scopes: [
      // Basic permissions
      'public_profile',
      'email',
      
      // Facebook Pages permissions
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_metadata',
      'pages_messaging',
      'pages_manage_posts',
      
      // Instagram permissions
      'instagram_basic',
      'instagram_manage_messages',
      'instagram_manage_comments',
      
      // WhatsApp Business permissions
      'whatsapp_business_management',
      'whatsapp_business_messaging',
      
      // Business Management (required for some features)
      'business_management',
    ],
  },
}));
