# Gmail Integration Troubleshooting Guide

## Issue
Production environment cannot fetch emails from Google Business account, while development environment works correctly.

## Improvements Made

### Enhanced Error Logging
I've added comprehensive error logging throughout the Gmail integration to help diagnose production issues:

#### 1. **GmailService.createGmailClient()**
- Logs refresh token decryption attempts
- Logs OAuth2 credential setup
- Detailed error reporting with error codes and messages

#### 2. **GmailService.fetchNewEmails()**
- Logs the start of email fetch with parameters
- Logs query construction and execution
- Logs message count found
- Individual message fetch error handling (continues with other messages on failure)
- Specific error categorization:
  - **401/403**: Authentication/Authorization errors (invalid or expired refresh token)
  - **429**: Rate limiting errors
  - **5xx**: Google API server errors

#### 3. **SyncScheduler.syncGmail()**
- Logs each user being synced with their Gmail address
- Logs last sync timestamp
- Per-user error handling with detailed diagnostics
- Continues syncing other users even if one fails

## What to Check in Production Logs

### 1. Look for Gmail-related errors
```bash
# Search for Gmail errors in production logs
grep -i "\[gmail\]" production.log
grep -i "\[sync-scheduler\].*gmail" production.log
```

### 2. Common Error Patterns

#### **Invalid Refresh Token (401/403)**
```
[Gmail] Authentication/Authorization error - refresh token may be invalid or expired
```
**Solution**: The user needs to disconnect and reconnect their Gmail account in production to get a new refresh token.

#### **Rate Limiting (429)**
```
[Gmail] Rate limit exceeded - too many requests to Gmail API
```
**Solution**: Reduce sync frequency or implement exponential backoff.

#### **Decryption Errors**
```
[Gmail] Error creating Gmail client: { message: "..." }
```
**Solution**: Check that `CREDENTIAL_ENCRYPTION_KEY` environment variable is set correctly in production and matches the key used to encrypt the stored refresh tokens.

#### **Google API Errors (5xx)**
```
[Gmail] Gmail API server error - temporary issue with Google servers
```
**Solution**: Temporary issue - will resolve on retry.

### 3. Environment Variable Checklist

Verify these are set in production:
- ✅ `GOOGLE_OAUTH_CLIENT_ID`
- ✅ `GOOGLE_OAUTH_CLIENT_SECRET`
- ✅ `CREDENTIAL_ENCRYPTION_KEY` (32 bytes, hex-encoded)
- ✅ `REPLIT_DOMAINS` (includes both hcpcrm.com and hcpcrm.replit.app)

### 4. Google Business Account Specific Issues

Google Business (Workspace) accounts may have additional restrictions:

1. **Domain-wide delegation**: Some organizations require domain-wide delegation for API access
2. **Admin restrictions**: IT admins may have disabled OAuth for third-party apps
3. **API access**: Gmail API might be disabled in the Google Workspace admin console

**To verify**:
- Check with the Google Workspace admin if Gmail API is enabled
- Verify OAuth is allowed for third-party applications
- Check if the user has permission to grant OAuth access

## Testing Steps

1. **Deploy these logging improvements to production**
2. **Trigger a Gmail sync manually** or wait for the next scheduled sync
3. **Check production logs** for detailed error messages
4. **Based on the error code**, follow the appropriate solution above

## Next Steps

Once deployed, the enhanced logging will reveal exactly what's failing:
- If it's a 401/403, the user needs to reconnect Gmail
- If it's a decryption error, check environment variables
- If it's a Google Workspace restriction, contact the IT admin
- If messages are found but individual fetches fail, it may be a permission issue

The logs will now provide the specific error codes and messages needed to diagnose and fix the issue.
