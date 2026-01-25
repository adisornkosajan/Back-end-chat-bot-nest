# Meta Platform API Configuration (2025-2026)

## Environment Variables
```env
# Meta App Credentials
META_APP_ID=your_app_id_here
META_APP_SECRET=your_app_secret_here
META_REDIRECT_URI=https://yourdomain.com/api/auth/oauth/callback
META_WEBHOOK_VERIFY_TOKEN=your_secure_random_token_here

# Database
DATABASE_URL="mysql://user:password@localhost:3306/omnichat"

# JWT
JWT_SECRET=your_jwt_secret_here

# Server
PORT=3001
CORS_ORIGIN=http://localhost:3000
```

## Meta App Setup (developers.facebook.com)

### 1. Create App
- App Type: **Business**
- Use Case: **Customer Communication**

### 2. Add Products
- ✅ Facebook Login
- ✅ Instagram Messaging API (NOT Basic Display)
- ✅ WhatsApp Business API

### 3. App Settings
**Basic Settings:**
- App ID: Copy to `META_APP_ID`
- App Secret: Copy to `META_APP_SECRET`
- App Domains: `yourdomain.com`
- Privacy Policy URL: Required
- Terms of Service URL: Required

### 4. Facebook Login Settings
**Valid OAuth Redirect URIs:**
```
https://yourdomain.com/api/auth/oauth/callback
http://localhost:3001/api/auth/oauth/callback (for testing)
```

### 5. Webhook Configuration

**Webhook URLs:**
- Facebook: `https://yourdomain.com/api/webhooks/facebook`
- Instagram: `https://yourdomain.com/api/webhooks/instagram`
- WhatsApp: `https://yourdomain.com/api/webhooks/whatsapp`
- Unified (All): `https://yourdomain.com/api/webhooks/meta`

**Verify Token:** Use `META_WEBHOOK_VERIFY_TOKEN`

**Facebook Webhook Fields to Subscribe:**
- ✅ messages
- ✅ messaging_postbacks
- ✅ messaging_optins
- ✅ messaging_referrals
- ✅ message_deliveries
- ✅ message_reads

**Instagram Webhook Fields to Subscribe:**
- ✅ messages
- ✅ messaging_postbacks
- ✅ messaging_optins
- ✅ messaging_referrals
- ✅ comments (optional)
- ✅ mentions (optional)

**WhatsApp Webhook Fields to Subscribe:**
- ✅ messages
- ✅ message_status
- ✅ message_template_status_update (optional)

### 6. Permissions Required

**App Review Required Permissions:**
- `pages_messaging` - Send/receive messages on Facebook Pages
- `instagram_manage_messages` - Send/receive Instagram DMs
- `instagram_basic` - Access basic Instagram account info
- `whatsapp_business_messaging` - Send/receive WhatsApp messages
- `whatsapp_business_management` - Manage WhatsApp Business account

**Standard Permissions (No Review):**
- `public_profile`
- `email`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_metadata`

### 7. Test Users & Development Mode
- Add test users for development
- Enable "Development Mode" until ready for production
- Switch to "Live Mode" after App Review approval

## API Versions Used

- **Graph API:** v21.0
- **Webhook API:** v21.0
- **Instagram Messaging API:** v21.0
- **WhatsApp Business Platform:** v21.0

## Token Types

### User Access Token
- Short-lived: 1-2 hours
- Automatically exchanged for long-lived token (60 days)

### Page Access Token
- Obtained per Page
- Never expires (if permissions don't change)
- Stored in database per platform

### Instagram Access Token
- Same as Page access token
- Tied to Facebook Page

### WhatsApp Access Token
- System User Token (permanent)
- Requires WhatsApp Business Account setup

## Rate Limits (2025-2026)

### Messaging
- Facebook: 200 messages per second per page
- Instagram: 100 messages per second per account
- WhatsApp: Based on tier (1K-100K+ per day)

### Graph API
- 200 calls per hour per user per app
- 4,800 calls per hour for page-level calls

## Important Notes

1. **Instagram requires Business Account** - Personal accounts won't work
2. **WhatsApp requires Business verification** - Takes 1-3 weeks
3. **App Review required for production** - Submit after testing
4. **Webhooks require HTTPS** - Use ngrok for local testing
5. **Keep tokens secure** - Never commit to git

## Testing with ngrok

```bash
# Install ngrok
npm install -g ngrok

# Start your backend
npm run start:dev

# In another terminal, expose port 3001
ngrok http 3001

# Use the https URL for webhook configuration
# Example: https://abc123.ngrok.io/api/webhooks/facebook
```

## Production Checklist

- [ ] Switch Meta app to Live Mode
- [ ] Get App Review approval for required permissions
- [ ] Use production domain (HTTPS required)
- [ ] Configure proper webhook URLs
- [ ] Set up monitoring and logging
- [ ] Implement rate limit handling
- [ ] Add webhook signature verification
- [ ] Set up error alerting
- [ ] Test with real users
- [ ] Comply with Meta Platform Policies

## Support & Documentation

- [Meta for Developers](https://developers.facebook.com/)
- [Graph API Documentation](https://developers.facebook.com/docs/graph-api)
- [Instagram Messaging API](https://developers.facebook.com/docs/instagram-api/guides/messaging)
- [WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp)
- [Webhook Reference](https://developers.facebook.com/docs/graph-api/webhooks)
