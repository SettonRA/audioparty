# Nginx Proxy Manager Configuration for AudioParty

This guide shows how to add AudioParty to your existing Nginx Proxy Manager (Proxy01) setup.

---

## Prerequisites

- AudioParty is running at `YOUR_SERVER_IP:3000`
- Access to Nginx Proxy Manager web interface
- Wildcard SSL certificate configured for your domain

---

## Step 1: Choose Your Domain

Pick one of these options based on your existing wildcard certificates:

Choose a subdomain for your AudioParty installation:

- **Example:** `party.yourdomain.com` or `audioparty.yourdomain.com`
- **Requirement:** Must match your existing wildcard SSL certificate
- **Recommendation:** Keep it consistent with your other services

**For this guide, we'll use `party.yourdomain.com` as an example**

---

## Step 2: Add Proxy Host in NPM

### Access NPM:
1. Navigate to: `https://proxy.tech-ra.net`
2. Login with your credentials

### Create Proxy Host:
1. Click **"Hosts"** in the top menu
2. Click **"Proxy Hosts"**
3. Click **"Add Proxy Host"** button

---

## Step 3: Configure Details Tab

Fill in the following:

### Domain Names:
```
party.yourdomain.com
```

### Forward Settings:
- **Scheme:** `http` (AudioParty doesn't have SSL internally)
- **Forward Hostname / IP:** `YOUR_SERVER_IP`
- **Forward Port:** `3000`

### Options (Check these boxes):
- ☑ **Cache Assets** - Improve performance for CSS/JS
- ☑ **Block Common Exploits** - Security protection
- ☑ **Websockets Support** - **CRITICAL for Socket.io!**

### Advanced (Optional):
Leave blank or add custom configuration if needed.

**Click "Save" or move to SSL tab**

---

## Step 4: Configure SSL Tab

### SSL Certificate:
- **SSL Certificate:** Select your existing wildcard certificate
  - Look for: `*.yourdomain.com` in the dropdown
  - Verify the expiry date is valid

### SSL Options (Check these boxes):
- ☑ **Force SSL** - Redirect HTTP to HTTPS
- ☑ **HTTP/2 Support** - Better performance
- ☑ **HSTS Enabled** - Force HTTPS in browsers
  - HSTS Subdomains: Leave unchecked

### Advanced SSL:
Leave default unless you have specific requirements.

**Click "Save"**

---

## Step 5: Verify Configuration

### Test Internal Access:
From any machine on your network:
```bash
curl -I http://YOUR_SERVER_IP:3000
```
Should return: `200 OK` with HTML content

### Test Proxy Access (HTTP):
```bash
curl -I http://party.yourdomain.com
```
Should redirect to HTTPS (301 or 302)

### Test Proxy Access (HTTPS):
```bash
curl -I https://party.yourdomain.com
```
Should return: `200 OK`

### Test in Browser:
1. Navigate to: `https://party.yourdomain.com`
2. You should see the AudioParty landing page
3. Check browser console (F12) - no errors
4. SSL certificate should be valid (green lock icon)

---

## Step 6: Test WebSocket Connection

WebSockets are **critical** for AudioParty to function!

### Browser Test:
1. Open `https://party.yourdomain.com`
2. Open browser Developer Tools (F12)
3. Go to **Console** tab
4. Click **"Host a Party"**
5. Look for Socket.io connection messages:
   ```
   Socket.io: Connection established
   Room created: XXXXXX
   ```

### If WebSocket Fails:
- Go back to NPM → Edit proxy host
- **Details tab** → Verify **"Websockets Support"** is checked
- Save and test again

---

## Step 7: Update DNS (If Using Public Access)

If you want external access (outside your home network):

### Internal DNS:
If using internal DNS (PiHole, AdGuard, etc.):

- Add local DNS record:
  - Domain: `party.yourdomain.com`
  - IP: `YOUR_PROXY_IP`

### External DNS:
1. Login to your DNS provider (Cloudflare, Route53, etc.)
2. Select your domain
3. Add DNS record:
   - **Type:** `A`
   - **Name:** `party`
   - **IPv4 address:** `YOUR_PUBLIC_IP`
   - **Proxy status:** Proxied (if using Cloudflare)
   - **TTL:** Auto

**Note:** Ensure your router forwards ports 80/443 to your proxy server

---

## Step 8: Firewall & Security

### NPM Access List (Optional - Recommended for Private Use):

If you want to restrict access to trusted IPs:

1. In NPM, go to **"Access Lists"**
2. Click **"Add Access List"**
3. Configure:
   - Name: `AudioParty - Local Network Only`
   - **Satisfy Any:** No
   - **Pass Auth:** No
   
4. **Authorization** tab:
   - Add allowed IPs:
     - `YOUR_NETWORK/24` (your local network)
     - Or specific IPs of trusted users

5. **Access** tab:
   - Add any additional restrictions

6. Go back to your proxy host
7. **Details** tab → **Access List:** Select the list you created
8. Save

### Cloudflare Security (If Using):
- Set Security Level to "Medium" or "High"
- Enable "Under Attack Mode" if needed
- Add firewall rules to limit countries/IPs

---

## Troubleshooting

### Issue: Can't connect to party.cineclark.studio

**Check:**
```bash
# Test DNS resolution
nslookup party.cineclark.studio

# Should resolve to 192.168.1.110 (internal) or 104.37.251.37 (external)
```

**Fix:**
- Add DNS record in PiHole for internal access
- Add DNS record in Cloudflare for external access

---

### Issue: WebSocket connection failed

**Symptoms:** Can load page but can't create/join rooms

**Check NPM Configuration:**
1. Edit proxy host
2. Details tab → Verify **"Websockets Support"** is ☑ checked
3. Save

**Check AudioParty logs:**
```bash
ssh serveradmin@192.168.1.111
cd ~/audioparty
docker compose logs -f
```

---

### Issue: SSL certificate invalid

**Check:**
- NPM → SSL Certificates → Verify wildcard cert is valid
- If expired, renew certificate
- Reselect certificate in proxy host configuration

---

### Issue: 502 Bad Gateway

**Causes:**
- AudioParty container is not running
- Wrong IP/port in NPM configuration
- Firewall blocking connection

**Check:**
```bash
# On AudioParty VM
docker compose ps  # Should show "running"
curl http://localhost:3000  # Should return HTML
```

**On Proxy01:**
```bash
# Test connection to AudioParty
curl http://192.168.1.111:3000
```

---

## Summary of Configuration

### Proxy Host Settings:
| Setting | Value |
|---------|-------|
| **Domain** | party.cineclark.studio |
| **Scheme** | http |
| **Forward IP** | 192.168.1.111 |
| **Forward Port** | 3000 |
| **Websockets** | ☑ Enabled |
| **SSL Certificate** | *.cineclark.studio |
| **Force SSL** | ☑ Yes |

### Network Flow:
```
User Browser (HTTPS)
    ↓
https://party.cineclark.studio
    ↓
Nginx Proxy Manager (192.168.1.110:443)
    ↓ (WebSocket upgrade)
    ↓ (HTTP internally)
AudioParty VM (192.168.1.111:3000)
    ↓
Docker Container (audioparty)
```

---

## Access Summary

### Internal Network Access:
- **Direct:** http://192.168.1.111:3000
- **Via Proxy:** https://party.cineclark.studio

### External Access (If Configured):
- **Public URL:** https://party.cineclark.studio
- **Requires:** DNS record + port forwarding (already setup)

### Admin Access:
- **NPM:** https://proxy.tech-ra.net
- **AudioParty SSH:** `ssh serveradmin@192.168.1.111`

---

## Next Steps

1. ✅ Proxy host created in NPM
2. ✅ SSL configured with wildcard cert
3. ✅ WebSocket support enabled
4. ✅ Test access from browser
5. ✅ Add DNS records (if needed)
6. 🎉 Share link with friends and start a party!

---

**Your AudioParty is now accessible at:**
# 🎵 https://party.cineclark.studio

Share this link with friends to invite them to your listening parties!
