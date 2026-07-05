# The Hint Ladder — AP Physics Tutor (GitHub Pages edition)

A fully static, four-file site: no server, no build step, no `npm install`.
Upload it to a repo, flip on GitHub Pages, paste in your API key, and it works.

## Files (this is everything — upload all four)

```
index.html    Homepage
tutor.html    The actual tutoring app
style.css     Shared styling
app.js        All the logic
```

## Deploy to GitHub Pages

1. Create a new GitHub repo (public or private, either works with Pages on
   most plans).
2. Upload these four files to the root of the repo (drag-and-drop on
   github.com works fine, or `git add . && git commit && git push`).
3. In the repo, go to **Settings → Pages**, set "Source" to your default
   branch (usually `main`) and folder `/ (root)`, then save.
4. GitHub gives you a URL like `https://yourusername.github.io/your-repo/`.
   Open it.
5. Click **Settings** in the app, paste your Anthropic API key (from
   https://console.anthropic.com/settings/keys), click **Save**. That's the
   only manual step — everything else works immediately.

## Why there's no backend

GitHub Pages only serves static files; it can't run server code. So instead
of hiding your key behind a server (like a Node backend would), this app
calls the Anthropic API directly from your browser using Anthropic's
documented `anthropic-dangerous-direct-browser-access` header, and your key
lives only in that browser's `localStorage` — never committed to the repo,
never sent anywhere but straight to Anthropic.

**Because of that, don't share your deployed link publicly.** Anyone who
opens it and checks their browser's Network tab or Local Storage could see
and reuse your key. For a personal testing setup this is a normal,
documented tradeoff — just treat the URL like you'd treat the key itself,
and consider setting a spend limit on the key in your Anthropic console as
a backstop.

## How the cost optimization works

Every message goes through a personalization pass so hints don't feel like
copy-pasted templates — but which model does that pass is chosen carefully:

- **Tiers 1–4** (your first four attempts): a pre-written template for that
  tier + unit is rewritten to speak to your specific problem and your
  specific attempt, using **Claude Haiku** — a small, cheap model. The
  result is cached in `localStorage`, so resending the same attempt is free.
- **Tier 5** (attempt 5): the problem is actually solved using **Claude
  Sonnet**, the stronger/more expensive model — but only the *first* time
  anyone on this browser hits that exact problem. The solution is cached
  forever after that. A second cheap Haiku call then writes the
  comparison between the correct answer and your specific attempts (not
  cached, since that part is personal to you).
- **File uploads**: reading a photo/PDF also uses the cheap model, cached
  by the file's contents, so re-uploading the same image costs nothing.
- A soft daily counter (visible in the footer) keeps a per-browser cap on
  both call types so a runaway loop can't quietly rack up a large bill.
  Defaults are 150 cheap calls / 50 heavy calls per day — edit
  `MAX_HAIKU_PER_DAY` / `MAX_SONNET_PER_DAY` near the top of `app.js` to
  change them.

## Customizing

- **Models**: change `HAIKU_MODEL` / `SONNET_MODEL` near the top of `app.js`.
- **Hint wording**: edit the `UNITS` array in `app.js` — these are the raw
  templates every personalization pass starts from.
- **Look**: everything visual lives in `style.css`.
- **Clearing the cache**: caches live in `localStorage` under `hlCache:*`
  keys. Clearing your browser's site data for the page resets everything,
  including your saved API key.
