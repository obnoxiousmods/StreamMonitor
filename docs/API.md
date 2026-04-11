# API Reference

**Base URL:** `https://monitor.obby.ca`

StreamMonitor exposes a JSON REST API for querying service health, statistics, logs, system metrics, and administration. All responses are `application/json` unless otherwise noted.

---

## Table of Contents

- [Authentication](#authentication)
- [Error Responses](#error-responses)
- [Public Endpoints (No Auth)](#public-endpoints-no-auth)
  - [GET /api/ping](#get-apiping)
  - [GET /api/public](#get-apipublic)
  - [GET /speedtest/download](#get-speedtestdownload)
- [Authenticated Endpoints](#authenticated-endpoints)
  - [POST /login](#post-login)
  - [GET /logout](#get-logout)
  - [GET /api/status](#get-apistatus)
  - [GET /api/status/{service\_id}](#get-apistatusservice_id)
  - [GET /api/stats](#get-apistats)
  - [GET /api/stats/{service\_id}](#get-apistatsservice_id)
  - [GET /api/versions](#get-apiversions)
  - [GET /api/logs/{unit}](#get-apilogsunit)
  - [GET /api/dmesg](#get-apidmesg)
  - [GET /api/processes](#get-apiprocesses)
  - [GET /api/jellyfin](#get-apijellyfin)
  - [GET /api/benchmark](#get-apibenchmark)
  - [GET /api/errors](#get-apierrors)
  - [DELETE /api/errors](#delete-apierrors)
  - [POST /api/errors/scan](#post-apierrorsscan)
  - [POST /api/service/{unit}/{action}](#post-apiserviceunitaction)
  - [POST /api/perms/scan](#post-apipermsscan)
  - [POST /api/perms/fix](#post-apipermsfix)
  - [GET /api/settings/keys](#get-apisettingskeys)
  - [POST /api/settings/keys](#post-apisettingskeys)
  - [GET /api/settings/urls](#get-apisettingsurls)
  - [POST /api/settings/urls](#post-apisettingsurls)
  - [POST /api/settings/password](#post-apisettingspassword)
  - [GET /api/aiostreams/analyze](#get-apiaiostreamsanalyze)
  - [POST /api/aiostreams/test](#post-apiaiostreamstest)
  - [GET /api/mediafusion/metrics](#get-apimediafusionmetrics)
  - [GET /api/mediafusion/analyze](#get-apimediafusionanalyze)

---

## Authentication

Most endpoints require a valid session cookie issued by `POST /login`. Sessions are HTTP-only cookies that expire after 24 hours.

**Login flow:**

```
POST /login
Content-Type: application/x-www-form-urlencoded

username=admin&password=yourpassword
```

On success the server responds with `303 See Other` to `/` and sets a `Set-Cookie: session=...` header. Include that cookie on all subsequent authenticated requests.

**Unauthenticated API requests** return:

```json
{"error": "Unauthorized"}
```

with HTTP **401**.

### Code examples — login & session

<details>
<summary><strong>curl</strong></summary>

```bash
# Save cookie jar to file
curl -c cookies.txt -X POST https://monitor.obby.ca/login \
  -d "username=admin&password=yourpassword"

# Use saved cookies on subsequent requests
curl -b cookies.txt https://monitor.obby.ca/api/status
```

</details>

<details>
<summary><strong>Python (requests)</strong></summary>

```python
import requests

BASE = "https://monitor.obby.ca"
session = requests.Session()

resp = session.post(f"{BASE}/login", data={"username": "admin", "password": "yourpassword"})
resp.raise_for_status()

# Session cookie is stored automatically — just keep using `session`
status = session.get(f"{BASE}/api/status").json()
print(status)
```

</details>

<details>
<summary><strong>Python (httpx + async)</strong></summary>

```python
import asyncio
import httpx

BASE = "https://monitor.obby.ca"

async def main():
    async with httpx.AsyncClient(base_url=BASE, follow_redirects=False) as client:
        r = await client.post("/login", data={"username": "admin", "password": "yourpassword"})
        # The session cookie is stored in client.cookies automatically

        status = await client.get("/api/status")
        print(status.json())

asyncio.run(main())
```

</details>

<details>
<summary><strong>JavaScript (fetch, browser)</strong></summary>

```js
// In a browser context — cookies are sent automatically after login
await fetch("https://monitor.obby.ca/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "username=admin&password=yourpassword",
});

const status = await fetch("https://monitor.obby.ca/api/status", {
  credentials: "include",
}).then(r => r.json());
```

</details>

<details>
<summary><strong>JavaScript (Node.js / got)</strong></summary>

```js
import got from "got";
import { CookieJar } from "tough-cookie";

const cookieJar = new CookieJar();
const BASE = "https://monitor.obby.ca";

await got.post(`${BASE}/login`, {
  form: { username: "admin", password: "yourpassword" },
  cookieJar,
  followRedirect: false,
});

const status = await got(`${BASE}/api/status`, { cookieJar }).json();
console.log(status);
```

</details>

<details>
<summary><strong>Go</strong></summary>

```go
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "net/http/cookiejar"
    "net/url"
    "strings"
)

func main() {
    jar, _ := cookiejar.New(nil)
    client := &http.Client{Jar: jar, CheckRedirect: func(req *http.Request, via []*http.Request) error {
        return http.ErrUseLastResponse
    }}

    base := "https://monitor.obby.ca"

    resp, _ := client.PostForm(base+"/login", url.Values{
        "username": {"admin"},
        "password": {"yourpassword"},
    })
    resp.Body.Close()

    r, _ := client.Get(base + "/api/status")
    defer r.Body.Close()

    var result map[string]any
    json.NewDecoder(r.Body).Decode(&result)
    fmt.Println(result)
    _ = strings.NewReader("") // suppress unused import
}
```

</details>

<details>
<summary><strong>PHP</strong></summary>

```php
<?php
$base = "https://monitor.obby.ca";
$cookieFile = tempnam(sys_get_temp_dir(), "monitor_cookie");

// Login
$ch = curl_init("$base/login");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => "username=admin&password=yourpassword",
    CURLOPT_COOKIEJAR => $cookieFile,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
]);
curl_exec($ch);
curl_close($ch);

// Authenticated request
$ch = curl_init("$base/api/status");
curl_setopt_array($ch, [
    CURLOPT_COOKIEFILE => $cookieFile,
    CURLOPT_RETURNTRANSFER => true,
]);
$response = json_decode(curl_exec($ch), true);
curl_close($ch);
print_r($response);
```

</details>

---

## Error Responses

All error responses follow this shape:

```json
{"error": "human-readable message"}
```

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Bad request — missing or invalid parameters |
| `401` | Unauthorized — not logged in |
| `403` | Forbidden — action not permitted (e.g. unknown systemd unit) |
| `404` | Not found — unknown service ID |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `502` | Bad gateway — upstream service unreachable |
| `504` | Gateway timeout — upstream or subprocess timed out |

---

## Public Endpoints (No Auth)

### GET /api/ping

Liveness check. Returns the current UTC timestamp. Use this to verify the server is reachable before authenticating.

**Response**

```json
{
  "ok": true,
  "ts": "2026-04-07T18:00:00.000000+00:00"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Always `true` |
| `ts` | string | ISO 8601 UTC timestamp |

<details>
<summary><strong>curl</strong></summary>

```bash
curl https://monitor.obby.ca/api/ping
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
import requests
print(requests.get("https://monitor.obby.ca/api/ping").json())
# {"ok": True, "ts": "2026-04-07T18:00:00.000000+00:00"}
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const pong = await fetch("https://monitor.obby.ca/api/ping").then(r => r.json());
console.log(pong.ts); // "2026-04-07T18:00:00.000000+00:00"
```

</details>

<details>
<summary><strong>Go</strong></summary>

```go
resp, _ := http.Get("https://monitor.obby.ca/api/ping")
defer resp.Body.Close()
var pong map[string]any
json.NewDecoder(resp.Body).Decode(&pong)
fmt.Println(pong["ts"])
```

</details>

---

### GET /api/public

Unauthenticated service health summary. Designed for external uptime monitors, status pages, or public dashboards.

**Response**

```json
{
  "services": {
    "comet": {
      "name": "Comet",
      "ok": true,
      "latency_ms": 142,
      "category": "streaming"
    },
    "mediafusion": {
      "name": "MediaFusion",
      "ok": true,
      "latency_ms": 89,
      "category": "streaming"
    }
  },
  "total": 26,
  "up": 25,
  "down": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `services` | object | Map of service ID → health snapshot |
| `services[id].name` | string | Human-readable service name |
| `services[id].ok` | boolean\|null | `true` = healthy, `false` = down, `null` = not yet checked |
| `services[id].latency_ms` | integer\|null | Last HTTP probe latency in milliseconds |
| `services[id].category` | string | Service category (e.g. `streaming`, `arr`, `media_server`) |
| `total` | integer | Total number of monitored services |
| `up` | integer | Number of services currently healthy |
| `down` | integer | Number of services currently unhealthy |

<details>
<summary><strong>curl</strong></summary>

```bash
curl https://monitor.obby.ca/api/public | jq '.up, .down'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
import requests

data = requests.get("https://monitor.obby.ca/api/public").json()
print(f"{data['up']}/{data['total']} services up")

for sid, svc in data["services"].items():
    status = "✅" if svc["ok"] else "❌"
    print(f"  {status} {svc['name']} ({svc.get('latency_ms', '?')}ms)")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const data = await fetch("https://monitor.obby.ca/api/public").then(r => r.json());
console.log(`${data.up}/${data.total} services up`);
for (const [id, svc] of Object.entries(data.services)) {
  console.log(`${svc.ok ? "✅" : "❌"} ${svc.name} (${svc.latency_ms ?? "?"}ms)`);
}
```

</details>

<details>
<summary><strong>Go</strong></summary>

```go
type ServiceHealth struct {
    Name      string  `json:"name"`
    Ok        *bool   `json:"ok"`
    LatencyMs *int    `json:"latency_ms"`
    Category  string  `json:"category"`
}
type PublicResponse struct {
    Services map[string]ServiceHealth `json:"services"`
    Total    int                      `json:"total"`
    Up       int                      `json:"up"`
    Down     int                      `json:"down"`
}

resp, _ := http.Get("https://monitor.obby.ca/api/public")
defer resp.Body.Close()
var data PublicResponse
json.NewDecoder(resp.Body).Decode(&data)
fmt.Printf("%d/%d services up\n", data.Up, data.Total)
```

</details>

<details>
<summary><strong>PHP</strong></summary>

```php
$data = json_decode(file_get_contents("https://monitor.obby.ca/api/public"), true);
echo "{$data['up']}/{$data['total']} services up\n";
foreach ($data['services'] as $id => $svc) {
    $icon = $svc['ok'] ? "✅" : "❌";
    echo "  $icon {$svc['name']} ({$svc['latency_ms']}ms)\n";
}
```

</details>

---

### GET /speedtest/download

Generates random bytes for measuring download throughput to the server. No auth required, but rate-limited.

**Query parameters**

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `mb` | `25` | `500` | Size of response body in megabytes |

**Rate limiting:** 20 requests per 10 minutes per IP address. Exceeding this returns HTTP 429.

**Response headers**

| Header | Value |
|--------|-------|
| `Content-Type` | `application/octet-stream` |
| `Content-Length` | Exact byte count |
| `Access-Control-Allow-Origin` | `*` |
| `Access-Control-Expose-Headers` | `Content-Length` |
| `Cache-Control` | `no-store` |

**Notes:**
- The body is cryptographically random bytes — not compressible, ensuring the measurement reflects true network throughput.
- Response is streamed in 64 KB chunks.

<details>
<summary><strong>curl — measure download speed</strong></summary>

```bash
# Download 100 MB and show throughput
curl -o /dev/null -w "%{speed_download} bytes/sec\n" \
  "https://monitor.obby.ca/speedtest/download?mb=100"

# Human-readable with progress
curl --progress-bar -o /dev/null \
  "https://monitor.obby.ca/speedtest/download?mb=200"
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
import requests
import time

url = "https://monitor.obby.ca/speedtest/download?mb=50"
start = time.monotonic()
r = requests.get(url, stream=True)
total = 0
for chunk in r.iter_content(chunk_size=65536):
    total += len(chunk)
elapsed = time.monotonic() - start
mbps = (total * 8) / (elapsed * 1_000_000)
print(f"Downloaded {total / 1024**2:.1f} MB in {elapsed:.2f}s — {mbps:.1f} Mbps")
```

</details>

<details>
<summary><strong>JavaScript (Node.js)</strong></summary>

```js
import https from "https";

const url = "https://monitor.obby.ca/speedtest/download?mb=50";
const start = Date.now();
let total = 0;

https.get(url, res => {
  res.on("data", chunk => { total += chunk.length; });
  res.on("end", () => {
    const elapsed = (Date.now() - start) / 1000;
    const mbps = (total * 8) / (elapsed * 1e6);
    console.log(`${(total / 1024 ** 2).toFixed(1)} MB in ${elapsed.toFixed(2)}s — ${mbps.toFixed(1)} Mbps`);
  });
});
```

</details>

---

## Authenticated Endpoints

All endpoints in this section require a valid session cookie. See [Authentication](#authentication) for the login flow.

---

### POST /login

Authenticates with username + password and issues a session cookie.

**Request** (`application/x-www-form-urlencoded`)

| Field | Description |
|-------|-------------|
| `username` | Must be `admin` |
| `password` | Admin password (Argon2-hashed at rest) |

**Responses**

| Status | Meaning |
|--------|---------|
| `303` | Login successful — redirects to `/` with `Set-Cookie` |
| `200` | Login failed — returns the login page with an error message |

---

### GET /logout

Clears the session and redirects to `/login`.

---

### GET /api/status

Returns the full health snapshot for all monitored services, including the rolling check history (last 120 data points, one per 30-second poll).

**Response**

```json
{
  "comet": {
    "current": {
      "id": "comet",
      "name": "Comet",
      "ok": true,
      "systemd": "active",
      "message": "HTTP 200",
      "latency_ms": 142,
      "timestamp": "2026-04-07T18:00:00+00:00",
      "category": "streaming"
    },
    "history": [
      {"ok": true, "ts": "2026-04-07T17:59:30+00:00"},
      {"ok": true, "ts": "2026-04-07T17:59:00+00:00"}
    ]
  }
}
```

**`current` object fields**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique service identifier |
| `name` | string | Human-readable name |
| `ok` | boolean\|null | Overall health — `true` only if configured systemd and HTTP checks pass. For HTTP-only services, only the HTTP check is required. |
| `systemd` | string | systemd unit state: `"active"`, `"inactive"`, `"unknown"` |
| `message` | string | Last health check message (e.g. `"HTTP 200"`, `"HTTP 503"`, `"pending"`) |
| `latency_ms` | integer\|null | Last HTTP probe round-trip in milliseconds |
| `timestamp` | string\|null | ISO 8601 timestamp of the last check |
| `category` | string | Service category |

**`history` array items**

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Health result at this point in time |
| `ts` | string | ISO 8601 timestamp |

<details>
<summary><strong>curl</strong></summary>

```bash
# All services
curl -b cookies.txt https://monitor.obby.ca/api/status | jq 'to_entries[] | {service: .key, ok: .value.current.ok, latency: .value.current.latency_ms}'

# Count how many are up
curl -b cookies.txt https://monitor.obby.ca/api/status | jq '[to_entries[] | select(.value.current.ok == true)] | length'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
import requests

session = requests.Session()
session.post("https://monitor.obby.ca/login", data={"username": "admin", "password": "yourpassword"})

data = session.get("https://monitor.obby.ca/api/status").json()
for sid, svc in data.items():
    cur = svc["current"]
    icon = "✅" if cur["ok"] else ("⚠️" if cur["ok"] is None else "❌")
    print(f"{icon} {cur['name']:30s} {cur.get('latency_ms', '?'):>6}ms  {cur['systemd']}")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
// Assumes you've already logged in and `session` is a got/axios instance with cookies

const data = await session.get("https://monitor.obby.ca/api/status").then(r => r.json());

const down = Object.entries(data)
  .filter(([, svc]) => svc.current.ok === false)
  .map(([id, svc]) => svc.current.name);

if (down.length) console.warn("Down:", down.join(", "));
else console.log("All services healthy");
```

</details>

<details>
<summary><strong>Go</strong></summary>

```go
type HealthPoint struct {
    Ok bool   `json:"ok"`
    Ts string `json:"ts"`
}
type ServiceStatus struct {
    Current struct {
        ID        string  `json:"id"`
        Name      string  `json:"name"`
        Ok        *bool   `json:"ok"`
        Systemd   string  `json:"systemd"`
        Message   string  `json:"message"`
        LatencyMs *int    `json:"latency_ms"`
        Timestamp *string `json:"timestamp"`
        Category  string  `json:"category"`
    } `json:"current"`
    History []HealthPoint `json:"history"`
}

r, _ := client.Get("https://monitor.obby.ca/api/status")
defer r.Body.Close()
var result map[string]ServiceStatus
json.NewDecoder(r.Body).Decode(&result)

for id, svc := range result {
    ok := svc.Current.Ok != nil && *svc.Current.Ok
    fmt.Printf("%-20s ok=%v\n", id, ok)
}
```

</details>

---

### GET /api/status/{service\_id}

Health snapshot and history for a single service.

**Path parameters**

| Parameter | Description |
|-----------|-------------|
| `service_id` | Service identifier (e.g. `comet`, `mediafusion`, `jellyfin`) |

**Response** — same shape as a single entry from `GET /api/status`:

```json
{
  "current": { ... },
  "history": [ ... ]
}
```

Returns HTTP **404** if `service_id` is unknown.

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt https://monitor.obby.ca/api/status/comet | jq '.current'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
svc = session.get("https://monitor.obby.ca/api/status/jellyfin").json()
print(svc["current"]["ok"], svc["current"]["latency_ms"])

# Check last 10 history points
for point in svc["history"][-10:]:
    print(point["ts"], "✅" if point["ok"] else "❌")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const svc = await session.get("https://monitor.obby.ca/api/status/mediafusion").then(r => r.json());
const uptime = svc.history.filter(p => p.ok).length / svc.history.length * 100;
console.log(`MediaFusion uptime: ${uptime.toFixed(1)}% (last ${svc.history.length} checks)`);
```

</details>

---

### GET /api/stats

Returns collected statistics for all services. Stats are refreshed every 60 seconds by background collectors. The exact fields vary by service type.

**Response** (abbreviated)

```json
{
  "mediafusion": {
    "version": "5.4.4",
    "streams_total": 9400,
    "catalogs": 34
  },
  "zilean": {
    "total_torrents": 1170000,
    "with_imdb": 960000
  },
  "stremthru": {
    "magnet_total": 19700
  },
  "comet": {
    "version": "2.53.0",
    "total_cached": 58000
  },
  "radarr": {
    "version": "5.14.0",
    "movie_count": 4823,
    "monitored": 4100
  },
  "sonarr": {
    "version": "4.0.14",
    "series_count": 612,
    "episode_count": 29800
  },
  "jellyfin": {
    "version": "10.10.7",
    "movie_count": 4800,
    "series_count": 610
  }
}
```

<details>
<summary><strong>curl</strong></summary>

```bash
# All stats
curl -b cookies.txt https://monitor.obby.ca/api/stats | jq .

# Just versions
curl -b cookies.txt https://monitor.obby.ca/api/stats | jq 'to_entries[] | {service: .key, version: .value.version} | select(.version != null)'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
stats = session.get("https://monitor.obby.ca/api/stats").json()
for sid, data in stats.items():
    if "version" in data:
        print(f"{sid}: v{data['version']}")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const stats = await session.get("https://monitor.obby.ca/api/stats").then(r => r.json());
console.table(
  Object.entries(stats)
    .filter(([, v]) => v.version)
    .map(([id, v]) => ({ service: id, version: v.version }))
);
```

</details>

---

### GET /api/stats/{service\_id}

Stats for a single service. Useful for polling one service without fetching the full payload.

**Response**

```json
{
  "stats": {
    "version": "5.4.4",
    "streams_total": 9400
  },
  "updated_at": "2026-04-07T18:00:00+00:00"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `stats` | object | Service-specific stats dictionary |
| `updated_at` | string\|null | ISO 8601 timestamp of the last collection run |

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt https://monitor.obby.ca/api/stats/mediafusion | jq '{version: .stats.version, streams: .stats.streams_total}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
r = session.get("https://monitor.obby.ca/api/stats/sonarr").json()
print(f"Sonarr {r['stats'].get('version')} — {r['stats'].get('series_count')} series, updated {r['updated_at']}")
```

</details>

---

### GET /api/versions

Returns the installed version and latest GitHub release version for each service that has a configured GitHub repo. Use this to detect services that are out of date.

**Response**

```json
{
  "comet": {
    "installed": "2.53.0",
    "latest": "2.53.0",
    "published_at": "2026-03-14T10:00:00Z",
    "prerelease": false
  },
  "mediafusion": {
    "installed": "5.4.4",
    "latest": "5.4.5",
    "published_at": "2026-04-01T08:30:00Z",
    "prerelease": false
  },
  "jellyfin": {
    "installed": "10.10.7",
    "latest": "10.10.7",
    "published_at": "2026-02-20T14:00:00Z",
    "prerelease": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `installed` | string | Currently installed version string (may be empty if undetectable) |
| `latest` | string | Latest GitHub release tag (may be empty if not yet fetched) |
| `published_at` | string | ISO 8601 release date of the latest GitHub release |
| `prerelease` | boolean | Whether the latest GitHub release is a pre-release |

GitHub versions are fetched every 6 hours in the background.

<details>
<summary><strong>curl — find outdated services</strong></summary>

```bash
curl -b cookies.txt https://monitor.obby.ca/api/versions | \
  jq 'to_entries[] | select(.value.installed != "" and .value.latest != "" and .value.installed != .value.latest) | {service: .key, installed: .value.installed, latest: .value.latest}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
versions = session.get("https://monitor.obby.ca/api/versions").json()

outdated = [
    (sid, v["installed"], v["latest"])
    for sid, v in versions.items()
    if v["installed"] and v["latest"] and v["installed"] != v["latest"]
]

if outdated:
    print("Outdated services:")
    for sid, installed, latest in outdated:
        print(f"  {sid}: {installed} → {latest}")
else:
    print("All services up to date")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const versions = await session.get("https://monitor.obby.ca/api/versions").then(r => r.json());

const outdated = Object.entries(versions).filter(
  ([, v]) => v.installed && v.latest && v.installed !== v.latest
);
outdated.forEach(([id, v]) => console.log(`${id}: ${v.installed} → ${v.latest}`));
```

</details>

<details>
<summary><strong>Go</strong></summary>

```go
type VersionInfo struct {
    Installed   string `json:"installed"`
    Latest      string `json:"latest"`
    PublishedAt string `json:"published_at"`
    Prerelease  bool   `json:"prerelease"`
}

r, _ := client.Get("https://monitor.obby.ca/api/versions")
defer r.Body.Close()
var versions map[string]VersionInfo
json.NewDecoder(r.Body).Decode(&versions)

for id, v := range versions {
    if v.Installed != "" && v.Latest != "" && v.Installed != v.Latest {
        fmt.Printf("OUTDATED: %s  installed=%s  latest=%s\n", id, v.Installed, v.Latest)
    }
}
```

</details>

---

### GET /api/logs/{unit}

Retrieves recent systemd journal lines for a specific service unit. Only units belonging to configured services are permitted.

**Path parameters**

| Parameter | Description |
|-----------|-------------|
| `unit` | systemd unit name (e.g. `comet.service`, `mediafusion.service`) |

**Query parameters**

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `n` | `200` | `1000` | Number of journal lines to return |

**Response**

```json
{
  "unit": "comet.service",
  "lines": [
    "2026-04-07T17:58:01+0000 hostname comet[12345]: INFO Starting scrape for tt0468569",
    "2026-04-07T17:58:02+0000 hostname comet[12345]: INFO Found 42 streams"
  ]
}
```

Returns HTTP **403** if the unit is not in the allowed list.

<details>
<summary><strong>curl</strong></summary>

```bash
# Last 500 lines of mediafusion
curl -b cookies.txt "https://monitor.obby.ca/api/logs/mediafusion.service?n=500"

# Grep for errors
curl -b cookies.txt "https://monitor.obby.ca/api/logs/comet.service?n=1000" | \
  jq '.lines[] | select(test("ERROR|CRITICAL|Exception"; "i"))'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
r = session.get("https://monitor.obby.ca/api/logs/jellyfin.service", params={"n": 500}).json()
error_lines = [l for l in r["lines"] if "error" in l.lower() or "exception" in l.lower()]
for line in error_lines[-20:]:
    print(line)
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const logs = await session.get(
  "https://monitor.obby.ca/api/logs/sonarr.service?n=300"
).then(r => r.json());

logs.lines
  .filter(l => /warn|error/i.test(l))
  .forEach(l => console.warn(l));
```

</details>

<details>
<summary><strong>Go</strong></summary>

```go
r, _ := client.Get("https://monitor.obby.ca/api/logs/radarr.service?n=200")
defer r.Body.Close()
var result struct {
    Unit  string   `json:"unit"`
    Lines []string `json:"lines"`
}
json.NewDecoder(r.Body).Decode(&result)
for _, line := range result.Lines {
    fmt.Println(line)
}
```

</details>

---

### GET /api/dmesg

Returns recent kernel log lines via `journalctl -k`.

**Query parameters**

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `lines` | `100` | `500` | Number of kernel log lines to return |

**Response**

```json
{
  "lines": [
    "2026-04-07T10:00:01+0000 hostname kernel: [12345.678] EXT4-fs (sda1): re-mounted...",
    "2026-04-07T10:00:05+0000 hostname kernel: [12350.123] Out of memory: kill process..."
  ]
}
```

<details>
<summary><strong>curl</strong></summary>

```bash
# Check for OOM kills
curl -b cookies.txt "https://monitor.obby.ca/api/dmesg?lines=500" | \
  jq '.lines[] | select(test("oom|out of memory|killed process"; "i"))'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
dmesg = session.get("https://monitor.obby.ca/api/dmesg", params={"lines": 200}).json()
oom_lines = [l for l in dmesg["lines"] if "oom" in l.lower() or "out of memory" in l.lower()]
if oom_lines:
    print(f"⚠️  {len(oom_lines)} OOM-related kernel messages found!")
    for l in oom_lines:
        print(l)
```

</details>

---

### GET /api/processes

Returns the top 30 processes sorted by CPU usage at the time of the request. Each process is deduplicated by name (one entry per unique process name). Requires `psutil`.

**Response**

```json
{
  "processes": [
    {
      "pid": 12345,
      "name": "python3",
      "cpu_pct": 18.4,
      "mem_pct": 3.2,
      "mem_mb": 256.7,
      "status": "running",
      "user": "comet",
      "cmd": "/usr/bin/python3 app.py --port 8000"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `pid` | integer | Process ID |
| `name` | string | Process name |
| `cpu_pct` | float | CPU usage percentage normalized per logical core |
| `mem_pct` | float | Memory usage as percentage of total RAM |
| `mem_mb` | float | Resident memory in megabytes |
| `status` | string | Process status (`running`, `sleeping`, etc.) |
| `user` | string | Owning user (truncated to 16 chars) |
| `cmd` | string | Command line (first 4 tokens, max 80 chars) |

**Note:** This endpoint takes ~500ms due to the two-sample CPU measurement required for accurate readings.

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt https://monitor.obby.ca/api/processes | \
  jq '.processes[] | {name, cpu: .cpu_pct, mem_mb}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
procs = session.get("https://monitor.obby.ca/api/processes").json()["processes"]
print(f"{'Process':<25} {'CPU%':>6} {'MEM MB':>8} {'User':<16}")
print("-" * 60)
for p in procs[:10]:
    print(f"{p['name']:<25} {p['cpu_pct']:>6.1f} {p['mem_mb']:>8.1f} {p['user']:<16}")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const { processes } = await session.get("https://monitor.obby.ca/api/processes").then(r => r.json());
// Find highest memory consumers
processes
  .sort((a, b) => b.mem_mb - a.mem_mb)
  .slice(0, 5)
  .forEach(p => console.log(`${p.name}: ${p.mem_mb.toFixed(1)} MB`));
```

</details>

---

### GET /api/jellyfin

Returns active Jellyfin sessions and the last 24 hours of activity log entries, proxied through StreamMonitor using the configured Jellyfin API key.

**Response**

```json
{
  "sessions": [
    {
      "Id": "abc123",
      "UserName": "alice",
      "Client": "Jellyfin Web",
      "DeviceName": "Chrome",
      "NowPlayingItem": {
        "Name": "The Dark Knight",
        "Type": "Movie",
        "Id": "def456"
      },
      "PlayState": {
        "PositionTicks": 12345678900,
        "IsPaused": false,
        "PlayMethod": "DirectPlay"
      }
    }
  ],
  "activity": [
    {
      "Id": 1001,
      "Name": "User alice started playing The Dark Knight",
      "Type": "VideoPlayback",
      "UserId": "user-uuid",
      "Date": "2026-04-07T17:30:00.0000000Z",
      "Severity": "Information"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `sessions` | Array of active Jellyfin session objects (full Jellyfin API format) |
| `activity` | Array of activity log entries from the past 24 hours (max 50) |

<details>
<summary><strong>curl</strong></summary>

```bash
# Active sessions count
curl -b cookies.txt https://monitor.obby.ca/api/jellyfin | jq '.sessions | length'

# What's currently playing
curl -b cookies.txt https://monitor.obby.ca/api/jellyfin | \
  jq '.sessions[] | select(.NowPlayingItem != null) | {user: .UserName, title: .NowPlayingItem.Name}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
jf = session.get("https://monitor.obby.ca/api/jellyfin").json()

playing = [s for s in jf["sessions"] if s.get("NowPlayingItem")]
print(f"{len(playing)} active streams:")
for s in playing:
    item = s["NowPlayingItem"]["Name"]
    method = s.get("PlayState", {}).get("PlayMethod", "?")
    print(f"  {s['UserName']} — {item} ({method})")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const jf = await session.get("https://monitor.obby.ca/api/jellyfin").then(r => r.json());

jf.sessions
  .filter(s => s.NowPlayingItem)
  .forEach(s => console.log(`${s.UserName}: ${s.NowPlayingItem.Name}`));
```

</details>

---

### GET /api/benchmark

Runs a parallel stream resolution benchmark across configured self-hosted and public Stremio addon endpoints. Measures latency, stream count, resolution breakdown, and codec distribution.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `imdb` | Yes | IMDB ID. Movies: `tt0468569`. Series: `tt0903747`. Episodes: `tt0903747:3:7` (season:episode) |
| `mode` | No | `cached` \| `uncached` \| `all` (default: `all`) |

**Response**

```json
{
  "imdb": "tt0468569",
  "title": "The Dark Knight",
  "mode": "all",
  "timestamp": "2026-04-07T18:00:00+00:00",
  "results": [
    {
      "name": "Comet",
      "group": "self-hosted",
      "cache_mode": "cached",
      "latency_ms": 312,
      "streams": 48,
      "resolutions": {"4k": 3, "1080p": 28, "720p": 12},
      "top_codec": "HEVC",
      "codec_counts": {"HEVC": 30, "AVC": 18},
      "error": null
    },
    {
      "name": "Comet (elfhosted)",
      "group": "public",
      "cache_mode": "cached",
      "latency_ms": 980,
      "streams": 41,
      "resolutions": {"4k": 2, "1080p": 25, "720p": 10},
      "top_codec": "HEVC",
      "codec_counts": {"HEVC": 26, "AVC": 15},
      "error": null
    }
  ],
  "summary": {
    "cached": {
      "self_hosted": {"total_streams": 89, "avg_latency_ms": 350, "endpoints": 2},
      "public": {"total_streams": 74, "avg_latency_ms": 1100, "endpoints": 2}
    },
    "overall": {
      "self_hosted": {"total_streams": 189, "avg_latency_ms": 420, "endpoints": 4},
      "public": {"total_streams": 141, "avg_latency_ms": 1050, "endpoints": 4}
    }
  }
}
```

**Result object fields**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Endpoint label |
| `group` | string | `"self-hosted"` or `"public"` |
| `cache_mode` | string | `"cached"`, `"uncached"`, or `"all"` |
| `latency_ms` | integer\|null | Total round-trip time in milliseconds |
| `streams` | integer | Total streams returned |
| `resolutions` | object | Counts by resolution: `4k`, `1080p`, `720p` |
| `top_codec` | string\|null | Most common codec (`"HEVC"`, `"AVC"`, `"AV1"`) |
| `codec_counts` | object | Per-codec stream counts |
| `error` | string\|null | Error message if the request failed, otherwise `null` |

**Supported IMDB IDs** include 40+ pre-loaded titles across popular movies, TV shows, and anime. Any valid IMDB ID can be used regardless of whether it's in the pre-loaded list.

<details>
<summary><strong>curl</strong></summary>

```bash
# Benchmark The Dark Knight, cached mode only
curl -b cookies.txt "https://monitor.obby.ca/api/benchmark?imdb=tt0468569&mode=cached" | \
  jq '.results[] | {name, group, streams, latency_ms, error}'

# Breaking Bad episode benchmark
curl -b cookies.txt "https://monitor.obby.ca/api/benchmark?imdb=tt0903747:3:7" | \
  jq '.summary.overall'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
result = session.get(
    "https://monitor.obby.ca/api/benchmark",
    params={"imdb": "tt0468569", "mode": "cached"}
).json()

print(f"Benchmark: {result['title']}")
print(f"{'Endpoint':<30} {'Streams':>8} {'Latency':>10} {'4K':>4} {'1080p':>6}")
for r in result["results"]:
    if r["error"]:
        print(f"  {r['name']:<28} ERROR: {r['error']}")
    else:
        res = r["resolutions"]
        print(f"  {r['name']:<28} {r['streams']:>8} {r['latency_ms']:>9}ms {res['4k']:>4} {res['1080p']:>6}")

print(f"\nSummary — self-hosted: {result['summary']['overall']['self_hosted']['total_streams']} total streams")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const result = await session.get(
  "https://monitor.obby.ca/api/benchmark?imdb=tt1375666&mode=all"
).then(r => r.json());

console.log(`${result.title} benchmark results:`);
result.results.forEach(r => {
  if (r.error) {
    console.error(`  ${r.name}: ${r.error}`);
  } else {
    console.log(`  ${r.name} [${r.group}]: ${r.streams} streams, ${r.latency_ms}ms`);
  }
});
```

</details>

<details>
<summary><strong>Go</strong></summary>

```go
type BenchResult struct {
    Name      string            `json:"name"`
    Group     string            `json:"group"`
    LatencyMs *int              `json:"latency_ms"`
    Streams   int               `json:"streams"`
    TopCodec  *string           `json:"top_codec"`
    Error     *string           `json:"error"`
}
type BenchResponse struct {
    IMDB    string        `json:"imdb"`
    Title   string        `json:"title"`
    Results []BenchResult `json:"results"`
}

r, _ := client.Get("https://monitor.obby.ca/api/benchmark?imdb=tt0468569&mode=cached")
defer r.Body.Close()
var bench BenchResponse
json.NewDecoder(r.Body).Decode(&bench)
for _, res := range bench.Results {
    if res.Error != nil {
        fmt.Printf("%s: ERROR %s\n", res.Name, *res.Error)
    } else {
        fmt.Printf("%s: %d streams, %dms\n", res.Name, res.Streams, *res.LatencyMs)
    }
}
```

</details>

---

### GET /api/errors

Returns the rolling error and warning history scanned from service logs. Errors are deduplicated and classified by severity. Logs are scanned every 2 minutes automatically; you can also trigger an immediate scan via `POST /api/errors/scan`.

**Response**

```json
{
  "errors": [
    {
      "service": "comet",
      "unit": "comet.service",
      "severity": "error",
      "message": "Connection refused to real-debrid.com",
      "ts": 1712500800.0,
      "line": "2026-04-07T18:00:00+0000 hostname comet[123]: ERROR Connection refused..."
    }
  ],
  "last_scan": 1712500800.0,
  "scan_count": 142,
  "total_errors": 3,
  "total_warnings": 12
}
```

| Field | Type | Description |
|-------|------|-------------|
| `errors` | array | Up to 2000 most recent classified log events |
| `errors[].service` | string | Service identifier |
| `errors[].unit` | string | systemd unit name |
| `errors[].severity` | string | `"error"` or `"warning"` |
| `errors[].message` | string | Extracted/classified error message |
| `errors[].ts` | float | Unix timestamp of the event |
| `errors[].line` | string | Raw journal line |
| `last_scan` | float\|null | Unix timestamp of the most recent scan |
| `scan_count` | integer | Total number of scans run since start |
| `total_errors` | integer | Number of error-severity events in current history |
| `total_warnings` | integer | Number of warning-severity events in current history |

<details>
<summary><strong>curl</strong></summary>

```bash
# All errors
curl -b cookies.txt https://monitor.obby.ca/api/errors | jq '.errors[] | select(.severity == "error")'

# Errors from a specific service
curl -b cookies.txt https://monitor.obby.ca/api/errors | jq '.errors[] | select(.service == "mediafusion")'

# Summary counts
curl -b cookies.txt https://monitor.obby.ca/api/errors | jq '{errors: .total_errors, warnings: .total_warnings, last_scan: .last_scan}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
from datetime import datetime

data = session.get("https://monitor.obby.ca/api/errors").json()
print(f"Errors: {data['total_errors']}, Warnings: {data['total_warnings']}")
print(f"Last scan: {datetime.fromtimestamp(data['last_scan']).strftime('%H:%M:%S')}")

for err in data["errors"]:
    if err["severity"] == "error":
        ts = datetime.fromtimestamp(err["ts"]).strftime("%H:%M:%S")
        print(f"[{ts}] {err['service']}: {err['message']}")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const data = await session.get("https://monitor.obby.ca/api/errors").then(r => r.json());

const byService = data.errors.reduce((acc, e) => {
  acc[e.service] = (acc[e.service] || 0) + 1;
  return acc;
}, {});

console.log("Errors by service:", byService);
```

</details>

---

### DELETE /api/errors

Clears all error history from memory. Does not affect underlying logs.

**Response**

```json
{"ok": true}
```

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt -X DELETE https://monitor.obby.ca/api/errors
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
session.delete("https://monitor.obby.ca/api/errors").raise_for_status()
print("Error history cleared")
```

</details>

---

### POST /api/errors/scan

Triggers an immediate background error scan without waiting for the 2-minute interval. Returns immediately; the scan runs asynchronously.

**Response**

```json
{"ok": true}
```

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt -X POST https://monitor.obby.ca/api/errors/scan
# Then wait a moment and fetch results
sleep 5 && curl -b cookies.txt https://monitor.obby.ca/api/errors | jq '{errors: .total_errors, warnings: .total_warnings}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
import time

session.post("https://monitor.obby.ca/api/errors/scan")
time.sleep(5)  # Let the scan complete
data = session.get("https://monitor.obby.ca/api/errors").json()
print(f"After scan: {data['total_errors']} errors, {data['total_warnings']} warnings")
```

</details>

---

### POST /api/service/{unit}/{action}

Control a systemd service. Only units belonging to configured services are allowed.

**Path parameters**

| Parameter | Description |
|-----------|-------------|
| `unit` | systemd unit name (e.g. `comet.service`) |
| `action` | One of: `start`, `stop`, `restart` |

**Response (success)**

```json
{"ok": true}
```

**Response (failure)**

```json
{"error": "Failed to restart comet.service: ..."}
```

Returns HTTP **403** for unknown units, **400** for invalid actions, **504** if systemctl times out (30s).

<details>
<summary><strong>curl</strong></summary>

```bash
# Restart Comet
curl -b cookies.txt -X POST https://monitor.obby.ca/api/service/comet.service/restart

# Stop then start MediaFusion
curl -b cookies.txt -X POST https://monitor.obby.ca/api/service/mediafusion.service/stop
curl -b cookies.txt -X POST https://monitor.obby.ca/api/service/mediafusion.service/start
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
def service_action(unit: str, action: str) -> bool:
    r = session.post(f"https://monitor.obby.ca/api/service/{unit}/{action}")
    result = r.json()
    if result.get("ok"):
        print(f"✅ {action} {unit}")
        return True
    else:
        print(f"❌ {action} {unit}: {result.get('error')}")
        return False

service_action("comet.service", "restart")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
async function serviceAction(unit, action) {
  const r = await session.post(
    `https://monitor.obby.ca/api/service/${unit}/${action}`
  ).then(r => r.json());

  if (r.ok) console.log(`✅ ${action} ${unit}`);
  else console.error(`❌ ${action} ${unit}:`, r.error);
}

await serviceAction("sonarr.service", "restart");
```

</details>

<details>
<summary><strong>Go</strong></summary>

```go
unit := "comet.service"
action := "restart"
r, _ := client.Post(
    fmt.Sprintf("https://monitor.obby.ca/api/service/%s/%s", unit, action),
    "application/json", nil,
)
defer r.Body.Close()
var result map[string]any
json.NewDecoder(r.Body).Decode(&result)
fmt.Println(result["ok"])
```

</details>

---

### POST /api/perms/scan

Scans filesystem permissions for all configured service directories and media library paths (94 paths across streaming services, arr suite, media servers, downloads, and media libraries). Returns a list of paths whose ownership or mode differs from expected values.

**Response**

```json
{
  "results": [
    {
      "label": "Radarr",
      "path": "/var/lib/radarr",
      "section": "Arr Suite",
      "expected_user": "radarr",
      "expected_group": "media",
      "expected_mode": "0o774",
      "actual_user": "root",
      "actual_group": "root",
      "actual_mode": "0o755",
      "ok": false
    }
  ],
  "ts": 1712500800.0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `results` | array | All scanned paths — both compliant and non-compliant |
| `results[].ok` | boolean | `true` if ownership and mode match expectations |
| `results[].label` | string | Human-readable path label |
| `results[].section` | string | Category group |
| `ts` | float | Unix timestamp when scan ran |

<details>
<summary><strong>curl</strong></summary>

```bash
# Scan and show only non-compliant paths
curl -b cookies.txt -X POST https://monitor.obby.ca/api/perms/scan | \
  jq '.results[] | select(.ok == false) | {label, path, actual_user, actual_mode}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
result = session.post("https://monitor.obby.ca/api/perms/scan").json()
bad = [r for r in result["results"] if not r["ok"]]
print(f"{len(bad)} paths with incorrect permissions:")
for r in bad:
    print(f"  {r['label']} ({r['path']})")
    print(f"    expected: {r['expected_user']}:{r['expected_group']} {r['expected_mode']}")
    print(f"    actual:   {r['actual_user']}:{r['actual_group']} {r['actual_mode']}")
```

</details>

---

### POST /api/perms/fix

Applies ownership and permission fixes to a list of paths. Each fix is applied with `chown` and `chmod` via asyncio subprocess.

**Request body** (`application/json`)

```json
[
  {
    "path": "/var/lib/radarr",
    "user": "radarr",
    "group": "media",
    "mode": "0o774",
    "recursive": false
  }
]
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Absolute filesystem path |
| `user` | string | Yes | Target owner username |
| `group` | string | Yes | Target owner group |
| `mode` | string | Yes | Octal mode string (e.g. `"0o774"`) |
| `recursive` | boolean | No | Apply recursively (default: `false`) |

**Response**

```json
[
  {"ok": true, "path": "/var/lib/radarr"},
  {"ok": false, "path": "/var/lib/bazarr", "error": "Permission denied"}
]
```

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt -X POST https://monitor.obby.ca/api/perms/fix \
  -H "Content-Type: application/json" \
  -d '[{"path": "/var/lib/radarr", "user": "radarr", "group": "media", "mode": "0o774", "recursive": false}]'
```

</details>

<details>
<summary><strong>Python — scan then fix</strong></summary>

```python
# Scan
scan = session.post("https://monitor.obby.ca/api/perms/scan").json()
fixes = [
    {
        "path": r["path"],
        "user": r["expected_user"],
        "group": r["expected_group"],
        "mode": r["expected_mode"],
        "recursive": False,
    }
    for r in scan["results"]
    if not r["ok"]
]

if fixes:
    print(f"Applying {len(fixes)} fixes...")
    results = session.post(
        "https://monitor.obby.ca/api/perms/fix",
        json=fixes,
    ).json()
    failed = [r for r in results if not r.get("ok")]
    print(f"  {len(fixes) - len(failed)} succeeded, {len(failed)} failed")
```

</details>

---

### GET /api/settings/keys

Returns all configured API keys from the key registry. Values are included — use HTTPS.

**Response**

```json
{
  "prowlarr": {
    "label": "Prowlarr API Key",
    "value": "abc123...",
    "group": "Indexers"
  },
  "jellyfin": {
    "label": "Jellyfin API Key",
    "value": "def456...",
    "group": "Media Servers"
  }
}
```

**Key groups:** `Indexers`, `Arr Suite`, `Media Servers`, `Streaming`, `Dispatching`, `Downloads`

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt https://monitor.obby.ca/api/settings/keys | jq 'to_entries[] | {key: .key, group: .value.group, set: (.value.value != "")}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
keys = session.get("https://monitor.obby.ca/api/settings/keys").json()
unset = [k for k, v in keys.items() if not v["value"]]
if unset:
    print(f"Unset keys: {', '.join(unset)}")
```

</details>

---

### POST /api/settings/keys

Updates one or more API keys. Only registered key names are accepted; unknown keys are silently ignored.

**Request body**

```json
{
  "prowlarr": "new-api-key-here",
  "jellyfin": "another-new-key"
}
```

**Response**

```json
{"ok": true, "updated": 2}
```

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt -X POST https://monitor.obby.ca/api/settings/keys \
  -H "Content-Type: application/json" \
  -d '{"prowlarr": "my-prowlarr-api-key"}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
r = session.post(
    "https://monitor.obby.ca/api/settings/keys",
    json={"jellyfin": "my-new-jellyfin-key"}
).json()
print(f"Updated {r['updated']} key(s)")
```

</details>

---

### GET /api/settings/urls

Returns all configured service URLs.

**Response**

```json
{
  "comet_url": {
    "label": "Comet",
    "value": "http://localhost:8000",
    "group": "Streaming"
  },
  "jellyfin_url": {
    "label": "Jellyfin",
    "value": "http://localhost:8096",
    "group": "Media Servers"
  }
}
```

**URL groups:** `Streaming`, `Indexers`, `Arr Suite`, `Media Servers`, `Dispatching`, `Downloads`

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt https://monitor.obby.ca/api/settings/urls | jq 'to_entries[] | {key: .key, url: .value.value}'
```

</details>

---

### POST /api/settings/urls

Updates one or more service URLs. All values are validated as well-formed HTTP/HTTPS URLs before saving. Trailing slashes are stripped.

**Request body**

```json
{
  "comet_url": "http://192.168.1.10:8000",
  "jellyfin_url": "https://jellyfin.example.com"
}
```

**Response (success)**

```json
{"ok": true, "updated": 2}
```

**Response (invalid URL)**

```json
{"error": "Invalid URL(s): Comet"}
```

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt -X POST https://monitor.obby.ca/api/settings/urls \
  -H "Content-Type: application/json" \
  -d '{"radarr_url": "http://localhost:7878"}'
```

</details>

---

### POST /api/settings/password

Changes the admin password. Requires providing the current password for verification.

**Request body**

```json
{
  "current": "current-password",
  "new_password": "new-secure-password"
}
```

**Response (success)**

```json
{"ok": true}
```

| Status | Meaning |
|--------|---------|
| `200` | Password changed successfully |
| `400` | `new_password` field missing or empty |
| `403` | Current password incorrect |

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt -X POST https://monitor.obby.ca/api/settings/password \
  -H "Content-Type: application/json" \
  -d '{"current": "oldpass", "new_password": "newpass"}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
r = session.post("https://monitor.obby.ca/api/settings/password", json={
    "current": "oldpassword",
    "new_password": "newpassword123",
}).json()
if r.get("ok"):
    print("Password changed successfully")
else:
    print(f"Failed: {r.get('error')}")
```

</details>

---

### GET /api/aiostreams/analyze

Parses the AIOStreams systemd journal and returns structured analytics: request throughput, error rates, provider performance, addon latencies, and stream resolution/codec breakdowns.

**Query parameters**

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `n` | `5000` | `50000` | Number of journal lines to analyze |

**Response** (shape depends on log content)

```json
{
  "total_requests": 1240,
  "errors": 3,
  "error_rate": 0.0024,
  "providers": {
    "real-debrid": {"requests": 840, "errors": 1, "avg_latency_ms": 420},
    "alldebrid": {"requests": 400, "errors": 2, "avg_latency_ms": 510}
  },
  "resolutions": {"4k": 340, "1080p": 780, "720p": 120},
  "codecs": {"HEVC": 600, "AVC": 640},
  "addons": {
    "comet": {"calls": 430, "avg_latency_ms": 180},
    "mediafusion": {"calls": 380, "avg_latency_ms": 240}
  }
}
```

<details>
<summary><strong>curl</strong></summary>

```bash
# Analyze last 10000 lines
curl -b cookies.txt "https://monitor.obby.ca/api/aiostreams/analyze?n=10000" | jq .

# Quick error rate check
curl -b cookies.txt "https://monitor.obby.ca/api/aiostreams/analyze" | jq '{total: .total_requests, errors: .errors, rate: .error_rate}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
analysis = session.get(
    "https://monitor.obby.ca/api/aiostreams/analyze",
    params={"n": 10000}
).json()

print(f"Total requests: {analysis.get('total_requests', 0)}")
print(f"Error rate: {analysis.get('error_rate', 0):.1%}")
for provider, stats in analysis.get("providers", {}).items():
    print(f"  {provider}: {stats['requests']} reqs, {stats.get('avg_latency_ms', '?')}ms avg")
```

</details>

---

### POST /api/aiostreams/test

Triggers a live stream lookup on the configured AIOStreams instance and returns the results. Useful for testing connectivity and measuring real-time response.

**Request body** (`application/json`)

```json
{
  "imdb": "tt0468569",
  "type": "movie"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `imdb` | Yes | IMDB ID starting with `tt` |
| `type` | No | `"movie"` (default) or `"series"` |

**Response (success)**

```json
{
  "ok": true,
  "imdb": "tt0468569",
  "type": "movie",
  "streams": 54,
  "latency_ms": 1240,
  "top_codec": "HEVC",
  "resolutions": {"4k": 4, "1080p": 32, "720p": 14},
  "sample": [
    {"title": "The Dark Knight 2008 2160p HEVC...", "name": "real-debrid"},
    {"title": "The Dark Knight 2008 1080p BluRay...", "name": "alldebrid"}
  ]
}
```

<details>
<summary><strong>curl</strong></summary>

```bash
curl -b cookies.txt -X POST https://monitor.obby.ca/api/aiostreams/test \
  -H "Content-Type: application/json" \
  -d '{"imdb": "tt1375666", "type": "movie"}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
result = session.post(
    "https://monitor.obby.ca/api/aiostreams/test",
    json={"imdb": "tt0903747", "type": "series"}
).json()

if result.get("ok"):
    print(f"✅ {result['streams']} streams in {result['latency_ms']}ms")
    print(f"   Top codec: {result.get('top_codec')}")
else:
    print(f"❌ {result.get('error')}")
```

</details>

<details>
<summary><strong>JavaScript</strong></summary>

```js
const result = await session.post("https://monitor.obby.ca/api/aiostreams/test", {
  json: { imdb: "tt0468569", type: "movie" }
}).json();

if (result.ok) {
  console.log(`${result.streams} streams in ${result.latency_ms}ms (${result.top_codec})`);
} else {
  console.error("Test failed:", result.error);
}
```

</details>

---

### GET /api/mediafusion/metrics

Fetches comprehensive admin metrics from the MediaFusion admin API, including system overview, user stats, scraper status, debrid cache usage, Redis metrics, request throughput, and scheduler state. Authenticates with MediaFusion automatically using the configured credentials.

**Response** (abbreviated — fields present depend on MediaFusion version)

```json
{
  "ok": true,
  "overview": {
    "total_torrents": 9400000,
    "total_movies": 280000,
    "total_series": 48000
  },
  "users": {
    "total": 1240,
    "active_last_7d": 380
  },
  "scrapers": [
    {"name": "YTS", "status": "running", "last_run": "2026-04-07T17:55:00Z"}
  ],
  "debrid_cache": {
    "real-debrid": {"cached": 840000, "total": 900000},
    "alldebrid": {"cached": 310000, "total": 350000}
  },
  "redis": {
    "used_memory_human": "2.4G",
    "connected_clients": 12
  },
  "request_metrics": {
    "total": 18400,
    "success_rate": 0.97
  }
}
```

<details>
<summary><strong>curl</strong></summary>

```bash
# Full metrics dump
curl -b cookies.txt https://monitor.obby.ca/api/mediafusion/metrics | jq .

# Cache hit rates
curl -b cookies.txt https://monitor.obby.ca/api/mediafusion/metrics | \
  jq '.debrid_cache | to_entries[] | {provider: .key, hit_rate: (.value.cached / .value.total)}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
metrics = session.get("https://monitor.obby.ca/api/mediafusion/metrics").json()

if not metrics.get("ok"):
    print(f"Error: {metrics.get('error')}")
else:
    print(f"MediaFusion: {metrics.get('overview', {}).get('total_torrents', '?'):,} torrents")
    for provider, cache in metrics.get("debrid_cache", {}).items():
        if isinstance(cache, dict) and "cached" in cache and "total" in cache:
            pct = cache["cached"] / cache["total"] * 100 if cache["total"] else 0
            print(f"  {provider}: {pct:.1f}% cached")
```

</details>

---

### GET /api/mediafusion/analyze

Parses the `mediafusion-taskiq-scrapy` systemd journal and returns structured scraper analytics: task throughput, success/failure rates, per-scraper performance, and scrape speed metrics.

**Query parameters**

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `n` | `10000` | `500000` | Number of journal lines to analyze. Pass `n=all` to read the entire journal (may be slow). |

**Response** (shape depends on log content)

```json
{
  "total_tasks": 48200,
  "failed_tasks": 120,
  "failure_rate": 0.0025,
  "scrapers": {
    "YTS": {"tasks": 12400, "failures": 10, "avg_ms": 340},
    "RARBG": {"tasks": 9800, "failures": 45, "avg_ms": 810}
  },
  "scrape_rate": {
    "torrents_per_minute": 420,
    "items_per_minute": 1800
  }
}
```

<details>
<summary><strong>curl</strong></summary>

```bash
# Analyze last 50000 lines
curl -b cookies.txt "https://monitor.obby.ca/api/mediafusion/analyze?n=50000" | jq .

# Failure rates by scraper
curl -b cookies.txt "https://monitor.obby.ca/api/mediafusion/analyze?n=20000" | \
  jq '.scrapers | to_entries[] | {scraper: .key, failures: .value.failures, tasks: .value.tasks}'
```

</details>

<details>
<summary><strong>Python</strong></summary>

```python
analysis = session.get(
    "https://monitor.obby.ca/api/mediafusion/analyze",
    params={"n": 20000}
).json()

print(f"Tasks: {analysis.get('total_tasks', 0):,}  Failures: {analysis.get('failed_tasks', 0)}")
for scraper, stats in analysis.get("scrapers", {}).items():
    fail_pct = stats["failures"] / stats["tasks"] * 100 if stats.get("tasks") else 0
    print(f"  {scraper}: {stats['tasks']:>6} tasks, {fail_pct:.1f}% failure, {stats.get('avg_ms', '?')}ms avg")
```

</details>

---

## Rate Limits Summary

| Endpoint | Limit |
|----------|-------|
| `GET /speedtest/download` | 20 requests / 10 min / IP |
| All other endpoints | No explicit rate limit (session-scoped) |

---

## Polling Intervals Reference

| Data | Update Frequency |
|------|-----------------|
| Service health (`/api/status`) | Every 30 seconds |
| Service stats (`/api/stats`) | Every 60 seconds |
| GitHub versions (`/api/versions`) | Every 6 hours |
| Error log scan (`/api/errors`) | Every 2 minutes |
