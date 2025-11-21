# Nginx Proxy Manager Configuration for AudioParty

This guide shows how to add AudioParty to your existing Nginx Proxy Manager (Proxy01) setup.

---

## Prerequisites

- AudioParty VM is running at `192.168.1.111:3000`
- Access to Nginx Proxy Manager at `https://proxy.tech-ra.net`
- Wildcard SSL certificate already configured for `*.cineclark.studio` or `*.tech-ra.net`

---

## Step 1: Choose Your Domain

Pick one of these options based on your existing wildcard certificates:

### Option A: cineclark.studio subdomain (Recommended)
- **Domain:** `party.cineclark.studio`
- **Uses:** Existing `*.cineclark.studio` wildcard cert
- **Consistent with:** Your other media services (emby, library, etc.)

### Option B: tech-ra.net subdomain
- **Domain:** `audioparty.tech-ra.net`
- **Uses:** Existing `*.tech-ra.net` wildcard cert
- **Consistent with:** Your infrastructure services (proxy, wow, dns)

**For this guide, we'll use `party.cineclark.studio`**

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
party.cineclark.studio
```

### Forward Settings:
- **Scheme:** `http` (AudioParty doesn't have SSL internally)
- **Forward Hostname / IP:** `192.168.1.111`
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
  - Look for: `*.cineclark.studio` in the dropdown
  - Should show expiry date: February 17, 2026

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
curl -I http://192.168.1.111:3000
```
Should return: `200 OK` with HTML content

### Test Proxy Access (HTTP):
```bash
curl -I http://party.cineclark.studio
```
Should redirect to HTTPS (301 or 302)

### Test Proxy Access (HTTPS):
```bash
curl -I https://party.cineclark.studio
```
Should return: `200 OK`

### Test in Browser:
1. Navigate to: `https://party.cineclark.studio`
2. You should see the AudioParty landing page
3. Check browser console (F12) - no errors
4. SSL certificate should be valid (green lock icon)

---

## Step 6: Test WebSocket Connection

WebSockets are **critical** for AudioParty to function!

### Browser Test:
1. Open `https://party.cineclark.studio`
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

### Internal DNS Only (via PiHole):
Your PiHole (192.168.1.8) should already resolve `*.cineclark.studio` to Proxy01.

If not, add local DNS record in PiHole:
- Domain: `party.cineclark.studio`
- IP: `192.168.1.110` (Proxy01)

### External DNS (via Cloudflare):
1. Login to Cloudflare
2. Select `cineclark.studio` domain
3. Add DNS record:
   - **Type:** `A`
   - **Name:** `party`
   - **IPv4 address:** `104.37.251.37` (your public IP)
   - **Proxy status:** ☑ Proxied (orange cloud)
   - **TTL:** Auto

**Note:** Your router already forwards ports 80/443 to Proxy01 (192.168.1.110)

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
     - `192.168.1.0/24` (your home network)
     - Or specific IPs of friends

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
