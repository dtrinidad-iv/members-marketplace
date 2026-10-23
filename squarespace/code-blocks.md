# Squarespace page setup

Create each page in Squarespace, add a **Code Block** (Edit page → + → Code), and paste the snippet. Leave "Display Source" off. Normal Squarespace content (text, images, sections) can sit around the block.

| Page URL | Code Block | Notes |
|---|---|---|
| `/marketplace` | `<div data-mp="marketplace"></div>` | Visitors see teaser cards and a join prompt. Members get filters, full cards, save and detail views. |
| any page (e.g. Home) | `<div data-mp="marketplace" data-limit="4"></div>` | Compact "latest listings" strip, no filters. |
| `/marketplace` (category landing) | `<div data-mp="marketplace" data-category="Ceramics"></div>` | Pre-filtered view. |
| `/login` | `<div data-mp="login"></div>` | Redirects to `?next=` after login (same-site paths only). |
| `/join` | `<div data-mp="signup"></div>` | New accounts start as `pending`. |
| `/forgot-password` | `<div data-mp="forgot"></div>` | Same message whether or not the email exists. |
| `/reset-password` | `<div data-mp="reset"></div>` | Target of the Supabase reset email. |
| `/saved` | `<div data-mp="saved"></div>` | Protected. |
| `/sell` | `<div data-mp="sell"></div>` | Protected; active members only (RLS + Storage policy). |
| `/account` | `<div data-mp="account"></div>` | Protected. Change password, log out. |

## Header login/logout links

Squarespace 7.1 headers don't accept Code Blocks, so use either:

1. **CSS only**: add native nav links (Log in, Account) and toggle them with the classes mp.js sets on `<html>`, in Design → Custom CSS:
   ```css
   html.mp-auth-in  .header-nav-item a[href="/login"]   { display: none; }
   html.mp-auth-out .header-nav-item a[href="/account"] { display: none; }
   ```
2. **Injected**: put `<div data-mp="auth-nav"></div>` in a site-wide footer/announcement Code Block.

## Page settings for member pages

- **SEO → Hide from search engines** on `/saved`, `/sell`, `/account`, `/reset-password`.
- Don't add these pages to the main navigation. Use the auth-nav or CSS approach above instead.
- Optional: in Squarespace page settings, disable "Show in sitemap".

## Supabase dashboard settings

- **Auth → URL Configuration**: Site URL = `https://yourdomain.com`; add `https://yourdomain.com/reset-password` and `https://yourdomain.com/login` to Redirect URLs.
- **Auth → Email Templates**: brand the confirm/reset emails.
- **API → CORS**: your Squarespace domain (and the `*.squarespace.com` preview domain while building).

## Brand colors

```css
/* Design → Custom CSS */
:root { --mp-accent: #1f4d3f; --mp-accent-ink: #fff; --mp-radius: 6px; }
```
