# Minting auth tokens for `<zulip-chat>`

The embed's `auth-token` attribute accepts a short-lived JWT that the
browser exchanges, on first load, for a scoped Zulip API key. The key
stays inside the SDK — the host page never sees it. This doc covers
the server side.

## 1. Provision a shared secret in your Zulip org

Zulip's JWT login requires the admin to set `JWT_AUTH_KEYS` in
`/etc/zulip/settings.py`:

```python
JWT_AUTH_KEYS = {
    "your-realm.zulipchat.com": {
        "key": "<32+ random bytes, hex or base64>",
        "algorithms": ["HS256"],
    },
}
```

Restart the `zulip` service. The same secret now signs every JWT your
backend mints for this realm.

## 2. Mint a JWT on your backend

A minimal Node example using [`jose`](https://github.com/panva/jose):

```ts
import {SignJWT} from "jose";

const secret = new TextEncoder().encode(process.env.ZULIP_JWT_SECRET);

export async function mintZulipJwt(viewerEmail: string): Promise<string> {
    return new SignJWT({email: viewerEmail, realm: "your-realm"})
        .setProtectedHeader({alg: "HS256"})
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(secret);
}
```

Python / Flask:

```python
import jwt, time

def mint_zulip_jwt(viewer_email: str) -> str:
    payload = {
        "email": viewer_email,
        "realm": "your-realm",
        "exp": int(time.time()) + 300,
    }
    return jwt.encode(payload, SECRET, algorithm="HS256")
```

Expose the minter behind a session-gated endpoint — `GET /api/zulip-token`
— so only authenticated viewers can pull a token. Never sign JWTs on
the client.

## 3. Deliver the token to the page

Two common patterns:

- **Server-render the attribute.** In Rails / Django / Remix, embed the
  minted token into the HTML when rendering the page that hosts
  `<zulip-chat>`. Shortest code path; locks the token to that one page
  view.
- **Fetch on mount.** Emit `<zulip-chat>` with no `auth-token`, then
  fetch `/api/zulip-token` in an effect and set the attribute
  programmatically. Handy in SPAs where the token needs to refresh.

## 4. Refresh before expiry

Today the SDK re-fetches the api-key once, on mount. If the page lives
longer than the JWT's `exp`, a future release (tracked as Sprint 2's
`refreshAuthToken` callback) will round-trip a new token transparently
on 401. For now, trigger a reload or replace the element if the user
keeps the tab open past the token lifetime.

## 5. Troubleshooting

- **`ErrorEvent.code === "jwt-not-configured"`.** The Zulip server
  returned 404 from `/api/internal/jwt/fetch_api_key` — the admin
  hasn't added `JWT_AUTH_KEYS`, or the setting targets a different
  realm than the one `server="..."` points at.
- **`ErrorEvent.code === "unauthorized"` immediately after mount.** The
  token signature didn't verify. Check that `ZULIP_JWT_SECRET` on your
  server matches the `key` in `JWT_AUTH_KEYS`, and that the `realm`
  claim is present.
- **No network call to `/api/internal/jwt/fetch_api_key`.** The embed
  only hits it when `auth-token` is non-empty and `api-key` is unset.
  Remove the legacy `api-key` attribute if both are present.
